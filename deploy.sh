#!/bin/sh

# ByClaw 统一部署入口。
# 用法：
#   sh deploy.sh init    # 初始化部署：可按 .env 初始化 NFS、拉镜像、启动服务
#   sh deploy.sh nfs-init # 仅初始化 NFS：不拉镜像，不启动或重建服务
#   sh deploy.sh update  # 增量更新：按 .env 重新生成配置并重建服务，不重复初始化 NFS
#   sh deploy.sh stop    # 停止服务
#
# 存储方案、是否初始化 NFS、是否启动 MinIO 等细节全部由 .env 驱动。

set -eu

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
ACTION="${1:-}"

usage() {
    echo "Usage: sh deploy.sh init|nfs-init|update|stop"
}

if [ -z "$ACTION" ]; then
    usage
    exit 1
fi

load_env() {
    if [ -f "$ROOT_DIR/.env" ]; then
        set -a
        . "$ROOT_DIR/.env" 2>/dev/null
        set +a
    fi
    . "$DEPLOY_DIR/storage-profile.sh"
}

start_services() {
    echo "========== Starting Middleware =========="
    (cd "$DEPLOY_DIR/middleware" && sh start-all.sh)

    echo ""
    echo "========== Starting Standalone =========="
    (cd "$DEPLOY_DIR/standalone" && sh start-all.sh)
}

pull_images() {
    echo "========== Pulling Middleware Images =========="
    (cd "$DEPLOY_DIR/middleware" && sh pull.sh)

    echo ""
    echo "========== Pulling Standalone Images =========="
    (cd "$DEPLOY_DIR/standalone" && sh pull.sh)
}

case "$ACTION" in
    init)
        load_env
        if [ "${BYCLAW_DEPLOY_INIT_NFS:-false}" = "true" ]; then
            echo "========== Initializing NFS =========="
            (cd "$DEPLOY_DIR" && sh init-nfs.sh)
            echo ""
        fi
        pull_images
        start_services
        ;;
    nfs-init)
        load_env
        echo "========== Initializing NFS Only =========="
        (cd "$DEPLOY_DIR" && sh init-nfs.sh)
        ;;
    update)
        load_env
        pull_images
        start_services
        ;;
    stop)
        echo "========== Stopping Standalone =========="
        (cd "$DEPLOY_DIR/standalone" && sh stop-all.sh)
        echo ""
        echo "========== Stopping Middleware =========="
        (cd "$DEPLOY_DIR/middleware" && sh stop-all.sh)
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        echo "Unknown action: $ACTION"
        usage
        exit 1
        ;;
esac
