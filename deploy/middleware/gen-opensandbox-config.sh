#!/bin/bash
#
# Generate opensandbox-server.toml from .env variables.
# Uses pure bash heredoc — no envsubst dependency.
#
cd "$(dirname "$0")"

ENV_FILE="../../.env"
OUTPUT="./opensandbox-server.toml"

# Check .env exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found!"
    exit 1
fi

# Load .env variables (use '.' instead of 'source' for POSIX/dash compatibility)
set -a
. "$ENV_FILE"
set +a

SUFFIX="${CONTAINER_SUFFIX:-default}"
NETWORK_NAME="byclaw-network-${SUFFIX}"
VOLUME_BACKEND="${BYCLAW_SANDBOX_VOLUME_BACKEND:-minio-mount}"
FILE_VOLUME_ROOT="${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:-/mnt/byclaw-file}"
FILE_VOLUME_TYPE="${BYCLAW_SANDBOX_FILE_VOLUME_TYPE:-bind}"
FILE_VOLUME_SNAPSHOT_PROVIDER="${BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER:-none}"
FILE_BROWSER_ENABLED="${BYCLAW_SANDBOX_FILE_BROWSER_ENABLED:-false}"
FILE_BROWSER_ENABLED="$(printf '%s' "${FILE_BROWSER_ENABLED}" | tr '[:upper:]' '[:lower:]')"

cat > "$OUTPUT" <<EOF
[server]
host = "0.0.0.0"
port = ${BYCLAW_SANDBOX_PORT:-9005}
log_level = "INFO"
api_key = "${BYCLAW_SANDBOX_API_KEY:-dev}"

[runtime]
type = "docker"
execd_image = "sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/execd:v1.0.9"

[egress]
image = "sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/egress:v1.0.3"
mode = "dns"
allow_domains = ["*"]

[docker]
network_mode = "${NETWORK_NAME}"
host_ip = "${BYCLAW_SANDBOX_HOST:-127.0.0.1}"
drop_capabilities = []
no_new_privileges = false
pids_limit = 4096

[docker.private_volume]
backend = "${VOLUME_BACKEND}"
file_root = "${FILE_VOLUME_ROOT}"
file_type = "${FILE_VOLUME_TYPE}"
snapshot_provider = "${FILE_VOLUME_SNAPSHOT_PROVIDER}"
file_browser_enabled = ${FILE_BROWSER_ENABLED}

[ingress]
mode = "direct"
EOF

echo "Generated $OUTPUT (host_ip=${BYCLAW_SANDBOX_HOST:-127.0.0.1}, port=${BYCLAW_SANDBOX_PORT:-9005}, network=${NETWORK_NAME}, volume_backend=${VOLUME_BACKEND}, file_root=${FILE_VOLUME_ROOT})"
