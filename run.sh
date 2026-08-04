#!/usr/bin/env bash
# Sobe o Tessitural localmente. Nada sai da máquina.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Criando ambiente virtual..."
  uv venv --python 3.13
  uv pip install -r pyproject.toml
  uv pip install "demucs>=4.0.1" "torch>=2.6" "torchaudio>=2.6"
fi

PORT="${PORT:-8420}"
echo "Tessitural em http://127.0.0.1:${PORT}"
exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" "$@"
