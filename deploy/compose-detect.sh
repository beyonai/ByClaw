#!/bin/bash
# Detect compose command: docker compose, podman compose, docker-compose, podman-compose.
# Source this file: . "$(dirname "$0")/../compose-detect.sh"
# Exports:
#   $COMPOSE           — the compose command
#   $COMPOSE_ENV_FLAG  — "--env-file ../../.env" or "--env-file <runtime>"
#   $COMPOSE_PROJECT_NAME

_docker_daemon_ok() {
    docker info >/dev/null 2>&1
}

if docker help compose >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && _docker_daemon_ok; then
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

_DEPLOY_DIR="$(cd "$(pwd)/.." && pwd)"
_DETECT_ENV_FILE="$_DEPLOY_DIR/../.env"
_DETECT_ENV_RUNTIME="$_DEPLOY_DIR/../.env.runtime"
_OVERRIDE_FILE="$(pwd)/docker-compose.override.yml"

# Cleanup: delete plaintext files after docker compose up -d finishes
_cleanup_runtime() {
    rm -f "$_DETECT_ENV_RUNTIME" "$_OVERRIDE_FILE"
}
trap _cleanup_runtime EXIT INT TERM

if [ -f "$_DETECT_ENV_FILE" ] && grep -q 'ENC(' "$_DETECT_ENV_FILE" 2>/dev/null; then
    _ENV_DECRYPT_SRC="$_DETECT_ENV_FILE" _ENV_DECRYPT_DST="$_DETECT_ENV_RUNTIME" \
        . "$_DEPLOY_DIR/env-decrypt.sh" 2>/dev/null
    if [ "${_ENV_DECRYPT_NEEDED:-false}" = "true" ] && [ -f "$_DETECT_ENV_RUNTIME" ]; then
        COMPOSE_ENV_FLAG="--env-file $_DETECT_ENV_RUNTIME"
        set -a
        . "$_DETECT_ENV_RUNTIME" 2>/dev/null
        set +a
        # Override env_file for containers to read decrypted values
        if [ -f docker-compose.yml ]; then
            printf "services:\n" > "$_OVERRIDE_FILE"
            # Extract service names that have env_file in their definition
            sed -n '/^services:/,/^[a-z]/p' docker-compose.yml | grep -E '^  [a-z]' | sed 's/:.*//;s/^  //' | while read -r _svc; do
                printf "  %s:\n    env_file:\n      - %s\n" "$_svc" "$_DETECT_ENV_RUNTIME" >> "$_OVERRIDE_FILE"
            done
            chmod 600 "$_OVERRIDE_FILE"
        fi
    fi
else
    if [ -f "$_DETECT_ENV_FILE" ]; then
        set -a
        . "$_DETECT_ENV_FILE" 2>/dev/null
        set +a
    fi
fi

. "$_DEPLOY_DIR/storage-profile.sh"

_CALLER_DIR="$(basename "$(pwd)")"
export COMPOSE_PROJECT_NAME="${_CALLER_DIR}"
