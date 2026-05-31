#!/bin/sh

# Initialize NFS server and Docker hosts through SSH before one-click deployment.
# Required:
#   BYCLAW_NFS_SERVER_HOST
#   BYCLAW_NFS_CLIENT_HOSTS        comma-separated Docker/openSandbox hosts
# Optional:
#   BYCLAW_NFS_SERVER_USER         default root
#   BYCLAW_NFS_SERVER_PORT         default 22
#   BYCLAW_NFS_SERVER_PASSWORD     when password SSH is used
#   BYCLAW_NFS_CLIENT_USER         default server user
#   BYCLAW_NFS_CLIENT_PORT         default server port
#   BYCLAW_NFS_CLIENT_PASSWORD     default server password
#   BYCLAW_NFS_EXPORT_PATH         default /exports/byclaw
#   BYCLAW_NFS_EXPORT_CLIENTS      default *
#   BYCLAW_SANDBOX_FILE_VOLUME_ROOT default /mnt/byclaw-file

set -eu

cd "$(dirname "$0")"

ENV_FILE="../.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE" 2>/dev/null
    set +a
fi

SERVER_HOST="${BYCLAW_NFS_SERVER_HOST:-}"
SERVER_USER="${BYCLAW_NFS_SERVER_USER:-root}"
SERVER_PORT="${BYCLAW_NFS_SERVER_PORT:-22}"
SERVER_PASSWORD="${BYCLAW_NFS_SERVER_PASSWORD:-}"
CLIENT_HOSTS="${BYCLAW_NFS_CLIENT_HOSTS:-}"
CLIENT_USER="${BYCLAW_NFS_CLIENT_USER:-$SERVER_USER}"
CLIENT_PORT="${BYCLAW_NFS_CLIENT_PORT:-$SERVER_PORT}"
CLIENT_PASSWORD="${BYCLAW_NFS_CLIENT_PASSWORD:-$SERVER_PASSWORD}"
EXPORT_PATH="${BYCLAW_NFS_EXPORT_PATH:-/exports/byclaw}"
EXPORT_CLIENTS="${BYCLAW_NFS_EXPORT_CLIENTS:-*}"
MOUNT_POINT="${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:-/mnt/byclaw-file}"
MOUNT_OPTIONS="${BYCLAW_NFS_MOUNT_OPTIONS:-rw,hard,noatime,nconnect=4,_netdev}"

if [ -z "$SERVER_HOST" ]; then
    echo "Error: BYCLAW_NFS_SERVER_HOST is required."
    exit 1
fi

if [ -z "$CLIENT_HOSTS" ]; then
    echo "Error: BYCLAW_NFS_CLIENT_HOSTS is required, comma-separated Docker/openSandbox host list."
    exit 1
fi

ssh_run() {
    _host="$1"
    _port="$2"
    _user="$3"
    _password="$4"
    _script="$5"

    _ssh_opts="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p $_port"
    if [ -n "$_password" ]; then
        if ! command -v sshpass >/dev/null 2>&1; then
            echo "Error: sshpass is required when password is configured. Install sshpass or use SSH keys."
            exit 1
        fi
        sshpass -p "$_password" ssh $_ssh_opts "$_user@$_host" "sh -s" <<EOF
$_script
EOF
    else
        ssh $_ssh_opts "$_user@$_host" "sh -s" <<EOF
$_script
EOF
    fi
}

remote_server_script() {
    cat <<EOF
set -eu
SUDO="sudo"
if [ "\$(id -u)" = "0" ]; then SUDO=""; fi

if command -v apt-get >/dev/null 2>&1; then
  \$SUDO apt-get update
  \$SUDO apt-get install -y nfs-kernel-server
elif command -v dnf >/dev/null 2>&1; then
  \$SUDO dnf install -y nfs-utils
elif command -v yum >/dev/null 2>&1; then
  \$SUDO yum install -y nfs-utils
else
  echo "Unsupported package manager. Install NFS server packages manually." >&2
  exit 1
fi

\$SUDO mkdir -p "$EXPORT_PATH"
\$SUDO chown -R root:root "$EXPORT_PATH"
\$SUDO chmod -R 755 "$EXPORT_PATH"

line="$EXPORT_PATH  $EXPORT_CLIENTS(rw,sync,no_subtree_check,no_root_squash)"
tmp_file="/tmp/byclaw-exports.\$\$"
if [ -f /etc/exports ]; then
  grep -v "^[[:space:]]*$EXPORT_PATH[[:space:]]" /etc/exports > "\$tmp_file" || true
else
  : > "\$tmp_file"
fi
printf "%s\\n" "\$line" >> "\$tmp_file"
\$SUDO cp "\$tmp_file" /etc/exports
rm -f "\$tmp_file"

\$SUDO exportfs -rav
if command -v systemctl >/dev/null 2>&1; then
  \$SUDO systemctl enable --now nfs-server || \$SUDO systemctl enable --now nfs-kernel-server
else
  \$SUDO service nfs-server restart || \$SUDO service nfs-kernel-server restart
fi
\$SUDO exportfs -v
EOF
}

remote_client_script() {
    cat <<EOF
set -eu
SUDO="sudo"
if [ "\$(id -u)" = "0" ]; then SUDO=""; fi

if command -v apt-get >/dev/null 2>&1; then
  \$SUDO apt-get update
  \$SUDO apt-get install -y nfs-common
elif command -v dnf >/dev/null 2>&1; then
  \$SUDO dnf install -y nfs-utils
elif command -v yum >/dev/null 2>&1; then
  \$SUDO yum install -y nfs-utils
else
  echo "Unsupported package manager. Install NFS client packages manually." >&2
  exit 1
fi

\$SUDO mkdir -p "$MOUNT_POINT"
expected_source="$SERVER_HOST:$EXPORT_PATH"
if findmnt "$MOUNT_POINT" >/dev/null 2>&1; then
  current_source="\$(findmnt -n -o SOURCE --target "$MOUNT_POINT" || true)"
  if [ "\$current_source" = "\$expected_source" ]; then
    echo "$MOUNT_POINT already mounted from \$current_source"
  else
    echo "Error: $MOUNT_POINT is already mounted from '\$current_source', expected '\$expected_source'." >&2
    exit 1
  fi
else
  \$SUDO mount -t nfs4 "\$expected_source" "$MOUNT_POINT" -o "$MOUNT_OPTIONS"
fi

fstab_line="$SERVER_HOST:$EXPORT_PATH $MOUNT_POINT nfs4 $MOUNT_OPTIONS 0 0"
tmp_file="/tmp/byclaw-fstab.\$\$"
if [ -f /etc/fstab ]; then
  grep -v "[[:space:]]$MOUNT_POINT[[:space:]]" /etc/fstab > "\$tmp_file" || true
else
  : > "\$tmp_file"
fi
printf "%s\\n" "\$fstab_line" >> "\$tmp_file"
\$SUDO cp "\$tmp_file" /etc/fstab
rm -f "\$tmp_file"

findmnt "$MOUNT_POINT"
\$SUDO touch "$MOUNT_POINT/.byclaw-nfs-probe-\$(hostname)"
EOF
}

echo "========== Initializing NFS Server =========="
echo "Server: $SERVER_USER@$SERVER_HOST:$SERVER_PORT export=$EXPORT_PATH clients=$EXPORT_CLIENTS"
ssh_run "$SERVER_HOST" "$SERVER_PORT" "$SERVER_USER" "$SERVER_PASSWORD" "$(remote_server_script)"

echo ""
echo "========== Mounting NFS on Docker Hosts =========="
OLD_IFS="$IFS"
IFS=","
for host in $CLIENT_HOSTS; do
    host="$(printf '%s' "$host" | xargs)"
    if [ -z "$host" ]; then
        continue
    fi
    echo "Client: $CLIENT_USER@$host:$CLIENT_PORT mount=$MOUNT_POINT"
    ssh_run "$host" "$CLIENT_PORT" "$CLIENT_USER" "$CLIENT_PASSWORD" "$(remote_client_script)"
done
IFS="$OLD_IFS"

echo ""
echo "NFS initialization completed."
