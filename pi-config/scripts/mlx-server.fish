#!/usr/bin/env fish
#
# mlx-server — fish wrapper for mlx_lm.server (Mac MLX provider for pi-agent-config).
#
# Install (one-time):
#   mkdir -p ~/.local/bin
#   ln -sf ~/projects/pi-agent-config/pi-config/scripts/mlx-server.fish ~/.local/bin/mlx-server
#   chmod +x ~/projects/pi-agent-config/pi-config/scripts/mlx-server.fish
#
# Prereq: a uv-managed venv with mlx-lm installed at $VENV (see README "Build a uv-managed env").

set -l VENV      "$HOME/projects/mac-mlx-env"
set -l STATE_DIR "$HOME/.local/state/mlx-server"
set -l PIDFILE   "$STATE_DIR/server.pid"
set -l LOGFILE   "$STATE_DIR/server.log"
set -l HOST      127.0.0.1
set -l PORT      8080

# Friendly name → model path. Add new pairs to register more models.
# The Youssofal MTPLX build works under plain mlx-lm because the MTP weights
# live in a separate mtp.safetensors that isn't referenced from the index —
# mlx-lm reads only the index and silently skips the MTP shard.
set -l MODELS \
    qwen3.6-27b "$HOME/.lmstudio/models/Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed" \
    qwen3.5-9b  "$HOME/.lmstudio/models/mlx-community/Qwen3.5-9B-OptiQ-4bit"

set -l DEFAULT_MODEL_NAME qwen3.6-27b

mkdir -p $STATE_DIR

function _resolve_model --argument-names name --no-scope-shadowing
    for i in (seq 1 2 (count $MODELS))
        if test "$MODELS[$i]" = "$name"
            echo $MODELS[(math $i + 1)]
            return 0
        end
    end
    if test -d "$name"
        echo $name
        return 0
    end
    return 1
end

function _running --no-scope-shadowing
    test -f $PIDFILE; or return 1
    kill -0 (cat $PIDFILE) 2>/dev/null
end

function _listening_pid --no-scope-shadowing
    lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1
end

function _status --no-scope-shadowing
    if _running
        set -l pid (cat $PIDFILE)
        set -l listen_pid (_listening_pid)
        if test "$listen_pid" = "$pid"
            echo "mlx-server: running (pid $pid, listening on $HOST:$PORT)"
        else
            echo "mlx-server: process up (pid $pid) but not yet bound to $PORT — check 'mlx-server log'"
        end
        return 0
    end
    echo "mlx-server: not running"
    return 1
end

function _list --no-scope-shadowing
    echo "Configured models (default marked with *):"
    for i in (seq 1 2 (count $MODELS))
        set -l name $MODELS[$i]
        set -l path $MODELS[(math $i + 1)]
        set -l marker " "
        test "$name" = "$DEFAULT_MODEL_NAME"; and set marker "*"
        if test -d "$path"
            printf "  %s %-15s %s\n" $marker $name $path
        else
            printf "  %s %-15s %s (MISSING)\n" $marker $name $path
        end
    end
end

function _usage --no-scope-shadowing
    echo "Usage: mlx-server <command> [args]"
    echo ""
    echo "Commands:"
    echo "  start [model]    Start the server (default: $DEFAULT_MODEL_NAME)"
    echo "  stop             Stop the running server"
    echo "  restart [model]  Stop then start"
    echo "  status           Show whether it's running and listening"
    echo "  log              Tail the server log (Ctrl-C to exit)"
    echo "  list             Show configured models"
    echo ""
    echo "Model arg accepts a friendly name (see 'list') or any directory path"
    echo "containing an MLX safetensors model layout."
    echo ""
    echo "State dir: $STATE_DIR"
    echo "Bind:      $HOST:$PORT"
    echo "Venv:      $VENV"
end

function _start --no-scope-shadowing
    if _running
        echo "Already running:"
        _status
        return 0
    end

    set -l name $argv[1]
    test -z "$name"; and set name $DEFAULT_MODEL_NAME

    set -l model_path (_resolve_model $name)
    if test $status -ne 0
        echo "Unknown model: $name"
        echo ""
        _list
        return 1
    end

    if not test -x "$VENV/bin/mlx_lm.server"
        echo "mlx_lm.server not found at $VENV/bin/mlx_lm.server"
        echo ""
        echo "Set up the env:"
        echo "  uv venv $VENV --python 3.11"
        echo "  uv pip install --python $VENV/bin/python -U mlx-lm"
        return 1
    end

    echo "Starting mlx_lm.server"
    echo "  model: $model_path"
    echo "  bind:  $HOST:$PORT"
    echo "  log:   $LOGFILE"

    # Rotate previous log to keep it small
    test -f $LOGFILE; and mv $LOGFILE $LOGFILE.prev

    $VENV/bin/mlx_lm.server --model "$model_path" --host $HOST --port $PORT >>$LOGFILE 2>&1 &
    echo $last_pid >$PIDFILE
    disown

    # Give it a couple of seconds to bind (or fail fast)
    for i in (seq 1 6)
        sleep 0.5
        if test (_listening_pid) = (cat $PIDFILE)
            break
        end
        if not _running
            echo ""
            echo "Server exited during startup. Last log lines:"
            tail -20 $LOGFILE
            rm -f $PIDFILE
            return 1
        end
    end
    _status
end

function _stop --no-scope-shadowing
    if not _running
        echo "Not running"
        rm -f $PIDFILE
        return 0
    end
    set -l pid (cat $PIDFILE)
    kill $pid
    for i in (seq 1 20)
        _running; or break
        sleep 0.5
    end
    if _running
        echo "Process $pid didn't exit on SIGTERM; sending SIGKILL"
        kill -9 $pid
    end
    rm -f $PIDFILE
    echo "Stopped"
end

set -l cmd $argv[1]
set -e argv[1]

switch $cmd
    case start
        _start $argv
    case stop
        _stop
    case restart
        _stop
        _start $argv
    case status
        _status
    case log
        if not test -f $LOGFILE
            echo "No log file at $LOGFILE — server hasn't been started yet"
            exit 1
        end
        tail -F $LOGFILE
    case list
        _list
    case '' help -h --help
        _usage
    case '*'
        echo "Unknown command: $cmd"
        echo ""
        _usage
        exit 1
end
