"""Separação do stem vocal com Demucs, rodando localmente.

Usa MPS (GPU do Apple Silicon) quando disponível, com queda automática para CPU.
Nada é enviado para fora da máquina.
"""

from __future__ import annotations

from pathlib import Path

_MODEL_CACHE: dict[str, object] = {}


def available() -> bool:
    try:
        import demucs.pretrained  # noqa: F401
        import torch  # noqa: F401
    except ImportError:
        return False
    return True


def _pick_device(preferred: str = "auto") -> str:
    import torch

    if preferred != "auto":
        return preferred
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _get_model(name: str):
    if name not in _MODEL_CACHE:
        from demucs.pretrained import get_model

        _MODEL_CACHE[name] = get_model(name)
    return _MODEL_CACHE[name]


def separate_vocals(
    audio_path: str | Path,
    out_dir: Path,
    model_name: str = "htdemucs",
    device: str = "auto",
    log=lambda *_: None,
) -> dict:
    """Extrai vocal e acompanhamento. Devolve os caminhos dos dois arquivos."""
    import torch
    from demucs.apply import apply_model
    from demucs.audio import AudioFile, save_audio

    out_dir.mkdir(parents=True, exist_ok=True)
    vocal_path = out_dir / "vocals.wav"
    accomp_path = out_dir / "accompaniment.wav"
    if vocal_path.exists() and accomp_path.exists():
        log("stems já existiam, reaproveitando")
        return {"vocals": str(vocal_path), "accompaniment": str(accomp_path)}

    log(f"carregando modelo {model_name}")
    model = _get_model(model_name)
    model.eval()

    log("lendo áudio para separação")
    wav = AudioFile(str(audio_path)).read(
        streams=0, samplerate=model.samplerate, channels=model.audio_channels
    )
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)

    dev = _pick_device(device)
    log(f"separando stems no dispositivo {dev} (isso é a parte demorada)")
    try:
        model.to(dev)
        with torch.no_grad():
            sources = apply_model(
                model, wav[None], device=dev, split=True, overlap=0.25, progress=False
            )[0]
    except Exception as exc:
        if dev == "cpu":
            raise
        log(f"falha em {dev} ({type(exc).__name__}), refazendo em CPU")
        model.to("cpu")
        with torch.no_grad():
            sources = apply_model(
                model, wav[None], device="cpu", split=True, overlap=0.25, progress=False
            )[0]

    sources = sources * (ref.std() + 1e-8) + ref.mean()
    names = list(model.sources)
    vocals = sources[names.index("vocals")]
    accompaniment = sum(sources[i] for i, n in enumerate(names) if n != "vocals")

    log("gravando stems")
    save_audio(vocals, str(vocal_path), model.samplerate)
    save_audio(accompaniment, str(accomp_path), model.samplerate)
    return {"vocals": str(vocal_path), "accompaniment": str(accomp_path)}
