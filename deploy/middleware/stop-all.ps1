# Stop middleware services
$ErrorActionPreference = "Continue"
Push-Location $PSScriptRoot
. ..\compose-detect.ps1

if ($env:MIDDLEWARE_MODULES -eq "NONE") {
    Write-Host "MIDDLEWARE_MODULES=NONE, no middleware services to stop."
} elseif ($env:MIDDLEWARE_MODULES) {
    $services = $env:MIDDLEWARE_MODULES -split ","
    Write-Host "Stopping middleware services: $($services -join ' ')"
    Invoke-Compose (@("stop") + $services)
    Invoke-Compose (@("rm", "-f") + $services)
} else {
    Write-Host "Stopping all middleware services..."
    Invoke-Compose @("down")
}

Write-Host "Middleware services stopped."
Pop-Location
