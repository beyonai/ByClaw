# Start all services (middleware + standalone)
Push-Location $PSScriptRoot

Write-Host "========== Starting Middleware =========="
& "$PSScriptRoot\middleware\start-all.ps1"

Write-Host ""
Write-Host "========== Starting Standalone =========="
& "$PSScriptRoot\standalone\start-all.ps1"

Pop-Location
