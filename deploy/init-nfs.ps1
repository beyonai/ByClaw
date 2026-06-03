param()

$ErrorActionPreference = "Stop"
$envFile = Join-Path $PSScriptRoot "../.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
}

$serverHost = $env:BYCLAW_NFS_SERVER_HOST
if (-not $serverHost) {
    Write-Error "BYCLAW_NFS_SERVER_HOST is required."
    exit 1
}

$clientHosts = $env:BYCLAW_NFS_CLIENT_HOSTS
if (-not $clientHosts) {
    Write-Error "BYCLAW_NFS_CLIENT_HOSTS is required, comma-separated Docker/openSandbox host list."
    exit 1
}

$serverUser = if ($env:BYCLAW_NFS_SERVER_USER) { $env:BYCLAW_NFS_SERVER_USER } else { "root" }
$serverPort = if ($env:BYCLAW_NFS_SERVER_PORT) { $env:BYCLAW_NFS_SERVER_PORT } else { "22" }
$clientUser = if ($env:BYCLAW_NFS_CLIENT_USER) { $env:BYCLAW_NFS_CLIENT_USER } else { $serverUser }
$clientPort = if ($env:BYCLAW_NFS_CLIENT_PORT) { $env:BYCLAW_NFS_CLIENT_PORT } else { $serverPort }
$exportPath = if ($env:BYCLAW_NFS_EXPORT_PATH) { $env:BYCLAW_NFS_EXPORT_PATH } else { "/exports/byclaw" }
$exportClients = if ($env:BYCLAW_NFS_EXPORT_CLIENTS) { $env:BYCLAW_NFS_EXPORT_CLIENTS } else { "*" }
$mountPoint = if ($env:BYCLAW_SANDBOX_FILE_VOLUME_ROOT) { $env:BYCLAW_SANDBOX_FILE_VOLUME_ROOT } else { "/mnt/byclaw-file" }
$mountOptions = if ($env:BYCLAW_NFS_MOUNT_OPTIONS) { $env:BYCLAW_NFS_MOUNT_OPTIONS } else { "rw,hard,noatime,nconnect=4,_netdev" }

function Invoke-RemoteScript {
    param(
        [string]$HostName,
        [string]$Port,
        [string]$User,
        [string]$Script
    )
    $tmp = New-TemporaryFile
    Set-Content -Path $tmp -Value $Script -NoNewline
    try {
        Get-Content $tmp | ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p $Port "$User@$HostName" "sh -s"
    }
    finally {
        Remove-Item -Force $tmp
    }
}

$serverScript = @"
set -eu
SUDO="sudo"
if [ "`$(id -u)" = "0" ]; then SUDO=""; fi
if command -v apt-get >/dev/null 2>&1; then
  `$SUDO apt-get update
  `$SUDO apt-get install -y nfs-kernel-server
elif command -v dnf >/dev/null 2>&1; then
  `$SUDO dnf install -y nfs-utils
elif command -v yum >/dev/null 2>&1; then
  `$SUDO yum install -y nfs-utils
else
  echo "Unsupported package manager." >&2
  exit 1
fi
`$SUDO mkdir -p '$exportPath'
`$SUDO chown -R root:root '$exportPath'
`$SUDO chmod -R 755 '$exportPath'
line="'$exportPath'  '$exportClients'(rw,sync,no_subtree_check,no_root_squash)"
tmp_file="/tmp/byclaw-exports.`$`$"
if [ -f /etc/exports ]; then grep -v "^[[:space:]]*$exportPath[[:space:]]" /etc/exports > "`$tmp_file" || true; else : > "`$tmp_file"; fi
printf "%s\n" "`$line" >> "`$tmp_file"
`$SUDO cp "`$tmp_file" /etc/exports
rm -f "`$tmp_file"
`$SUDO exportfs -rav
if command -v systemctl >/dev/null 2>&1; then
  `$SUDO systemctl enable --now nfs-server || `$SUDO systemctl enable --now nfs-kernel-server
else
  `$SUDO service nfs-server restart || `$SUDO service nfs-kernel-server restart
fi
`$SUDO exportfs -v
"@

$clientScript = @"
set -eu
SUDO="sudo"
if [ "`$(id -u)" = "0" ]; then SUDO=""; fi
if command -v apt-get >/dev/null 2>&1; then
  `$SUDO apt-get update
  `$SUDO apt-get install -y nfs-common
elif command -v dnf >/dev/null 2>&1; then
  `$SUDO dnf install -y nfs-utils
elif command -v yum >/dev/null 2>&1; then
  `$SUDO yum install -y nfs-utils
else
  echo "Unsupported package manager." >&2
  exit 1
fi
`$SUDO mkdir -p '$mountPoint'
if findmnt '$mountPoint' >/dev/null 2>&1; then
  echo "'$mountPoint' already mounted"
else
  `$SUDO mount -t nfs4 '$serverHost:$exportPath' '$mountPoint' -o '$mountOptions'
fi
fstab_line="'$serverHost:$exportPath' '$mountPoint' nfs4 '$mountOptions' 0 0"
tmp_file="/tmp/byclaw-fstab.`$`$"
grep -v "[[:space:]]$mountPoint[[:space:]]" /etc/fstab > "`$tmp_file" || true
printf "%s\n" "`$fstab_line" >> "`$tmp_file"
`$SUDO cp "`$tmp_file" /etc/fstab
rm -f "`$tmp_file"
findmnt '$mountPoint'
touch '$mountPoint/.byclaw-nfs-probe-`$(hostname)'
"@

Write-Host "========== Initializing NFS Server =========="
Write-Host "Server: $serverUser@$serverHost`:$serverPort export=$exportPath clients=$exportClients"
Invoke-RemoteScript -HostName $serverHost -Port $serverPort -User $serverUser -Script $serverScript

Write-Host ""
Write-Host "========== Mounting NFS on Docker Hosts =========="
$clientHosts.Split(",") | ForEach-Object {
    $hostName = $_.Trim()
    if ($hostName) {
        Write-Host "Client: $clientUser@$hostName`:$clientPort mount=$mountPoint"
        Invoke-RemoteScript -HostName $hostName -Port $clientPort -User $clientUser -Script $clientScript
    }
}

Write-Host ""
Write-Host "NFS initialization completed."
