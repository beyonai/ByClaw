#!/bin/bash
# Detect docker compose command (V2 plugin vs V1 standalone).
# Source this file: . "$(dirname "$0")/../compose-detect.sh"
# Exports:
#   $COMPOSE           — "docker compose" or "docker-compose"
#   $COMPOSE_ENV_FLAG  — "--env-file ../../.env" (V2) or "" (V1, relies on sourced env)
#   $COMPOSE_PROJECT_NAME

if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
    COMPOSE_ENV_FLAG="--env-file ../../.env"
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
    COMPOSE_ENV_FLAG=""
else
    echo "Error: neither 'docker compose' nor 'docker-compose' found."
    exit 1
fi

# Load .env and derive COMPOSE_PROJECT_NAME from CONTAINER_SUFFIX.
# Scripts that already source .env will just overwrite — harmless.
_DETECT_ENV_FILE="$(cd "$(dirname "$0")" && pwd)/../../.env"
if [ -f "$_DETECT_ENV_FILE" ]; then
    set -a
    . "$_DETECT_ENV_FILE" 2>/dev/null
    set +a
fi

# Determine project name prefix from the calling script's directory
_CALLER_DIR="$(basename "$(pwd)")"
case "$_CALLER_DIR" in
    middleware)  _PREFIX="byclaw-middleware" ;;
    standalone)  _PREFIX="byclaw-standalone" ;;
    mono)        _PREFIX="byclaw-mono" ;;
    *)           _PREFIX="byclaw" ;;
esac
export COMPOSE_PROJECT_NAME="${_PREFIX}-${CONTAINER_SUFFIX:-default}"
