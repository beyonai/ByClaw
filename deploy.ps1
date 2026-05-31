param(
    [ValidateSet("init", "nfs-init", "update", "stop", "help")]
    [string]$Action = "help"
)

# ByClaw 统一部署入口。
# 用法：
#   .\deploy.ps1 init    # 初始化部署：可按 .env 初始化 NFS、拉镜像、启动服务
#   .\deploy.ps1 nfs-init # 仅初始化 NFS：不拉镜像，不启动或重建服务
#   .\deploy.ps1 update  # 增量更新：按 .env 重新生成配置并重建服务
#   .\deploy.ps1 stop    # 停止服务
# 存储方案、是否初始化 NFS、是否启动 MinIO 等细节全部由 .env 驱动。

$ErrorActionPreference = "Stop"
$RootDir = $PSScriptRoot
$DeployDir = Join-Path $RootDir "deploy"

function Import-ByClawEnv {
    $envFile = Join-Path $RootDir ".env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
                [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
            }
        }
    }
    . "$DeployDir\storage-profile.ps1"
}

function Start-ByClawServices {
    Write-Host "========== Starting Middleware =========="
    Push-Location (Join-Path $DeployDir "middleware")
    & ".\start-all.ps1"
    Pop-Location

    Write-Host ""
    Write-Host "========== Starting Standalone =========="
    Push-Location (Join-Path $DeployDir "standalone")
    & ".\start-all.ps1"
    Pop-Location
}

function Pull-ByClawImages {
    if (-not (Get-Command "bash" -ErrorAction SilentlyContinue) -and -not (Get-Command "sh" -ErrorAction SilentlyContinue)) {
        Write-Host "Shell not found, skipping image pull scripts. Compose will use local images or pull as configured."
        return
    }
    $shell = if (Get-Command "bash" -ErrorAction SilentlyContinue) { "bash" } else { "sh" }

    Write-Host "========== Pulling Middleware Images =========="
    Push-Location (Join-Path $DeployDir "middleware")
    & $shell "pull.sh"
    Pop-Location

    Write-Host ""
    Write-Host "========== Pulling Standalone Images =========="
    Push-Location (Join-Path $DeployDir "standalone")
    & $shell "pull.sh"
    Pop-Location
}

switch ($Action) {
    "init" {
        Import-ByClawEnv
        if ($env:BYCLAW_DEPLOY_INIT_NFS -eq "true") {
            Write-Host "========== Initializing NFS =========="
            Push-Location $DeployDir
            & ".\init-nfs.ps1"
            Pop-Location
            Write-Host ""
        }
        Pull-ByClawImages
        Start-ByClawServices
    }
    "nfs-init" {
        Import-ByClawEnv
        Write-Host "========== Initializing NFS Only =========="
        Push-Location $DeployDir
        & ".\init-nfs.ps1"
        Pop-Location
    }
    "update" {
        Import-ByClawEnv
        Pull-ByClawImages
        Start-ByClawServices
    }
    "stop" {
        Write-Host "========== Stopping Standalone =========="
        Push-Location (Join-Path $DeployDir "standalone")
        & ".\stop-all.ps1"
        Pop-Location

        Write-Host ""
        Write-Host "========== Stopping Middleware =========="
        Push-Location (Join-Path $DeployDir "middleware")
        & ".\stop-all.ps1"
        Pop-Location
    }
    default {
        Write-Host "Usage: .\deploy.ps1 init|nfs-init|update|stop"
    }
}
