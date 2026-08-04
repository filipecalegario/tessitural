"""Persistência local: uma pasta por música, tudo em JSON e áudio no disco."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
SONGS_DIR = DATA_DIR / "songs"
SETTINGS_PATH = DATA_DIR / "settings.json"

DEFAULT_SETTINGS = {
    # Faixa confortável e faixa de extensão máxima do cantor, em MIDI.
    # C3=48, C4=60. Os defaults são um barítono genérico — o usuário ajusta.
    "comfort_low": 48,
    "comfort_high": 64,
    "stretch_low": 45,
    "stretch_high": 69,
    "singer_name": "eu",
}


def _slug(text: str) -> str:
    s = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    s = re.sub(r"[\s_-]+", "-", s)
    return s[:48] or "musica"


def song_id(key: str, title: str) -> str:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:8]
    return f"{_slug(title)}-{digest}"


def song_dir(sid: str) -> Path:
    return SONGS_DIR / sid


def save_analysis(sid: str, payload: dict) -> None:
    d = song_dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    (d / "analysis.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def load_analysis(sid: str) -> dict | None:
    path = song_dir(sid) / "analysis.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def update_meta(sid: str, changes: dict) -> dict | None:
    """Atualiza campos editáveis pelo usuário (tag, anotação) sem refazer a análise."""
    data = load_analysis(sid)
    if data is None:
        return None
    allowed = {"tag", "note", "title", "artist"}
    data.setdefault("meta", {}).update({k: v for k, v in changes.items() if k in allowed})
    data["meta"]["updated_at"] = time.time()
    save_analysis(sid, data)
    return data


def delete_song(sid: str) -> bool:
    d = song_dir(sid)
    if not d.exists():
        return False
    shutil.rmtree(d)
    return True


def list_songs() -> list[dict]:
    """Índice enxuto da biblioteca — só o que a tela de comparação precisa."""
    out = []
    if not SONGS_DIR.exists():
        return out
    for d in sorted(SONGS_DIR.iterdir()):
        path = d / "analysis.json"
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        stats = data.get("stats", {})
        meta = data.get("meta", {})
        out.append(
            {
                "id": d.name,
                "title": meta.get("title", d.name),
                "artist": meta.get("artist", ""),
                "tag": meta.get("tag", "neutral"),
                "note": meta.get("note", ""),
                "created_at": meta.get("created_at"),
                "source_url": meta.get("source_url"),
                "separated": meta.get("separated", False),
                "duration": data.get("duration"),
                "min_midi": stats.get("min_midi"),
                "max_midi": stats.get("max_midi"),
                "min_note": stats.get("min_note"),
                "max_note": stats.get("max_note"),
                "core_low": stats.get("core_low"),
                "core_high": stats.get("core_high"),
                "median_midi": stats.get("median_midi"),
                "range_semitones": stats.get("range_semitones"),
                "sung_seconds": stats.get("sung_seconds"),
                "key": stats.get("key", {}).get("name"),
                "climb": stats.get("climb", {}).get("delta"),
                "histogram": stats.get("histogram", {}),
            }
        )
    out.sort(key=lambda s: s.get("created_at") or 0, reverse=True)
    return out


def get_settings() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not SETTINGS_PATH.exists():
        SETTINGS_PATH.write_text(json.dumps(DEFAULT_SETTINGS, indent=2), encoding="utf-8")
        return dict(DEFAULT_SETTINGS)
    merged = dict(DEFAULT_SETTINGS)
    merged.update(json.loads(SETTINGS_PATH.read_text(encoding="utf-8")))
    return merged


def save_settings(changes: dict) -> dict:
    current = get_settings()
    for key in DEFAULT_SETTINGS:
        if key in changes:
            current[key] = changes[key]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
    return current
