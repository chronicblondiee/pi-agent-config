#!/usr/bin/env bash
set -u

MODEL="mtplx-qwen36-27b-optimized-speed-fp16"
MTPLX_HF_MODEL="${MTPLX_HF_MODEL:-Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed-FP16}"
REQUIRED_MTPLX_VERSION="2.1.0"
REQUIRED_PYTHON_MINOR="3.12"
HOST="127.0.0.1"
PORT="${MTPLX_PORT:-18080}"
VENV="${MTPLX_SERVER_VENV:-$HOME/projects/mac-mtplx-env}"
MTPLX="$VENV/bin/mtplx"
PYTHON="$VENV/bin/python"
DOWNLOAD_MODEL="${MTPLX_DOWNLOAD:-1}"

die() {
  printf 'start-mtplx-local-server: %s\n' "$*" >&2
  exit 1
}

port_is_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  return 1
}

ensure_runtime_versions() {
  local version_output

  [ -x "$PYTHON" ] || die "missing executable: $PYTHON; run scripts/setup-mac-mtplx-env.sh first"
  "$PYTHON" - <<EOF || die "expected $PYTHON to be Python $REQUIRED_PYTHON_MINOR.x; rerun scripts/setup-mac-mtplx-env.sh"
import sys

required = tuple(map(int, "$REQUIRED_PYTHON_MINOR".split(".")))
actual = sys.version_info[:2]
if actual != required:
    raise SystemExit(f"expected Python {required[0]}.{required[1]}.x, got {sys.version.split()[0]}")
EOF

  [ -x "$MTPLX" ] || die "missing executable: $MTPLX; run scripts/setup-mac-mtplx-env.sh first"
  version_output="$("$MTPLX" --version 2>&1)" || die "could not run $MTPLX --version"
  case "$version_output" in
    *"$REQUIRED_MTPLX_VERSION"*)
      printf 'Using %s: %s\n' "$MTPLX" "$version_output" >&2
      ;;
    *)
      die "expected $MTPLX to be MTPLX $REQUIRED_MTPLX_VERSION, got: $version_output; rerun scripts/setup-mac-mtplx-env.sh and avoid bare 'mtplx' from PATH"
      ;;
  esac
}

build_launch_spec() {
  local download_arg

  download_arg=""
  if [ "$DOWNLOAD_MODEL" != "0" ]; then
    download_arg="--download"
  fi

  "$MTPLX" quickstart \
    $download_arg \
    --model "$MTPLX_HF_MODEL" \
    --model-id "$MODEL" \
    --profile sustained \
    --port "$PORT" \
    --dry-run \
    --json
}

ensure_runtime_versions

if port_is_listening; then
  die "port $PORT is already in use; stop that process before starting MTPLX"
fi

launch_spec="$(build_launch_spec)" || die "could not build MTPLX server command"
MTPLX_LAUNCH_SPEC="$launch_spec" exec "$PYTHON" - <<'PY'
import json
import os

spec = json.loads(os.environ["MTPLX_LAUNCH_SPEC"])
env = os.environ.copy()
env.update(spec.get("env", {}))
argv = spec["argv"]
os.execvpe(argv[0], argv, env)
PY
