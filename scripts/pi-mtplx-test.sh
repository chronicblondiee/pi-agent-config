#!/usr/bin/env bash
set -u

MODEL="mtplx-qwen36-27b-optimized-speed-fp16"
MTPLX_HF_MODEL="${MTPLX_HF_MODEL:-Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed-FP16}"
PROVIDER="mtplx-test"
REQUIRED_MTPLX_VERSION="2.1.0"
REQUIRED_PYTHON_MINOR="3.12"
HOST="127.0.0.1"
PORT="${MTPLX_PORT:-18080}"
VENV="${MTPLX_SERVER_VENV:-$HOME/projects/mac-mtplx-env}"
MTPLX="$VENV/bin/mtplx"
PYTHON="$VENV/bin/python"
BASE_URL="http://$HOST:$PORT"
OPENAI_BASE_URL="$BASE_URL/v1"
TEST_AGENT_DIR="${PI_MTPLX_TEST_AGENT_DIR:-$HOME/.pi/agent-mtplx-test}"
TEMPLATE_DIR="$(cd "$(dirname "$0")/.." && pwd)/pi-config"
MODELS_TEMPLATE="$TEMPLATE_DIR/models.mtplx-test.json"
LOG="${MTPLX_LOG:-$HOME/.local/state/pi-agent-config/mtplx-test-server.log}"
WAIT_SECONDS="${MTPLX_WAIT_SECONDS:-240}"
CURL_TIMEOUT="${MTPLX_CURL_TIMEOUT:-10}"
DOWNLOAD_MODEL="${MTPLX_DOWNLOAD:-1}"

die() {
  printf 'pi-mtplx-test: %s\n' "$*" >&2
  exit 1
}

fetch_json() {
  curl -fsS --max-time "$CURL_TIMEOUT" "$1" 2>/dev/null
}

have_expected_model() {
  local body="$1"

  if command -v python3 >/dev/null 2>&1; then
    EXPECTED_MODEL="$MODEL" python3 -c '
import json
import os
import sys

expected = os.environ["EXPECTED_MODEL"]
try:
    payload = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(1)

for item in payload.get("data", []):
    if item.get("id") == expected:
        sys.exit(0)
sys.exit(1)
' <<EOF
$body
EOF
    return $?
  fi

  case "$body" in
    *"\"id\":\"$MODEL\""*|*"\"id\": \"$MODEL\""*) return 0 ;;
    *) return 1 ;;
  esac
}

port_is_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  return 1
}

ensure_test_config() {
  [ -f "$MODELS_TEMPLATE" ] || die "missing template: $MODELS_TEMPLATE"
  mkdir -p "$TEST_AGENT_DIR" || die "could not create $TEST_AGENT_DIR"
  cp "$MODELS_TEMPLATE" "$TEST_AGENT_DIR/models.json" || die "could not install MTPLX test models.json"
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

inspect_model() {
  "$MTPLX" inspect "$MTPLX_HF_MODEL" || die "mtplx inspect rejected $MTPLX_HF_MODEL; choose another catalog build with MTPLX_HF_MODEL=..."
}

wait_for_server() {
  local deadline
  local health
  local models
  local server_pid="$1"

  deadline=$((SECONDS + WAIT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! kill -0 "$server_pid" 2>/dev/null; then
      die "MTPLX exited before becoming ready; see $LOG"
    fi

    health="$(fetch_json "$BASE_URL/health")"
    models="$(fetch_json "$OPENAI_BASE_URL/models")"
    if [ $? -eq 0 ] && [ -n "$health" ] && have_expected_model "$models"; then
      printf 'MTPLX is ready at %s with model id %s\n' "$OPENAI_BASE_URL" "$MODEL" >&2
      return 0
    fi
    sleep 2
  done

  die "timed out after ${WAIT_SECONDS}s waiting for MTPLX at $OPENAI_BASE_URL; see $LOG"
}

ensure_server() {
  local models
  local download_arg
  local server_pid

  models="$(fetch_json "$OPENAI_BASE_URL/models")"
  if [ $? -eq 0 ]; then
    if have_expected_model "$models"; then
      printf 'Reusing MTPLX on %s serving %s\n' "$OPENAI_BASE_URL" "$MODEL" >&2
      return 0
    fi

    die "port $PORT responds at /v1/models but is not serving $MODEL"
  fi

  if port_is_listening; then
    die "port $PORT is already in use but does not serve $OPENAI_BASE_URL/models; stop that process or choose another port"
  fi

  inspect_model

  mkdir -p "$(dirname "$LOG")" || die "could not create log directory for $LOG"
  printf 'Starting MTPLX for %s at %s; logs: %s\n' "$MTPLX_HF_MODEL" "$OPENAI_BASE_URL" "$LOG" >&2

  download_arg=""
  if [ "$DOWNLOAD_MODEL" != "0" ]; then
    download_arg="--download"
  fi

  nohup "$MTPLX" quickstart \
    $download_arg \
    --model "$MTPLX_HF_MODEL" \
    --profile sustained \
    --port "$PORT" \
    >>"$LOG" 2>&1 &
  server_pid=$!

  wait_for_server "$server_pid"
}

smoke_chat_completion() {
  curl -fsS --max-time "$CURL_TIMEOUT" "$OPENAI_BASE_URL/chat/completions" \
    -H 'Content-Type: application/json' \
    -d '{"model":"mtplx-qwen36-27b-optimized-speed-fp16","messages":[{"role":"user","content":"Reply with exactly: ok"}],"max_tokens":64}' \
    >/dev/null || die "MTPLX /v1/chat/completions smoke test failed; see $LOG"
}

ensure_test_config
ensure_runtime_versions
ensure_server
smoke_chat_completion

export PI_CODING_AGENT_DIR="$TEST_AGENT_DIR"
exec pi --provider "$PROVIDER" --model "$MODEL" "$@"
