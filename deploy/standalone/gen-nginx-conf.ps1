# Generate nginx-standalone.conf from .tpl template + .env variables
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot

$envFile = "../../.env"
$template = "../config/nginx-standalone.conf.tpl"
$output = "../config/nginx-standalone.conf"

if (-not (Test-Path $envFile)) {
    Write-Error "Error: $envFile not found!"
    exit 1
}

if (-not (Test-Path $template)) {
    Write-Error "Error: $template not found!"
    exit 1
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}

$bePort = if ($env:BE_SERVER_PORT) { $env:BE_SERVER_PORT } else { "8086" }
$wsPort = if ($env:BE_WS_PORT) { $env:BE_WS_PORT } else { "8082" }
$suffix = if ($env:CONTAINER_SUFFIX) { $env:CONTAINER_SUFFIX } else { "standalone" }

$content = Get-Content $template -Raw
$content = $content -replace '{{BE_SERVER_PORT}}', $bePort
$content = $content -replace '{{BE_WS_PORT}}', $wsPort
$content = $content -replace '{{CONTAINER_SUFFIX}}', $suffix

Set-Content -Path $output -Value $content -Encoding UTF8
Write-Host "Generated $output (BE_PORT=$bePort, WS_PORT=$wsPort, SUFFIX=$suffix)"
Pop-Location
