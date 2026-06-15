#!/bin/sh

# 根据 .env 中的 BYCLAW_DEPLOY_STORAGE 应用一键部署存储方案。
# 这个脚本只读取 .env/环境变量，不接受命令行 storage 参数。
# 可选值：
#   BYCLAW_DEPLOY_STORAGE=minio      兼容旧版 MinIO + rclone 运行态挂载
#   BYCLAW_DEPLOY_STORAGE=nfs        OpenClaw /by 和 BE 文件 CRUD 都使用 NFS
#   BYCLAW_DEPLOY_STORAGE=nfs-hybrid OpenClaw /by 使用 NFS，上传/下载接口继续使用 MinIO

_storage_mode="$(printf '%s' "${BYCLAW_DEPLOY_STORAGE:-}" | tr '[:upper:]' '[:lower:]')"
if [ -z "$_storage_mode" ]; then
    return 0 2>/dev/null || exit 0
fi

case "$_storage_mode" in
    minio)
        export FILE_STORAGE_TYPE="minio"
        export BYCLAW_SANDBOX_VOLUME_BACKEND="minio-mount"
        export FILE_STORAGE_MINIO_MOUNT_ENABLED="true"
        ;;
    nfs)
        export FILE_STORAGE_TYPE="file"
        export BYCLAW_SANDBOX_VOLUME_BACKEND="file"
        export BYCLAW_SANDBOX_FILE_VOLUME_ROOT="${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:-/mnt/byclaw-file}"
        export FILE_STORAGE_LOCAL_PATH="${FILE_STORAGE_LOCAL_PATH:-$BYCLAW_SANDBOX_FILE_VOLUME_ROOT}"
        export BYCLAW_SANDBOX_FILE_VOLUME_TYPE="${BYCLAW_SANDBOX_FILE_VOLUME_TYPE:-nfs}"
        export BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER="${BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER:-nas}"
        export FILE_STORAGE_MINIO_MOUNT_ENABLED="false"
        if [ -z "${MIDDLEWARE_MODULES:-}" ] && [ "${BYCLAW_DEPLOY_START_MINIO:-false}" != "true" ]; then
            export MIDDLEWARE_MODULES="redis,opengauss,opensandbox-server"
        fi
        ;;
    nfs-hybrid)
        export FILE_STORAGE_TYPE="minio"
        export BYCLAW_SANDBOX_VOLUME_BACKEND="file"
        export BYCLAW_SANDBOX_FILE_VOLUME_ROOT="${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:-/mnt/byclaw-file}"
        export FILE_STORAGE_LOCAL_PATH="${FILE_STORAGE_LOCAL_PATH:-$BYCLAW_SANDBOX_FILE_VOLUME_ROOT}"
        export BYCLAW_SANDBOX_FILE_VOLUME_TYPE="${BYCLAW_SANDBOX_FILE_VOLUME_TYPE:-nfs}"
        export BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER="${BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER:-nas}"
        export FILE_STORAGE_MINIO_MOUNT_ENABLED="false"
        ;;
    *)
        echo "Error: unsupported BYCLAW_DEPLOY_STORAGE=$_storage_mode. Use minio, nfs, or nfs-hybrid." >&2
        exit 1
        ;;
esac

echo "Storage profile: $_storage_mode"
echo "  FILE_STORAGE_TYPE=${FILE_STORAGE_TYPE:-}"
echo "  BYCLAW_SANDBOX_VOLUME_BACKEND=${BYCLAW_SANDBOX_VOLUME_BACKEND:-}"
echo "  BYCLAW_SANDBOX_FILE_VOLUME_ROOT=${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:-}"
echo "  BYCLAW_SANDBOX_FILE_VOLUME_TYPE=${BYCLAW_SANDBOX_FILE_VOLUME_TYPE:-}"
echo "  FILE_STORAGE_MINIO_MOUNT_ENABLED=${FILE_STORAGE_MINIO_MOUNT_ENABLED:-}"
if [ "$_storage_mode" = "nfs" ]; then
    echo "  MIDDLEWARE_MODULES=${MIDDLEWARE_MODULES:-all}"
fi
