#!/bin/bash
# Detect compose command: docker compose, podman compose, docker-compose, podman-compose.
# Source this file: . "$(dirname "$0")/../compose-detect.sh"
# Exports:
#   $COMPOSE           — the compose command
#   $COMPOSE_ENV_FLAG  — "--env-file ../../.env" or ""
#   $COMPOSE_PROJECT_NAME

# Helper: check if Docker daemon is reachable
_docker_daemon_ok() {
    docker info >/dev/null 2>&1
}

if docker compose version >/dev/null 2>&1 && _docker_daemon_ok; then
    COMPOSE="docker compose"
    COMPOSE_ENV_FLAG="--env-file ../../.env"
elif podman compose version >/dev/null 2>&1; then
    COMPOSE="podman compose"
    COMPOSE_ENV_FLAG="--env-file ../../.env"
elif command -v docker-compose >/dev/null 2>&1 && _docker_daemon_ok; then
    COMPOSE="docker-compose"
    COMPOSE_ENV_FLAG=""
elif command -v podman-compose >/dev/null 2>&1; then
    COMPOSE="podman-compose"
    COMPOSE_ENV_FLAG=""
else
    echo "Error: no working compose command found. Install 'docker compose' or 'podman compose'."
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

# Determine project name from the calling script's directory
_CALLER_DIR="$(basename "$(pwd)")"
export COMPOSE_PROJECT_NAME="${_CALLER_DIR}"
