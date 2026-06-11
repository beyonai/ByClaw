#!/bin/bash

# 从 .env 读取配置
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../.env"

if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE" 2>/dev/null
    set +a
fi

# 按 .env 中的 BYCLAW_DEPLOY_STORAGE 衍生中间件模块开关。
. "$SCRIPT_DIR/../storage-profile.sh"

if [ "${MIDDLEWARE_MODULES:-}" = "NONE" ]; then
    echo "MIDDLEWARE_MODULES=NONE, skipping all middleware image pulls."
    exit 0
fi

FAILED=0

should_pull() {
    if [ -z "${MIDDLEWARE_MODULES:-}" ]; then
        return 0
    fi
    printf ',%s,' "$MIDDLEWARE_MODULES" | grep -q ",$1,"
}

pull() {
    echo "Pulling $1 ..."
    if ! docker pull "$1"; then
        echo "WARNING: Failed to pull $1, skipping."
        FAILED=$((FAILED + 1))
    fi
}

# 拉取中间件镜像。MIDDLEWARE_MODULES 为空表示全部拉取；否则只拉取指定模块。
if should_pull redis; then
    pull "${IMAGE_REDIS:-ghcr.io/beyonai/byclaw/byclaw-redis:main}"
fi
if should_pull minio; then
    pull "${IMAGE_MINIO:-ghcr.io/beyonai/byclaw/byclaw-minio:main}"
fi
if should_pull opengauss; then
    pull "${IMAGE_OPENGAUSS:-ghcr.io/beyonai/byclaw/byclaw-opengauss:main}"
fi
if should_pull opensandbox-server; then
    pull "${IMAGE_OPENCLAW:-ghcr.io/beyonai/byclaw/byclaw-openclaw:main}"
    pull "${IMAGE_SANDBOX_SERVER:-sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/server:v0.1.9}"
    pull "${IMAGE_SANDBOX_EXECD:-sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/execd:v1.0.9}"
    pull "${IMAGE_SANDBOX_EGRESS:-sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/egress:v1.0.3}"
fi

if [ "$FAILED" -gt 0 ]; then
    echo ""
    echo "WARNING: $FAILED image(s) failed to pull. Continuing with existing local images."
fi
