# Start all services (middleware + standalone)
Push-Location $PSScriptRoot

if ($args.Count -gt 0) {
    Write-Host "Warning: start-standalone.ps1 no longer accepts storage parameters. Use .env + .\deploy.ps1 init|update."
}

if ($env:BYCLAW_DEPLOY_INIT_NFS -eq "true") {
    Write-Host "========== Initializing NFS =========="
    & "$PSScriptRoot\init-nfs.ps1"
    Write-Host ""
}

Write-Host "========== Starting Middleware =========="
& "$PSScriptRoot\middleware\start-all.ps1"

Write-Host ""
Write-Host "========== Starting Standalone =========="
& "$PSScriptRoot\standalone\start-all.ps1"

Pop-Location
