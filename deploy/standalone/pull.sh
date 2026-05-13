#!/bin/bash

# 从 .env 读取配置
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../.env"

if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE" 2>/dev/null
    set +a
fi

if [ "$STANDALONE_MODULES" = "NONE" ]; then
    echo "STANDALONE_MODULES=NONE, skipping all standalone image pulls."
    exit 0
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

# 拉取独立模块镜像
pull "${IMAGE_FE:-ghcr.io/beyonclaw/byclaw-all/byclaw-fe:main}"
pull "${IMAGE_BE:-ghcr.io/beyonclaw/byclaw-all/byclaw-be:main}"
pull "${IMAGE_QA:-ghcr.io/beyonclaw/byclaw-all/byclaw-qa:main}"
pull "${IMAGE_DATA:-ghcr.io/beyonclaw/byclaw-all/byclaw-data:main}"

pull "${IMAGE_DEMO:-ghcr.io/beyonai/byclaw-middleware/byclaw-demo:main}"

if [ "$FAILED" -gt 0 ]; then
    echo ""
    echo "WARNING: $FAILED image(s) failed to pull. Continuing with existing local images."
fi
