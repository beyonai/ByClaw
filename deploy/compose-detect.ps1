# Detect compose command: docker compose, podman compose, docker-compose, podman-compose.
# Dot-source this file: . "$PSScriptRoot\..\compose-detect.ps1"
# Exports:
#   $Compose           - the compose command array
#   $ComposeEnvFlag    - "--env-file ../../.env" or ""
#   $env:COMPOSE_PROJECT_NAME

function Test-DockerDaemon {
    try { docker info 2>$null | Out-Null; return $true } catch { return $false }
}

$Compose = $null
$ComposeEnvFlag = ""

if ((Get-Command "docker" -ErrorAction SilentlyContinue) -and (Test-DockerDaemon)) {
    $v = docker compose version 2>$null
    if ($LASTEXITCODE -eq 0) {
        $Compose = @("docker", "compose")
        $ComposeEnvFlag = "--env-file ../../.env"
    }
}

if (-not $Compose -and (Get-Command "podman" -ErrorAction SilentlyContinue)) {
    $v = podman compose version 2>$null
    if ($LASTEXITCODE -eq 0) {
        $Compose = @("podman", "compose")
        $ComposeEnvFlag = "--env-file ../../.env"
    }
}

if (-not $Compose -and (Get-Command "docker-compose" -ErrorAction SilentlyContinue) -and (Test-DockerDaemon)) {
    $Compose = @("docker-compose")
    $ComposeEnvFlag = ""
}

if (-not $Compose -and (Get-Command "podman-compose" -ErrorAction SilentlyContinue)) {
    $Compose = @("podman-compose")
    $ComposeEnvFlag = ""
}

if (-not $Compose) {
    Write-Error "Error: no working compose command found. Install 'docker compose' or 'podman compose'."
    exit 1
}

# Load .env
$envFile = Join-Path $PSScriptRoot "../../.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
}

# Determine project name
$callerDir = Split-Path -Leaf (Get-Location)
switch ($callerDir) {
    "middleware"  { $prefix = "byclaw-middleware" }
    "standalone"  { $prefix = "byclaw-standalone" }
    "mono"        { $prefix = "byclaw-mono" }
    default       { $prefix = "byclaw" }
}
$suffix = if ($env:CONTAINER_SUFFIX) { $env:CONTAINER_SUFFIX } else { "default" }
$env:COMPOSE_PROJECT_NAME = "$prefix-$suffix"

function Invoke-Compose {
    param([string[]]$Arguments)
    $cmd = $Compose + @()
    if ($ComposeEnvFlag) { $cmd += $ComposeEnvFlag.Split(" ") }
    # On Windows, add override file to remove /etc/localtime mounts
    $winOverride = Join-Path (Get-Location) "docker-compose.windows.yml"
    if (Test-Path $winOverride) {
        $cmd += @("-f", "docker-compose.yml", "-f", "docker-compose.windows.yml")
    }
    $cmd += $Arguments
    & $cmd[0] $cmd[1..($cmd.Length-1)]
}
