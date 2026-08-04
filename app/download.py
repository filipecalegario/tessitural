"""Obtenção do áudio: download do YouTube via yt-dlp ou arquivo local."""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from yt_dlp import YoutubeDL

_URL_RE = re.compile(r"^https?://", re.I)


def _as_target(query: str) -> str:
    """Aceita URL ou texto livre — texto vira busca no YouTube."""
    q = query.strip()
    return q if _URL_RE.match(q) else f"ytsearch1:{q}"


def download_youtube(url: str, dest_dir: Path, log=lambda *_: None) -> dict:
    """Baixa a melhor trilha de áudio e converte para MP3. Tudo local."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    target = _as_target(url)

    def hook(d):
        if d.get("status") == "downloading":
            pct = d.get("_percent_str", "").strip()
            if pct:
                log(f"baixando áudio {pct}")
        elif d.get("status") == "finished":
            log("download concluído, convertendo para MP3")

    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(dest_dir / "source.%(ext)s"),
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
        ],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [hook],
    }

    if target.startswith("ytsearch"):
        log(f"procurando no YouTube: {url}")
    else:
        log("consultando metadados do vídeo")
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(target, download=True)
    # Uma busca devolve uma playlist de um item; o que interessa é o item.
    if info.get("_type") == "playlist" or "entries" in info:
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            raise RuntimeError(f"nada encontrado no YouTube para: {url}")
        info = entries[0]
        log(f"encontrado: {info.get('title')}")

    audio = dest_dir / "source.mp3"
    if not audio.exists():
        candidates = sorted(dest_dir.glob("source.*"))
        if not candidates:
            raise RuntimeError("yt-dlp não produziu nenhum arquivo de áudio")
        audio = candidates[0]

    return {
        "path": str(audio),
        "title": info.get("title") or url,
        "artist": info.get("artist") or info.get("uploader") or "",
        "webpage_url": info.get("webpage_url") or url,
        "source_duration": info.get("duration"),
    }


def ingest_local(src: str | Path, dest_dir: Path, log=lambda *_: None) -> dict:
    """Copia um arquivo de áudio já existente para dentro do workspace."""
    src = Path(src).expanduser()
    if not src.exists():
        raise FileNotFoundError(f"arquivo não encontrado: {src}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"source{src.suffix.lower()}"
    log(f"copiando {src.name}")
    shutil.copy2(src, dest)
    return {
        "path": str(dest),
        "title": src.stem,
        "artist": "",
        "webpage_url": None,
        "source_duration": None,
    }
