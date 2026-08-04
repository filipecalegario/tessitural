"""Servidor local do Tessitural.

Serve a interface web e a API. Roda em 127.0.0.1: nada sai da máquina, nenhum
processamento acontece em servidor remoto — o "servidor" aqui é só a ponte
entre o navegador e os scripts de análise que rodam no seu próprio computador.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import jobs, library, pipeline, separate

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"

app = FastAPI(title="Tessitural", docs_url="/api/docs")


class AnalyzeRequest(BaseModel):
    url: str | None = None
    file_path: str | None = None
    title: str | None = None
    artist: str | None = None
    tag: str = "neutral"
    separate: bool = True
    model: str = "htdemucs"


class MetaUpdate(BaseModel):
    tag: str | None = None
    note: str | None = None
    title: str | None = None
    artist: str | None = None


class SettingsUpdate(BaseModel):
    comfort_low: int | None = None
    comfort_high: int | None = None
    stretch_low: int | None = None
    stretch_high: int | None = None
    singer_name: str | None = None


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "demucs": separate.available()}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    if not req.url and not req.file_path:
        raise HTTPException(400, "informe url ou file_path")
    label = req.title or req.url or req.file_path or "análise"
    job_id = jobs.create("analyze", label)
    jobs.submit(
        job_id,
        pipeline.run,
        job_id,
        url=req.url,
        file_path=req.file_path,
        title=req.title,
        artist=req.artist,
        tag=req.tag,
        do_separate=req.separate,
        model=req.model,
    )
    return {"job_id": job_id}


@app.post("/api/upload")
async def upload(file: UploadFile) -> dict:
    """Recebe um arquivo do navegador e guarda em disco para análise posterior."""
    inbox = library.DATA_DIR / "uploads"
    inbox.mkdir(parents=True, exist_ok=True)
    dest = inbox / (file.filename or "upload.mp3")
    with dest.open("wb") as fh:
        while chunk := await file.read(1 << 20):
            fh.write(chunk)
    return {"file_path": str(dest), "title": dest.stem}


@app.get("/api/jobs")
def list_jobs() -> dict:
    return {"jobs": jobs.active()}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "job não encontrado")
    return job


@app.get("/api/library")
def get_library() -> dict:
    return {"songs": library.list_songs()}


@app.get("/api/songs/{sid}")
def get_song(sid: str) -> dict:
    data = library.load_analysis(sid)
    if data is None:
        raise HTTPException(404, "música não encontrada")
    return data


@app.patch("/api/songs/{sid}")
def patch_song(sid: str, body: MetaUpdate) -> dict:
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    data = library.update_meta(sid, changes)
    if data is None:
        raise HTTPException(404, "música não encontrada")
    return data["meta"]


@app.post("/api/songs/{sid}/reanalyze")
def reanalyze_song(sid: str) -> dict:
    data = library.load_analysis(sid)
    if data is None:
        raise HTTPException(404, "música não encontrada")
    job_id = jobs.create("reanalyze", data.get("meta", {}).get("title", sid))
    jobs.submit(job_id, pipeline.reanalyze, job_id, sid)
    return {"job_id": job_id}


@app.delete("/api/songs/{sid}")
def remove_song(sid: str) -> dict:
    if not library.delete_song(sid):
        raise HTTPException(404, "música não encontrada")
    return {"deleted": sid}


@app.get("/api/songs/{sid}/audio/{which}")
def get_audio(sid: str, which: str):
    """Serve o áudio para tocar junto do piano roll. `which`: mix | vocals."""
    data = library.load_analysis(sid)
    if data is None:
        raise HTTPException(404, "música não encontrada")
    meta = data.get("meta", {})
    d = library.song_dir(sid)
    name = meta.get("vocal_file") if which == "vocals" else meta.get("mix_file")
    if not name:
        raise HTTPException(404, "áudio indisponível")
    path = d / name
    if not path.exists():
        raise HTTPException(404, "arquivo de áudio não encontrado")
    return FileResponse(path)


@app.get("/api/settings")
def read_settings() -> dict:
    return library.get_settings()


@app.put("/api/settings")
def write_settings(body: SettingsUpdate) -> dict:
    return library.save_settings({k: v for k, v in body.model_dump().items() if v is not None})


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
