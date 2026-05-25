# Generate nginx-standalone.conf from .tpl template + .env variables
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot

$envFile = "../../.env"
$template = "../config/nginx-standalone.conf.tpl"
$output = "../config/nginx-standalone.conf"
$sslDir = "../config/ssl"
$sslKey = "$sslDir/localhost.key"
$sslCert = "$sslDir/localhost.crt"
$opensslConf = "$sslDir/localhost-openssl.cnf"
$sslKeyPath = "/etc/nginx/ssl/localhost.key"
$sslCertPath = "/etc/nginx/ssl/localhost.crt"

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
$backend = "byclaw-be-$suffix"
$sandboxSuffix = if ($env:CONTAINER_SUFFIX) { $env:CONTAINER_SUFFIX } else { "middleware" }
$sandboxPort = if ($env:BYCLAW_SANDBOX_PORT) { $env:BYCLAW_SANDBOX_PORT } else { "9005" }
$sandbox = "byclaw-opensandbox-$sandboxSuffix"
$sandboxUrl = if ($env:PROXY_SANDBOXES_URL) { $env:PROXY_SANDBOXES_URL } else { "http://${sandbox}:${sandboxPort}" }

New-Item -ItemType Directory -Force -Path $sslDir | Out-Null
if ((-not (Test-Path $sslKey)) -or (-not (Test-Path $sslCert))) {
    if (-not (Get-Command "openssl" -ErrorAction SilentlyContinue)) {
        Write-Error "Error: openssl not found, cannot generate localhost HTTPS certificate."
        exit 1
    }

    @"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = localhost

[v3_req]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
"@ | Set-Content -Path $opensslConf -Encoding ASCII

    & openssl req `
        -x509 `
        -nodes `
        -newkey rsa:2048 `
        -days 825 `
        -keyout $sslKey `
        -out $sslCert `
        -config $opensslConf `
        -extensions v3_req
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Error: failed to generate localhost HTTPS certificate."
        exit 1
    }
}

$isDarwin = $false
try {
    $isDarwin = ((& uname) -eq "Darwin")
} catch {
    $isDarwin = $false
}

if ($isDarwin -and (Get-Command "podman" -ErrorAction SilentlyContinue)) {
    $resolverBlock = ""
    $backendVars = ""
    $proxyHttp = "http://${backend}:${bePort}"
    $proxyWs = "http://${backend}:${wsPort}"
    $proxySandboxes = $sandboxUrl
} else {
    $resolverBlock = "resolver 127.0.0.11 valid=10s;"
    $backendVars = "set `$backend_http `"http://${backend}:${bePort}`"; set `$backend_ws `"http://${backend}:${wsPort}`"; set `$sandbox_http `"${sandboxUrl}`";"
    $proxyHttp = '$backend_http'
    $proxyWs = '$backend_ws'
    $proxySandboxes = '$sandbox_http'
}

$content = Get-Content $template -Raw
$content = $content.Replace('{{BE_SERVER_PORT}}', $bePort)
$content = $content.Replace('{{BE_WS_PORT}}', $wsPort)
$content = $content.Replace('{{CONTAINER_SUFFIX}}', $suffix)
$content = $content.Replace('{{RESOLVER_BLOCK}}', $resolverBlock)
$content = $content.Replace('{{BACKEND_VARS}}', $backendVars)
$content = $content.Replace('{{PROXY_HTTP}}', $proxyHttp)
$content = $content.Replace('{{PROXY_WS}}', $proxyWs)
$content = $content.Replace('{{PROXY_SANDBOXES}}', $proxySandboxes)
$content = $content.Replace('{{SSL_CERT_PATH}}', $sslCertPath)
$content = $content.Replace('{{SSL_KEY_PATH}}', $sslKeyPath)

Set-Content -Path $output -Value $content -Encoding UTF8
Write-Host "Generated $output (BE_PORT=$bePort, WS_PORT=$wsPort, SUFFIX=$suffix, SANDBOX_URL=$sandboxUrl)"
Write-Host "Initialized HTTPS certificate: $sslCert"
Pop-Location
