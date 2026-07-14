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

# Load .env and derive COMPOSE_PROJECT_NAME from CONTAINER_SUFFIX.
# Scripts that already source .env will just overwrite — harmless.
_DEPLOY_DIR="$(cd "$(pwd)/.." && pwd)"
_DETECT_ENV_FILE="$_DEPLOY_DIR/../.env"

# 如果 .env 包含 ENC(...) 密文字段, 自动解密到 .env.runtime
_DETECT_ENV_RUNTIME="$_DEPLOY_DIR/../.env.runtime"
_USE_RUNTIME_ENV=false

if [ -f "$_DETECT_ENV_FILE" ] && grep -q 'ENC(' "$_DETECT_ENV_FILE" 2>/dev/null; then
    . "$_DEPLOY_DIR/env-decrypt.sh" "$_DETECT_ENV_FILE" "$_DETECT_ENV_RUNTIME"
    if [ "${_ENV_DECRYPT_NEEDED:-false}" = "true" ] && [ -f "$_DETECT_ENV_RUNTIME" ]; then
        _USE_RUNTIME_ENV=true
    fi
fi

# 决定实际要 source 和传给 docker-compose 的 env file
if [ "$_USE_RUNTIME_ENV" = true ]; then
    _ACTIVE_ENV_FILE="$_DETECT_ENV_RUNTIME"
else
    _ACTIVE_ENV_FILE="$_DETECT_ENV_FILE"
fi

if [ -f "$_ACTIVE_ENV_FILE" ]; then
    set -a
    . "$_ACTIVE_ENV_FILE" 2>/dev/null
    set +a
fi

. "$_DEPLOY_DIR/storage-profile.sh"

# 更新 COMPOSE_ENV_FLAG 指向解密后的文件
if [ "$_USE_RUNTIME_ENV" = true ]; then
    COMPOSE_ENV_FLAG="--env-file $_DETECT_ENV_RUNTIME"
fi

# Determine project name from the calling script's directory
_CALLER_DIR="$(basename "$(pwd)")"
export COMPOSE_PROJECT_NAME="${_CALLER_DIR}"
