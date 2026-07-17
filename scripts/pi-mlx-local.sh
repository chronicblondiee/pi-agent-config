#!/usr/bin/env bash
set -u

MODEL="mlx-community/Qwen3.6-27B-4bit"
PROVIDER="mlx-local"
HOST="127.0.0.1"
PORT="8080"
VENV="$HOME/projects/mac-mlx-env"
SERVER="$VENV/bin/mlx_lm.server"
BASE_URL="http://$HOST:$PORT/v1"
LOG="$HOME/.local/state/pi-agent-config/mlx-lm-server.log"
WAIT_SECONDS="180"
CURL_TIMEOUT="10"

die() {
  printf 'pi-mlx-local: %s\n' "$*" >&2
  exit 1
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

fetch_models() {
  curl -fsS --max-time "$CURL_TIMEOUT" "$BASE_URL/models" 2>/dev/null
}

port_is_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  return 1
}

ensure_server() {
  local models

  models="$(fetch_models)"
  if [ $? -eq 0 ]; then
    if have_expected_model "$models"; then
      printf 'Reusing mlx_lm.server on %s serving %s\n' "$BASE_URL" "$MODEL" >&2
      return 0
    fi

    die "port $PORT responds at /v1/models but is not serving $MODEL"
  fi

  if port_is_listening; then
    die "port $PORT is already in use but does not serve $BASE_URL/models; stop that process or choose another port"
  fi

  [ -x "$SERVER" ] || die "missing executable: $SERVER; run scripts/setup-mac-mlx-env.sh first"

  mkdir -p "$(dirname "$LOG")" || die "could not create log directory for $LOG"
  printf 'Starting mlx_lm.server for %s at %s; logs: %s\n' "$MODEL" "$BASE_URL" "$LOG" >&2

  # mlx_lm.server (not mlx-openai-server) is used deliberately here: mlx-openai-server's
  # own batch-scheduler threading is broken for Devstral's sliding-window attention cache
  # (RuntimeError: no Stream(gpu, N) in current thread), even with a patched mlx-lm.
  # Trade-off: mlx_lm.server has no --context-length or --kv-bits flags, so there is no
  # hard server-side cap and no KV quantization; context safety relies on the measured
  # ceiling documented in the README instead.
  nohup "$SERVER" \
    --model "$MODEL" \
    --host "$HOST" \
    --port "$PORT" \
    --prompt-concurrency 1 \
    --decode-concurrency 4 \
    >>"$LOG" 2>&1 &

  wait_for_model
}

wait_for_model() {
  local deadline
  local models

  deadline=$((SECONDS + WAIT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    models="$(fetch_models)"
    if [ $? -eq 0 ] && have_expected_model "$models"; then
      printf 'mlx_lm.server is ready at %s\n' "$BASE_URL" >&2
      return 0
    fi
    sleep 2
  done

  die "timed out after ${WAIT_SECONDS}s waiting for $MODEL at $BASE_URL/models; see $LOG"
}

ensure_server
exec pi --provider "$PROVIDER" --model "$MODEL" "$@"
