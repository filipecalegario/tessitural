"""Fila de análises em background.

Uma análise leva minutos (separação de stems + pYIN), então a requisição HTTP
devolve um id na hora e a interface faz polling do progresso. A fila tem um
único worker de propósito: dois Demucs simultâneos brigariam por memória.

O cancelamento é cooperativo. Um job que ainda não começou some da fila na
hora; um que já está rodando só para na fronteira da próxima etapa, porque
não dá para interromper o Demucs no meio com segurança.

A fila vive em memória: reiniciar o servidor perde o que estava pendente. As
análises já concluídas estão no disco e não se perdem.
"""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from concurrent.futures import Future, ThreadPoolExecutor

_LOCK = threading.Lock()
_JOBS: dict[str, dict] = {}
_FUTURES: dict[str, Future] = {}
_CANCEL: set[str] = set()
_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tessitural")

LIVE = ("queued", "running")


class Cancelled(Exception):
    """Levantada dentro do pipeline quando o usuário pede para parar."""


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


def _positions() -> dict[str, int]:
    """Posição de cada job que ainda espera, na ordem em que foi criado."""
    waiting = sorted(
        (j for j in _JOBS.values() if j["status"] == "queued"),
        key=lambda j: j["created_at"],
    )
    return {j["id"]: i + 1 for i, j in enumerate(waiting)}


def _decorate(job: dict, pos: dict[str, int]) -> dict:
    out = dict(job)
    out["queue_position"] = pos.get(job["id"])
    return out


def get(job_id: str) -> dict | None:
    with _LOCK:
        job = _JOBS.get(job_id)
        return _decorate(job, _positions()) if job else None


def listing(include_finished: bool = True, limit: int = 40) -> list[dict]:
    """Fila inteira: o que roda, o que espera e o que acabou de terminar."""
    with _LOCK:
        pos = _positions()
        jobs = [
            _decorate(j, pos)
            for j in _JOBS.values()
            if include_finished or j["status"] in LIVE
        ]
    jobs.sort(key=lambda j: j["created_at"])
    return jobs[-limit:]


def active() -> list[dict]:
    return [j for j in listing() if j["status"] in LIVE]


def request_cancel(job_id: str) -> str:
    """Devolve 'cancelled' se saiu da fila, ou 'stopping' se já estava rodando."""
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return "unknown"
        if job["status"] not in LIVE:
            return "finished"
        _CANCEL.add(job_id)
        future = _FUTURES.get(job_id)
        if future is not None and future.cancel():
            job["status"] = "cancelled"
            job["finished_at"] = time.time()
            job["progress"].append({"t": time.time(), "message": "cancelado antes de começar"})
            return "cancelled"
    log(job_id, "cancelamento pedido — vai parar ao fim da etapa atual")
    return "stopping"


def is_cancelled(job_id: str) -> bool:
    with _LOCK:
        return job_id in _CANCEL


def checkpoint(job_id: str) -> None:
    """Ponto de parada: o pipeline chama isso entre as etapas caras."""
    if is_cancelled(job_id):
        raise Cancelled()


def clear_finished() -> int:
    with _LOCK:
        done = [k for k, j in _JOBS.items() if j["status"] not in LIVE]
        for k in done:
            _JOBS.pop(k, None)
            _FUTURES.pop(k, None)
            _CANCEL.discard(k)
        return len(done)


def submit(job_id: str, fn, *args, **kwargs) -> None:
    def runner():
        if is_cancelled(job_id):
            with _LOCK:
                _JOBS[job_id]["status"] = "cancelled"
                _JOBS[job_id]["finished_at"] = time.time()
            return
        with _LOCK:
            _JOBS[job_id]["status"] = "running"
            _JOBS[job_id]["started_at"] = time.time()
        try:
            result = fn(*args, **kwargs)
            with _LOCK:
                _JOBS[job_id]["status"] = "done"
                _JOBS[job_id]["result"] = result
        except Cancelled:
            with _LOCK:
                _JOBS[job_id]["status"] = "cancelled"
                _JOBS[job_id]["progress"].append({"t": time.time(), "message": "cancelado"})
        except Exception as exc:
            traceback.print_exc()
            with _LOCK:
                _JOBS[job_id]["status"] = "error"
                _JOBS[job_id]["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            with _LOCK:
                _JOBS[job_id]["finished_at"] = time.time()

    future = _POOL.submit(runner)
    with _LOCK:
        _FUTURES[job_id] = future
