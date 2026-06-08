#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

load_env_file() {
    local env_file="$1"
    if [[ -f "$env_file" ]]; then
        set -a
        # shellcheck disable=SC1090
        source "$env_file"
        set +a
    fi
}

load_env_file "$SCRIPT_DIR/.env"

# Ensure local backends bypass any shell proxy (clash etc.)
for _no_proxy_var in NO_PROXY no_proxy; do
    _existing="${!_no_proxy_var-}"
    _merged="127.0.0.1,localhost"
    if [[ -n "$_existing" ]]; then
        _merged="$_existing,$_merged"
    fi
    export "$_no_proxy_var=$_merged"
done
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy

usage() {
    cat <<'EOF'
Usage:
  ./start.sh api

Modes:
  api     Start the Knowledge Gateway API service
EOF
}

MODE="${1:-api}"

case "$MODE" in
    api)
        ;;
    -h|--help|help)
        usage
        exit 0
        ;;
    *)
        usage
        exit 1
        ;;
esac

# Force container bind to 0.0.0.0. Repo-level HOST should only feed
# HOST_MACHINE aliasing, never leak through as the runtime bind host.
ROOT_HOST_VALUE="${HOST-}"
unset HOST
export HOST="0.0.0.0"
: "${PORT:=8200}"

cd "$SCRIPT_DIR"
export PYTHONPATH="$SCRIPT_DIR/src${PYTHONPATH:+:$PYTHONPATH}"

resolve_uvicorn_runner() {
    local venv_uvicorn="$SCRIPT_DIR/.venv/bin/uvicorn"
    if [[ -x "$venv_uvicorn" ]]; then
        printf '%s\n' "$venv_uvicorn"
        return 0
    fi

    printf 'uv run uvicorn\n'
}

UVICORN_RUNNER="$(resolve_uvicorn_runner)"

if [[ "$UVICORN_RUNNER" == "uv run uvicorn" ]]; then
    exec uv run uvicorn kgw.main:app --host "$HOST" --port "$PORT"
fi
exec "$UVICORN_RUNNER" kgw.main:app --host "$HOST" --port "$PORT"
