#!/usr/bin/env bash
set -eu

VENV="${MTPLX_SERVER_VENV:-$HOME/projects/mac-mtplx-env}"
PYTHON_VERSION="${MTPLX_SERVER_PYTHON:-3.12.13}"
REQUIRED_PYTHON_MINOR="3.12"
MTPLX_VERSION="${MTPLX_VERSION:-2.1.0}"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required. Install it first, for example: brew install uv" >&2
  exit 1
fi

uv venv "$VENV" --python "$PYTHON_VERSION"
"$VENV/bin/python" --version
"$VENV/bin/python" - <<EOF
import sys

required = tuple(map(int, "$REQUIRED_PYTHON_MINOR".split(".")))
actual = sys.version_info[:2]
if actual != required:
    raise SystemExit(f"expected Python {required[0]}.{required[1]}.x, got {sys.version.split()[0]}")
EOF

uv pip install --python "$VENV/bin/python" \
  "mtplx==$MTPLX_VERSION" \
  hf_transfer

cat <<EOF

MTPLX test env ready at:
  $VENV

This env is isolated from the production mlx_lm.server env:
  $HOME/projects/mac-mlx-env

Activate it with:
  source "$VENV/bin/activate"

Or, in fish:
  source "$VENV/bin/activate.fish"

Verify:
  "$VENV/bin/python" --version
  "$VENV/bin/mtplx" --version
  "$VENV/bin/mtplx" doctor
  "$VENV/bin/mtplx" inspect Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed-FP16
EOF
