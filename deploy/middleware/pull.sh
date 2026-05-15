#!/bin/bash

# 从 .env 读取配置
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../.env"

if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE" 2>/dev/null
    set +a
fi

if [ "$MIDDLEWARE_MODULES" = "NONE" ]; then
    echo "MIDDLEWARE_MODULES=NONE, skipping all middleware image pulls."
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

# 拉取中间件镜像
pull "${IMAGE_REDIS:-ghcr.io/beyonai/byclaw/byclaw-redis:main}"
pull "${IMAGE_MINIO:-ghcr.io/beyonai/byclaw/byclaw-minio:main}"
pull "${IMAGE_OPENGAUSS:-ghcr.io/beyonai/byclaw/byclaw-opengauss:main}"
pull "${IMAGE_OPENCLAW:-ghcr.io/beyonai/byclaw-middleware/byclaw-openclaw:main}"

pull "${IMAGE_SANDBOX_SERVER:-sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/server:v0.1.9}"
pull "${IMAGE_SANDBOX_EXECD:-sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/execd:v1.0.9}"
pull "${IMAGE_SANDBOX_EGRESS:-sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/egress:v1.0.3}"

if [ "$FAILED" -gt 0 ]; then
    echo ""
    echo "WARNING: $FAILED image(s) failed to pull. Continuing with existing local images."
fi
