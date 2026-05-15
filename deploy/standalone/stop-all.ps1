# Stop standalone services
$ErrorActionPreference = "Continue"
Push-Location $PSScriptRoot
. ..\compose-detect.ps1

if ($env:STANDALONE_MODULES -eq "NONE") {
    Write-Host "STANDALONE_MODULES=NONE, no standalone services to stop."
} elseif ($env:STANDALONE_MODULES) {
    $services = $env:STANDALONE_MODULES -split ","
    Write-Host "Stopping standalone services: $($services -join ' ')"
    Invoke-Compose (@("stop") + $services)
    Invoke-Compose (@("rm", "-f") + $services)
} else {
    Write-Host "Stopping all services..."
    Invoke-Compose @("down")
}

Write-Host "Standalone services stopped."
Pop-Location
