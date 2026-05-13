# Start all standalone services
$ErrorActionPreference = "Continue"
Push-Location $PSScriptRoot
. ..\compose-detect.ps1

& "$PSScriptRoot\gen-nginx-conf.ps1"

if ($env:STANDALONE_MODULES -eq "NONE") {
    Write-Host "STANDALONE_MODULES=NONE, skipping all standalone services."
} elseif ($env:STANDALONE_MODULES) {
    $services = $env:STANDALONE_MODULES -split ","
    Write-Host "Starting standalone services: $($services -join ' ')"
    Invoke-Compose (@("up", "-d", "--force-recreate") + $services)
} else {
    Write-Host "Starting all services..."
    Invoke-Compose @("up", "-d", "--force-recreate")
}

$nginxPort = if ($env:NGINX_PORT) { $env:NGINX_PORT } else { "8080" }
$bePort = if ($env:BE_SERVER_PORT) { $env:BE_SERVER_PORT } else { "8086" }
$qaPort = if ($env:BYCLAW_QA_PORT) { $env:BYCLAW_QA_PORT } else { "8090" }
$dataPort = if ($env:DATACLOUD_PORT) { $env:DATACLOUD_PORT } else { "8087" }

Write-Host ""
Write-Host "==================== 部署完成 ===================="
Write-Host "前端: http://localhost:$nginxPort"
Write-Host "后端: http://localhost:$bePort"
Write-Host "QA:   http://localhost:$qaPort"
Write-Host "Data: http://localhost:$dataPort"
Write-Host ""
Invoke-Compose @("ps")
Pop-Location
