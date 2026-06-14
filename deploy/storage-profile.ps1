param()

# 根据 .env 中的 BYCLAW_DEPLOY_STORAGE 应用一键部署存储方案。
# 这个脚本只读取 .env/环境变量，不接受命令行 storage 参数。
# 可选值：
#   BYCLAW_DEPLOY_STORAGE=minio      兼容旧版 MinIO + rclone 运行态挂载
#   BYCLAW_DEPLOY_STORAGE=nfs        OpenClaw /by 和 BE 文件 CRUD 都使用 NFS
#   BYCLAW_DEPLOY_STORAGE=nfs-hybrid OpenClaw /by 使用 NFS，上传/下载接口继续使用 MinIO

$mode = if ($env:BYCLAW_DEPLOY_STORAGE) { $env:BYCLAW_DEPLOY_STORAGE.ToLowerInvariant() } else { "" }
if (-not $mode) {
    return
}

switch ($mode) {
    "minio" {
        $env:FILE_STORAGE_TYPE = "minio"
        $env:BYCLAW_SANDBOX_VOLUME_BACKEND = "minio-mount"
        $env:FILE_STORAGE_MINIO_MOUNT_ENABLED = "true"
    }
    "nfs" {
        $env:FILE_STORAGE_TYPE = "file"
        $env:BYCLAW_SANDBOX_VOLUME_BACKEND = "file"
        if (-not $env:BYCLAW_SANDBOX_FILE_VOLUME_ROOT) { $env:BYCLAW_SANDBOX_FILE_VOLUME_ROOT = "/mnt/byclaw-file" }
        if (-not $env:FILE_STORAGE_LOCAL_PATH) { $env:FILE_STORAGE_LOCAL_PATH = $env:BYCLAW_SANDBOX_FILE_VOLUME_ROOT }
        if (-not $env:BYCLAW_SANDBOX_FILE_VOLUME_TYPE) { $env:BYCLAW_SANDBOX_FILE_VOLUME_TYPE = "nfs" }
        if (-not $env:BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER) { $env:BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER = "nas" }
        $env:FILE_STORAGE_MINIO_MOUNT_ENABLED = "false"
        if (-not $env:MIDDLEWARE_MODULES -and $env:BYCLAW_DEPLOY_START_MINIO -ne "true") {
            $env:MIDDLEWARE_MODULES = "redis,opengauss,opensandbox-server"
        }
    }
    "nfs-hybrid" {
        $env:FILE_STORAGE_TYPE = "minio"
        $env:BYCLAW_SANDBOX_VOLUME_BACKEND = "file"
        if (-not $env:BYCLAW_SANDBOX_FILE_VOLUME_ROOT) { $env:BYCLAW_SANDBOX_FILE_VOLUME_ROOT = "/mnt/byclaw-file" }
        if (-not $env:FILE_STORAGE_LOCAL_PATH) { $env:FILE_STORAGE_LOCAL_PATH = $env:BYCLAW_SANDBOX_FILE_VOLUME_ROOT }
        if (-not $env:BYCLAW_SANDBOX_FILE_VOLUME_TYPE) { $env:BYCLAW_SANDBOX_FILE_VOLUME_TYPE = "nfs" }
        if (-not $env:BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER) { $env:BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER = "nas" }
        $env:FILE_STORAGE_MINIO_MOUNT_ENABLED = "false"
    }
    default {
        Write-Error "Unsupported BYCLAW_DEPLOY_STORAGE=$mode. Use minio, nfs, or nfs-hybrid."
        exit 1
    }
}

Write-Host "Storage profile: $mode"
Write-Host "  FILE_STORAGE_TYPE=$env:FILE_STORAGE_TYPE"
Write-Host "  BYCLAW_SANDBOX_VOLUME_BACKEND=$env:BYCLAW_SANDBOX_VOLUME_BACKEND"
Write-Host "  BYCLAW_SANDBOX_FILE_VOLUME_ROOT=$env:BYCLAW_SANDBOX_FILE_VOLUME_ROOT"
Write-Host "  BYCLAW_SANDBOX_FILE_VOLUME_TYPE=$env:BYCLAW_SANDBOX_FILE_VOLUME_TYPE"
Write-Host "  FILE_STORAGE_MINIO_MOUNT_ENABLED=$env:FILE_STORAGE_MINIO_MOUNT_ENABLED"
if ($mode -eq "nfs") {
    Write-Host "  MIDDLEWARE_MODULES=$env:MIDDLEWARE_MODULES"
}
