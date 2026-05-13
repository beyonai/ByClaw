#!/bin/bash

# 从 .env 读取 GHCR 认证信息
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../.env"

if [ -f "$ENV_FILE" ]; then
    export $(grep -E '^GHCR_' "$ENV_FILE" | xargs)
fi

if [ -z "$GHCR_USER" ] || [ -z "$GHCR_TOKEN" ]; then
    echo "Error: GHCR_USER and GHCR_TOKEN must be set in .env"
    exit 1
fi

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

FAILED=0

pull() {
    echo "Pulling $1 ..."
    if ! docker pull "$1"; then
        echo "WARNING: Failed to pull $1, skipping."
        FAILED=$((FAILED + 1))
    fi
}

# 拉取 all-in-one 镜像
pull "${IMAGE_ALL:-ghcr.io/beyonclaw/byclaw-all/byclaw-all:main}"

if [ "$FAILED" -gt 0 ]; then
    echo ""
    echo "WARNING: $FAILED image(s) failed to pull. Continuing with existing local images."
fi
