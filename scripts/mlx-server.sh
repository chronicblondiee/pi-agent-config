#!/usr/bin/env bash
#
# mlx-server — bash wrapper for mlx_lm.server (Mac MLX provider for pi-agent-config).
#
# Portable companion to mlx-server.fish. Targets bash 3.2+ (macOS default) — no
# associative arrays, no bashisms beyond what stock /bin/bash supports.
#
# Install (one-time):
#   mkdir -p ~/.local/bin
#   ln -sf ~/projects/pi-agent-config/scripts/mlx-server.sh ~/.local/bin/mlx-server
#   chmod +x ~/projects/pi-agent-config/scripts/mlx-server.sh
#
# Prereq: a uv-managed venv with mlx-lm installed at $VENV (see README "Build a uv-managed env").

set -u

VENV="${MLX_SERVER_VENV:-$HOME/projects/mac-mlx-env}"
STATE_DIR="${MLX_SERVER_STATE_DIR:-$HOME/.local/state/mlx-server}"
PIDFILE="$STATE_DIR/server.pid"
LOGFILE="$STATE_DIR/server.log"
HOST="${MLX_SERVER_HOST:-127.0.0.1}"
PORT="${MLX_SERVER_PORT:-8080}"

DEFAULT_MODEL_NAME="qwen3.6-27b"

# Friendly name → model path registry. Single source of truth: add new
# models by appending a "name<TAB>path" line to the heredoc below.
# The Youssofal MTPLX build works under plain mlx-lm because the MTP weights
# live in a separate mtp.safetensors that isn't referenced from the index —
# mlx-lm reads only the index and silently skips the MTP shard.
_registry() {
    cat <<EOF
qwen3.6-27b	$HOME/.lmstudio/models/Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed
qwen3.5-9b	$HOME/.lmstudio/models/mlx-community/Qwen3.5-9B-OptiQ-4bit
EOF
}

_resolve_model() {
    while IFS=$'\t' read -r name path; do
        if [ "$name" = "$1" ]; then
            echo "$path"
            return 0
        fi
    done < <(_registry)
    if [ -d "$1" ]; then
        echo "$1"
        return 0
    fi
    return 1
}

mkdir -p "$STATE_DIR"

_running() {
    [ -f "$PIDFILE" ] || return 1
    kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

_listening_pid() {
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1
}

_status() {
    if _running; then
        pid="$(cat "$PIDFILE")"
        listen_pid="$(_listening_pid)"
        if [ "$listen_pid" = "$pid" ]; then
            echo "mlx-server: running (pid $pid, listening on $HOST:$PORT)"
        else
            echo "mlx-server: process up (pid $pid) but not yet bound to $PORT — check 'mlx-server log'"
        fi
        return 0
    fi
    echo "mlx-server: not running"
    return 1
}

_list() {
    echo "Configured models (default marked with *):"
    while IFS=$'\t' read -r name path; do
        if [ "$name" = "$DEFAULT_MODEL_NAME" ]; then
            marker="*"
        else
            marker=" "
        fi
        if [ -d "$path" ]; then
            printf "  %s %-15s %s\n" "$marker" "$name" "$path"
        else
            printf "  %s %-15s %s (MISSING)\n" "$marker" "$name" "$path"
        fi
    done < <(_registry)
}

_usage() {
    cat <<EOF
Usage: mlx-server <command> [args]

Commands:
  start [model]    Start the server (default: $DEFAULT_MODEL_NAME)
  stop             Stop the running server
  restart [model]  Stop then start
  status           Show whether it's running and listening
  log              Tail the server log (Ctrl-C to exit)
  list             Show configured models
  help             Show this help

Model arg accepts a friendly name (see 'list') or any directory path
containing an MLX safetensors model layout.

State dir: $STATE_DIR
Bind:      $HOST:$PORT
Venv:      $VENV

Override with env vars: MLX_SERVER_VENV, MLX_SERVER_STATE_DIR,
MLX_SERVER_HOST, MLX_SERVER_PORT.
EOF
}

_start() {
    if _running; then
        echo "Already running:"
        _status
        return 0
    fi

    name="${1:-$DEFAULT_MODEL_NAME}"

    if ! model_path="$(_resolve_model "$name")"; then
        echo "Unknown model: $name"
        echo ""
        _list
        return 1
    fi

    if [ ! -x "$VENV/bin/mlx_lm.server" ]; then
        echo "mlx_lm.server not found at $VENV/bin/mlx_lm.server"
        echo ""
        echo "Set up the env:"
        echo "  uv venv $VENV --python 3.11"
        echo "  uv pip install --python $VENV/bin/python -U mlx-lm"
        return 1
    fi

    echo "Starting mlx_lm.server"
    echo "  model: $model_path"
    echo "  bind:  $HOST:$PORT"
    echo "  log:   $LOGFILE"

    # Rotate previous log to keep it small
    [ -f "$LOGFILE" ] && mv "$LOGFILE" "$LOGFILE.prev"

    "$VENV/bin/mlx_lm.server" --model "$model_path" --host "$HOST" --port "$PORT" \
        >>"$LOGFILE" 2>&1 &
    server_pid=$!
    echo "$server_pid" >"$PIDFILE"
    disown "$server_pid" 2>/dev/null || true

    # Give it a couple of seconds to bind (or fail fast)
    i=0
    while [ "$i" -lt 6 ]; do
        sleep 0.5
        if [ "$(_listening_pid)" = "$(cat "$PIDFILE")" ]; then
            break
        fi
        if ! _running; then
            echo ""
            echo "Server exited during startup. Last log lines:"
            tail -20 "$LOGFILE"
            rm -f "$PIDFILE"
            return 1
        fi
        i=$((i + 1))
    done
    _status
}

_stop() {
    if ! _running; then
        echo "Not running"
        rm -f "$PIDFILE"
        return 0
    fi
    pid="$(cat "$PIDFILE")"
    kill "$pid"
    i=0
    while [ "$i" -lt 20 ]; do
        _running || break
        sleep 0.5
        i=$((i + 1))
    done
    if _running; then
        echo "Process $pid didn't exit on SIGTERM; sending SIGKILL"
        kill -9 "$pid"
    fi
    rm -f "$PIDFILE"
    echo "Stopped"
}

cmd="${1:-}"
[ "$#" -gt 0 ] && shift

case "$cmd" in
    start)
        _start "${1:-}"
        ;;
    stop)
        _stop
        ;;
    restart)
        _stop
        _start "${1:-}"
        ;;
    status)
        _status
        ;;
    log)
        if [ ! -f "$LOGFILE" ]; then
            echo "No log file at $LOGFILE — server hasn't been started yet"
            exit 1
        fi
        tail -F "$LOGFILE"
        ;;
    list)
        _list
        ;;
    ""|help|-h|--help)
        _usage
        ;;
    *)
        echo "Unknown command: $cmd"
        echo ""
        _usage
        exit 1
        ;;
esac
