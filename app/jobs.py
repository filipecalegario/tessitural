"""Fila de análises em background.

Uma análise leva minutos (separação de stems + pYIN), então a requisição HTTP
devolve um id na hora e a interface faz polling do progresso. A fila tem um
único worker de propósito: dois Demucs simultâneos brigariam por memória.
"""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

_LOCK = threading.Lock()
_JOBS: dict[str, dict] = {}
_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tessitural")


def create(kind: str, label: str) -> str:
    job_id = uuid.uuid4().hex[:12]
    with _LOCK:
        _JOBS[job_id] = {
            "id": job_id,
            "kind": kind,
            "label": label,
            "status": "queued",
            "progress": [],
            "result": None,
            "error": None,
            "created_at": time.time(),
        }
    return job_id


def log(job_id: str, message: str) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is not None:
            job["progress"].append({"t": time.time(), "message": message})


def get(job_id: str) -> dict | None:
    with _LOCK:
        job = _JOBS.get(job_id)
        return dict(job) if job else None


def active() -> list[dict]:
    with _LOCK:
        return [
            dict(j)
            for j in _JOBS.values()
            if j["status"] in ("queued", "running")
        ]


def submit(job_id: str, fn, *args, **kwargs) -> None:
    def runner():
        with _LOCK:
            _JOBS[job_id]["status"] = "running"
            _JOBS[job_id]["started_at"] = time.time()
        try:
            result = fn(*args, **kwargs)
            with _LOCK:
                _JOBS[job_id]["status"] = "done"
                _JOBS[job_id]["result"] = result
        except Exception as exc:
            traceback.print_exc()
            with _LOCK:
                _JOBS[job_id]["status"] = "error"
                _JOBS[job_id]["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            with _LOCK:
                _JOBS[job_id]["finished_at"] = time.time()

    _POOL.submit(runner)
