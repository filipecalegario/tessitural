"""Extração de melodia vocal, segmentação em notas e estatísticas de tessitura.

Todo o processamento roda localmente. O pipeline é:

    áudio do vocal -> pYIN (f0 quadro a quadro) -> gate de energia/confiança
                   -> suavização -> segmentação em notas -> estatísticas

O contorno contínuo de f0 é o que alimenta a visualização estilo Melodyne;
as notas segmentadas é que alimentam as estatísticas (mais robustas a glissandos
e a quadros isolados de lixo).
"""

from __future__ import annotations

import dataclasses
import math
from typing import Iterable

import librosa
import numpy as np
from scipy.ndimage import median_filter

from .notes import hz_to_midi, midi_to_name

SR = 22050
HOP = 256
FRAME = 2048

# Faixa de busca: C2 (~65 Hz) a C6 (~1047 Hz) cobre baixo profundo até soprano.
FMIN_NOTE = "C2"
FMAX_NOTE = "C6"


@dataclasses.dataclass
class Note:
    t0: float
    t1: float
    midi: int
    cents: float
    conf: float

    @property
    def dur(self) -> float:
        return self.t1 - self.t0

    def as_dict(self) -> dict:
        return {
            "t0": round(self.t0, 3),
            "t1": round(self.t1, 3),
            "midi": self.midi,
            "cents": round(self.cents, 1),
            "conf": round(self.conf, 3),
        }


def load_audio(path: str, sr: int = SR) -> np.ndarray:
    y, _ = librosa.load(path, sr=sr, mono=True)
    return y


def track_pitch(
    y: np.ndarray,
    sr: int = SR,
    silence_db: float = -40.0,
    conf_threshold: float = 0.0,
) -> dict:
    """Roda pYIN e devolve contorno de pitch com máscara de vozeamento.

    O sinal de vozeamento confiável é o `voiced_flag`: ele já é o caminho de
    Viterbi do HMM do pYIN, isto é, uma decisão suavizada no tempo. A
    `voiced_prob` que acompanha é uma posterior marginal e vive baixa mesmo em
    canto claro (mediana ~0.09 em gravações antigas), então serve só como piso
    para descartar lixo — nunca como limiar principal.

    Sobre isso aplicamos um gate de energia (RMS), que remove o vazamento
    residual deixado pelo separador de stems nos trechos instrumentais, onde o
    pYIN inventaria notas a partir de quase-silêncio.
    """
    f0, voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=librosa.note_to_hz(FMIN_NOTE),
        fmax=librosa.note_to_hz(FMAX_NOTE),
        sr=sr,
        frame_length=FRAME,
        hop_length=HOP,
        fill_na=np.nan,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=HOP)

    rms = librosa.feature.rms(y=y, frame_length=FRAME, hop_length=HOP, center=True)[0]
    rms = rms[: len(f0)] if len(rms) >= len(f0) else np.pad(rms, (0, len(f0) - len(rms)))
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)

    voiced = (
        np.nan_to_num(voiced_flag, nan=False).astype(bool)
        & (voiced_prob > conf_threshold)
        & (rms_db > silence_db)
        & np.isfinite(f0)
    )

    midi = np.full_like(f0, np.nan, dtype=float)
    ok = np.isfinite(f0) & (f0 > 0)
    midi[ok] = 69.0 + 12.0 * np.log2(f0[ok] / 440.0)
    midi[~voiced] = np.nan

    return {
        "times": times,
        "f0": f0,
        "midi": midi,
        "voiced": voiced,
        "conf": np.nan_to_num(voiced_prob),
        "rms_db": rms_db,
    }


def _voiced_runs(voiced: np.ndarray) -> Iterable[tuple[int, int]]:
    """Índices [start, end) de cada trecho contíguo vozeado."""
    if not voiced.any():
        return []
    edges = np.diff(voiced.astype(np.int8))
    starts = list(np.flatnonzero(edges == 1) + 1)
    ends = list(np.flatnonzero(edges == -1) + 1)
    if voiced[0]:
        starts.insert(0, 0)
    if voiced[-1]:
        ends.append(len(voiced))
    return list(zip(starts, ends))


def segment_notes(
    track: dict,
    smooth_frames: int = 7,
    min_dur: float = 0.075,
    merge_gap: float = 0.08,
) -> list[Note]:
    """Converte o contorno contínuo em notas discretas de altura inteira.

    A suavização por mediana acontece dentro de cada trecho vozeado, nunca
    atravessando silêncios — senão o final de uma frase contaminaria o começo
    da próxima.
    """
    times, midi, voiced, conf = track["times"], track["midi"], track["voiced"], track["conf"]
    if len(times) < 2:
        return []
    dt = float(np.median(np.diff(times)))
    raw: list[Note] = []

    for start, end in _voiced_runs(voiced):
        seg = midi[start:end]
        if len(seg) == 0 or not np.isfinite(seg).any():
            continue
        k = min(smooth_frames, len(seg) if len(seg) % 2 else len(seg) - 1)
        smooth = median_filter(seg, size=max(k, 1), mode="nearest") if k >= 3 else seg
        rounded = np.round(smooth).astype(int)

        i = 0
        while i < len(rounded):
            j = i
            while j + 1 < len(rounded) and rounded[j + 1] == rounded[i]:
                j += 1
            idx = slice(start + i, start + j + 1)
            vals = smooth[i : j + 1]
            note_midi = int(rounded[i])
            cents = float((np.median(vals) - note_midi) * 100.0)
            raw.append(
                Note(
                    t0=float(times[start + i]),
                    t1=float(times[start + j]) + dt,
                    midi=note_midi,
                    cents=cents,
                    conf=float(np.mean(conf[idx])),
                )
            )
            i = j + 1

    # Descarta transições muito curtas (portamento, ataque) e depois costura
    # notas iguais que ficaram partidas por elas ou por vibrato.
    # A segunda condição mata o lixo típico do pYIN: erro de oitava isolado,
    # que aparece como um evento curtíssimo e com posterior baixíssima.
    kept = [n for n in raw if n.dur >= min_dur and not (n.dur < 0.2 and n.conf < 0.1)]
    merged: list[Note] = []
    for n in kept:
        if merged and merged[-1].midi == n.midi and n.t0 - merged[-1].t1 <= merge_gap:
            prev = merged[-1]
            total = prev.dur + n.dur
            prev.cents = (prev.cents * prev.dur + n.cents * n.dur) / total
            prev.conf = (prev.conf * prev.dur + n.conf * n.dur) / total
            prev.t1 = n.t1
        else:
            merged.append(dataclasses.replace(n))
    return merged


def _weighted_percentile(values: np.ndarray, weights: np.ndarray, q: float) -> float:
    """Percentil de altura ponderado por duração (segundos cantados)."""
    if len(values) == 0:
        return float("nan")
    order = np.argsort(values)
    v, w = values[order], weights[order]
    cum = np.cumsum(w)
    if cum[-1] <= 0:
        return float(v[0])
    return float(np.interp(q / 100.0 * cum[-1], cum, v))


def pitch_over_time(notes: list[Note], duration: float, win: float = 8.0, hop: float = 2.0) -> list[dict]:
    """Perfil temporal: mediana e teto da tessitura em janelas deslizantes.

    É esta série que mostra a música "subindo" ao longo do arranjo.
    """
    if not notes or duration <= 0:
        return []
    out = []
    t = 0.0
    while t < duration:
        lo, hi = t, t + win
        vals, wts = [], []
        for n in notes:
            overlap = min(n.t1, hi) - max(n.t0, lo)
            if overlap > 0:
                vals.append(n.midi)
                wts.append(overlap)
        if wts and sum(wts) >= 0.4:
            v = np.array(vals, dtype=float)
            w = np.array(wts, dtype=float)
            out.append(
                {
                    "t": round(lo + win / 2, 2),
                    "median": round(_weighted_percentile(v, w, 50), 2),
                    "p90": round(_weighted_percentile(v, w, 90), 2),
                    "max": int(v.max()),
                    "voiced": round(float(w.sum()), 2),
                }
            )
        t += hop
    return out


def _climb_metric(profile: list[dict]) -> dict:
    """Tendência de subida: regressão linear da mediana ao longo do tempo.

    Resultado em semitons por minuto — positivo significa que a música vai
    ficando mais aguda conforme avança.
    """
    if len(profile) < 4:
        return {"semitones_per_min": 0.0, "first_third": None, "last_third": None, "delta": 0.0}
    t = np.array([p["t"] for p in profile], dtype=float)
    m = np.array([p["median"] for p in profile], dtype=float)
    slope = float(np.polyfit(t, m, 1)[0]) * 60.0
    third = max(1, len(profile) // 3)
    first = float(np.median(m[:third]))
    last = float(np.median(m[-third:]))
    return {
        "semitones_per_min": round(slope, 2),
        "first_third": round(first, 2),
        "last_third": round(last, 2),
        "delta": round(last - first, 2),
    }


KRUMHANSL_MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
KRUMHANSL_MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


def detect_key(y: np.ndarray, sr: int = SR) -> dict:
    """Tom da música por correlação de perfis Krumhansl-Schmuckler."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP * 4)
    profile = chroma.mean(axis=1)
    if profile.sum() <= 0:
        return {"tonic": None, "mode": None, "name": None, "confidence": 0.0}
    profile = profile / profile.sum()

    best = (-2.0, 0, "major")
    scores = []
    for mode, template in (("major", KRUMHANSL_MAJOR), ("minor", KRUMHANSL_MINOR)):
        tpl = template / template.sum()
        for shift in range(12):
            rolled = np.roll(tpl, shift)
            corr = float(np.corrcoef(profile, rolled)[0, 1])
            scores.append(corr)
            if corr > best[0]:
                best = (corr, shift, mode)

    corr, tonic, mode = best
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    names_pt = ["Dó", "Dó#", "Ré", "Ré#", "Mi", "Fá", "Fá#", "Sol", "Sol#", "Lá", "Lá#", "Si"]
    suffix = "" if mode == "major" else "m"
    sorted_scores = sorted(scores, reverse=True)
    margin = sorted_scores[0] - sorted_scores[1] if len(sorted_scores) > 1 else 0.0
    return {
        "tonic": tonic,
        "mode": mode,
        "name": f"{names[tonic]}{suffix}",
        "name_pt": f"{names_pt[tonic]}{'m' if mode == 'minor' else ' maior'}",
        "confidence": round(float(corr), 3),
        "margin": round(float(margin), 3),
    }


def compute_stats(notes: list[Note], duration: float) -> dict:
    if not notes:
        return {"error": "nenhuma nota vocal detectada"}

    vals = np.array([n.midi for n in notes], dtype=float)
    wts = np.array([n.dur for n in notes], dtype=float)
    sung = float(wts.sum())

    hist: dict[int, float] = {}
    for n in notes:
        hist[n.midi] = hist.get(n.midi, 0.0) + n.dur

    # Notas exigentes: as mais agudas que ainda são sustentadas por um tempo
    # relevante. É o que de fato cansa quem canta — um agudo de relance não conta.
    high_cut = _weighted_percentile(vals, wts, 92)
    demanding = sorted(
        [n for n in notes if n.midi >= high_cut and n.dur >= 0.25],
        key=lambda n: (-n.midi, -n.dur),
    )[:20]

    # Extremos "de verdade": uma altura só conta como exigida pela música se a
    # voz permanece nela por um tempo mínimo somado ao longo da faixa. Sem isso
    # um único quadro errado do detector viraria a manchete da tessitura.
    floor = max(0.3, 0.01 * sung)
    solid = sorted(m for m, d in hist.items() if d >= floor) or sorted(hist)
    low_midi, high_midi = solid[0], solid[-1]

    def _first_at(target: int) -> float:
        hits = [n for n in notes if n.midi == target]
        return round(max(hits, key=lambda n: n.dur).t0, 2) if hits else 0.0

    pct = {f"p{q}": round(_weighted_percentile(vals, wts, q), 2) for q in (1, 5, 10, 25, 50, 75, 90, 95, 99)}

    return {
        "min_midi": int(low_midi),
        "max_midi": int(high_midi),
        "min_note": midi_to_name(low_midi),
        "max_note": midi_to_name(high_midi),
        "min_at": _first_at(low_midi),
        "max_at": _first_at(high_midi),
        "range_semitones": int(high_midi - low_midi),
        # Extremos absolutos, incluindo lampejos de uma nota só: guardados para
        # transparência, mas não é isso que o app usa como manchete.
        "abs_min_note": midi_to_name(vals.min()),
        "abs_max_note": midi_to_name(vals.max()),
        "extreme_floor": round(floor, 2),
        "core_low": pct["p5"],
        "core_high": pct["p95"],
        "core_range": round(pct["p95"] - pct["p5"], 2),
        "median_midi": pct["p50"],
        "median_note": midi_to_name(pct["p50"]),
        "percentiles": pct,
        "sung_seconds": round(sung, 1),
        "duration": round(duration, 1),
        "vocal_density": round(sung / duration, 3) if duration else 0.0,
        "note_count": len(notes),
        "histogram": {str(k): round(v, 2) for k, v in sorted(hist.items())},
        "demanding": [n.as_dict() for n in demanding],
    }


def analyze(vocal_path: str, mix_path: str | None = None, log=lambda *_: None) -> dict:
    """Análise completa de um stem vocal. `mix_path` é usado só para o tom."""
    log("carregando áudio do vocal")
    y = load_audio(vocal_path)
    duration = len(y) / SR

    log(f"rastreando pitch com pYIN ({duration / 60:.1f} min de áudio)")
    track = track_pitch(y)

    log("segmentando em notas")
    notes = segment_notes(track)

    log("calculando estatísticas de tessitura")
    stats = compute_stats(notes, duration)
    profile = pitch_over_time(notes, duration)
    stats["profile"] = profile
    stats["climb"] = _climb_metric(profile)

    key = {"tonic": None, "mode": None, "name": None, "confidence": 0.0}
    if mix_path:
        log("detectando tom da música")
        try:
            key = detect_key(load_audio(mix_path))
        except Exception as exc:  # pragma: no cover - detecção de tom é acessória
            log(f"falha ao detectar tom: {exc}")
    stats["key"] = key

    # Contorno reduzido para a visualização: o pYIN gera ~85 quadros por segundo,
    # o que é mais resolução do que a tela usa. Guardamos 1 a cada N.
    step = max(1, int(len(track["times"]) / 12000))
    contour = []
    for i in range(0, len(track["times"]), step):
        m = track["midi"][i]
        contour.append(
            [round(float(track["times"][i]), 3), None if not math.isfinite(m) else round(float(m), 2)]
        )

    return {
        "stats": stats,
        "notes": [n.as_dict() for n in notes],
        "contour": contour,
        "duration": round(duration, 2),
    }
