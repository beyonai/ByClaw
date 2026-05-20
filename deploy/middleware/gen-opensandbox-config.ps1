# Generate opensandbox-server.toml from .env variables
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot

$envFile = "../../.env"
$output = "./opensandbox-server.toml"

if (-not (Test-Path $envFile)) {
    Write-Error "Error: $envFile not found!"
    exit 1
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}

$suffix = if ($env:CONTAINER_SUFFIX) { $env:CONTAINER_SUFFIX } else { "default" }
$networkName = "byclaw-network-$suffix"
$port = if ($env:BYCLAW_SANDBOX_PORT) { $env:BYCLAW_SANDBOX_PORT } else { "9005" }
$apiKey = if ($env:BYCLAW_SANDBOX_API_KEY) { $env:BYCLAW_SANDBOX_API_KEY } else { "dev" }
$hostIp = if ($env:BYCLAW_SANDBOX_HOST) { $env:BYCLAW_SANDBOX_HOST } else { "127.0.0.1" }

$content = @"
[server]
host = "0.0.0.0"
port = $port
log_level = "INFO"
api_key = "$apiKey"

[runtime]
type = "docker"
execd_image = "sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/execd:v1.0.9"

[egress]
image = "sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/egress:v1.0.3"
mode = "dns"
allow_domains = ["*"]

[docker]
network_mode = "$networkName"
host_ip = "$hostIp"
drop_capabilities = []
no_new_privileges = false
pids_limit = 4096

[ingress]
mode = "direct"
"@

Set-Content -Path $output -Value $content -Encoding UTF8
Write-Host "Generated $output (host_ip=$hostIp, port=$port, network=$networkName)"
Pop-Location
