#!/usr/bin/env bash
set -eu

VENV="${MLX_SERVER_VENV:-$HOME/projects/mac-mlx-env}"
PYTHON_VERSION="${MLX_SERVER_PYTHON:-3.12}"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required. Install it first, for example: brew install uv" >&2
  exit 1
fi

uv venv "$VENV" --python "$PYTHON_VERSION"
"$VENV/bin/python" --version
uv pip install --python "$VENV/bin/python" -U mlx-openai-server hf_transfer

cat <<EOF

MLX server env ready at:
  $VENV

Activate it with:
  source "$VENV/bin/activate"

Verify:
  "$VENV/bin/python" --version
  "$VENV/bin/mlx-openai-server" --help
EOF
