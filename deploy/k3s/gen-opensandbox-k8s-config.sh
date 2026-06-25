#!/bin/bash
# Generate opensandbox-server-k8s.toml from env.k3s
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="${1:-./env.k3s.example}"
OUTPUT="${2:-./opensandbox-server-k8s.toml}"

if [ ! -f "$ENV_FILE" ] && [ -f "$SCRIPT_DIR/$(basename "$ENV_FILE")" ]; then
    ENV_FILE="$SCRIPT_DIR/$(basename "$ENV_FILE")"
fi
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found" >&2
    exit 1
fi

set -a
. "$ENV_FILE"
set +a

OPENSANDBOX_WORKLOAD_NAMESPACE="${OPENSANDBOX_WORKLOAD_NAMESPACE:-${NS_SERVICE:-by-service}}"
BYCLAW_SANDBOX_FILE_VOLUME_ROOT="${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:-/mnt/byclaw-workspace}"
FILE_STORAGE_LOCAL_PATH="${FILE_STORAGE_LOCAL_PATH:-$BYCLAW_SANDBOX_FILE_VOLUME_ROOT}"
OPENSANDBOX_SANDBOX_IMAGE_PULL_POLICY="${OPENSANDBOX_SANDBOX_IMAGE_PULL_POLICY:-Always}"

toml_string_array() {
    local raw="${1:-}"
    local item
    local out=""
    IFS=',' read -ra items <<< "$raw"
    for item in "${items[@]}"; do
        item="$(printf '%s' "$item" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        if [ -z "$item" ]; then
            continue
        fi
        item="${item//\\/\\\\}"
        item="${item//\"/\\\"}"
        if [ -n "$out" ]; then
            out+=", "
        fi
        out+="\"$item\""
    done
    printf '[%s]' "$out"
}

OPENSANDBOX_ALLOWED_HOST_PATHS="${OPENSANDBOX_ALLOWED_HOST_PATHS:-$FILE_STORAGE_LOCAL_PATH}"
OPENSANDBOX_ALLOWED_HOST_PATHS_TOML="$(toml_string_array "$OPENSANDBOX_ALLOWED_HOST_PATHS")"

cat > "$OUTPUT" <<EOF
[server]
host = "0.0.0.0"
port = ${OPENSANDBOX_API_PORT:-9005}
api_key = "${OPENSANDBOX_API_KEY:-dev}"
max_sandbox_timeout_seconds = 86400
limit_concurrency = 1024
backlog = 2048
thread_pool_size = 200

[log]
level = "INFO"

[runtime]
type = "kubernetes"
execd_image = "${IMAGE_SANDBOX_EXECD}"

[storage]
allowed_host_paths = ${OPENSANDBOX_ALLOWED_HOST_PATHS_TOML}
volume_default_size = "${OPENSANDBOX_VOLUME_DEFAULT_SIZE:-20Gi}"

[kubernetes]
namespace = "${OPENSANDBOX_WORKLOAD_NAMESPACE}"
service_account = "opensandbox-runtime"
workload_provider = "batchsandbox"
image_pull_policy = "${OPENSANDBOX_SANDBOX_IMAGE_PULL_POLICY}"
sandbox_create_timeout_seconds = 120
sandbox_create_poll_interval_seconds = 1.0
snapshot_create_timeout_seconds = 900
informer_enabled = true
informer_resync_seconds = 300
informer_watch_timeout_seconds = 60
batchsandbox_template_file = "/etc/opensandbox/batchsandbox-template.yaml"

[kubernetes.execd_init_resources.requests]
cpu = "50m"
memory = "64Mi"

[kubernetes.execd_init_resources.limits]
cpu = "100m"
memory = "128Mi"

[ingress]
mode = "gateway"

[ingress.gateway]
address = "${OPENSANDBOX_GATEWAY_ADDRESS:-*.sandbox.example.com}"

[ingress.gateway.route]
mode = "${OPENSANDBOX_ROUTE_MODE:-wildcard}"

[egress]
image = "${IMAGE_SANDBOX_EGRESS}"
mode = "dns+nft"
disable_ipv6 = true

[renew_intent]
enabled = false
min_interval_seconds = 60
redis.enabled = false
EOF

echo "Generated $OUTPUT (namespace=${OPENSANDBOX_WORKLOAD_NAMESPACE}, gateway=${OPENSANDBOX_GATEWAY_ADDRESS:-*.sandbox.example.com})"
