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

# mlx-lm is pinned to a specific unreleased commit: PyPI's latest (0.31.3) hits
# "RuntimeError: There is no Stream(gpu, N) in current thread" under mlx_lm.server's
# threaded batch scheduler on sliding-window/rotating-KV-cache models (e.g. Devstral).
# See ml-explore/mlx-lm#1181 and #1256. Remove the pin once a release includes the fix.
uv pip install --python "$VENV/bin/python" \
  "mlx>=0.32.0" \
  "git+https://github.com/ml-explore/mlx-lm.git@15b522f593b7ca5fbc0cac6f7572d40859d2d8fe" \
  hf_transfer

cat <<EOF

MLX server env ready at:
  $VENV

Activate it with:
  source "$VENV/bin/activate"

Verify:
  "$VENV/bin/python" --version
  "$VENV/bin/mlx_lm.server" --help
EOF
