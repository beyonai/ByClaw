# Stop all services (standalone + middleware)
Push-Location $PSScriptRoot

Write-Host "========== Stopping Standalone =========="
& "$PSScriptRoot\standalone\stop-all.ps1"

Write-Host ""
Write-Host "========== Stopping Middleware =========="
& "$PSScriptRoot\middleware\stop-all.ps1"

Pop-Location
