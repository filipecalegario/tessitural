"""Orquestração: entrada -> áudio -> stem vocal -> análise -> biblioteca."""

from __future__ import annotations

import time
from pathlib import Path

from . import analysis, download, jobs, library, separate


def reanalyze(job_id: str, sid: str) -> dict:
    """Refaz a análise sobre os stems já existentes, sem baixar nem separar de novo.

    Serve quando o algoritmo de detecção muda — a parte cara (download e Demucs)
    fica no disco e só o pYIN roda outra vez.
    """
    def log(msg: str) -> None:
        jobs.log(job_id, msg)

    existing = library.load_analysis(sid)
    if existing is None:
        raise ValueError(f"música desconhecida: {sid}")
    meta = existing.get("meta", {})
    dest = library.song_dir(sid)
    mix = dest / meta.get("mix_file", "")
    vocal = dest / meta.get("vocal_file", meta.get("mix_file", ""))
    if not vocal.exists():
        raise FileNotFoundError(f"áudio do vocal não está mais no disco: {vocal}")

    log("reanalisando a partir dos stems já salvos")
    result = analysis.analyze(str(vocal), mix_path=str(mix) if mix.exists() else None, log=log)
    result["meta"] = {**meta, "reanalyzed_at": time.time()}
    library.save_analysis(sid, result)
    log("reanálise concluída")
    return {"id": sid, "title": meta.get("title", sid)}


def run(
    job_id: str,
    *,
    url: str | None = None,
    file_path: str | None = None,
    title: str | None = None,
    artist: str | None = None,
    tag: str = "neutral",
    do_separate: bool = True,
    model: str = "htdemucs",
) -> dict:
    def log(msg: str) -> None:
        jobs.log(job_id, msg)

    library.SONGS_DIR.mkdir(parents=True, exist_ok=True)
    staging = library.DATA_DIR / "staging" / job_id
    staging.mkdir(parents=True, exist_ok=True)

    if url:
        info = download.download_youtube(url, staging, log=log)
        key = url
    elif file_path:
        info = download.ingest_local(file_path, staging, log=log)
        key = str(Path(file_path).resolve())
    else:
        raise ValueError("informe uma URL do YouTube ou um arquivo local")

    final_title = title or info["title"]
    sid = library.song_id(key, final_title)
    dest = library.song_dir(sid)
    dest.mkdir(parents=True, exist_ok=True)

    # Move o áudio do staging para a pasta definitiva da música.
    source = Path(info["path"])
    mix_path = dest / source.name
    if source.resolve() != mix_path.resolve():
        source.replace(mix_path)
    for leftover in staging.glob("*"):
        leftover.unlink(missing_ok=True)
    staging.rmdir()

    vocal_path = mix_path
    separated = False
    if do_separate:
        if not separate.available():
            log("Demucs não está instalado — analisando a mixagem completa")
        else:
            stems = separate.separate_vocals(mix_path, dest / "stems", model_name=model, log=log)
            vocal_path = Path(stems["vocals"])
            separated = True
    else:
        log("separação desativada — analisando a mixagem completa")

    result = analysis.analyze(str(vocal_path), mix_path=str(mix_path), log=log)
    result["meta"] = {
        "id": sid,
        "title": final_title,
        "artist": artist or info.get("artist", ""),
        "tag": tag,
        "note": "",
        "source_url": info.get("webpage_url"),
        "separated": separated,
        "model": model if separated else None,
        "mix_file": mix_path.name,
        "vocal_file": str(vocal_path.relative_to(dest)) if separated else mix_path.name,
        "created_at": time.time(),
    }
    library.save_analysis(sid, result)
    log("análise concluída")
    return {"id": sid, "title": final_title}
