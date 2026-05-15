# Start all middleware services
$ErrorActionPreference = "Continue"
Push-Location $PSScriptRoot
. ..\compose-detect.ps1

# Generate opensandbox config if needed
if ($env:MIDDLEWARE_MODULES -ne "NONE") {
    if (-not $env:MIDDLEWARE_MODULES -or $env:MIDDLEWARE_MODULES -match "opensandbox") {
        & "$PSScriptRoot\gen-opensandbox-config.ps1"
    }
}

# opengauss init if needed
if ($env:MIDDLEWARE_MODULES -ne "NONE") {
    if (-not $env:MIDDLEWARE_MODULES -or $env:MIDDLEWARE_MODULES -match "opengauss") {
        New-Item -ItemType Directory -Force -Path "data" | Out-Null
    }
}

if ($env:MIDDLEWARE_MODULES -eq "NONE") {
    Write-Host "MIDDLEWARE_MODULES=NONE, skipping all middleware services."
} elseif ($env:MIDDLEWARE_MODULES) {
    $services = $env:MIDDLEWARE_MODULES -split ","
    Write-Host "Starting middleware services: $($services -join ' ')"
    Invoke-Compose (@("up", "-d", "--force-recreate") + $services)
} else {
    Write-Host "Starting all middleware services..."
    Invoke-Compose @("up", "-d", "--force-recreate")
}

Write-Host ""
Invoke-Compose @("ps")
Pop-Location
