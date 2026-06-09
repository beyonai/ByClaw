#!/bin/sh
#
# Generate nginx-standalone.conf from .tpl template + .env variables.
# Only replaces {{VAR}} placeholders — no heredoc duplication.
#
# Supports per-env override: if nginx-standalone.conf.tpl exists alongside
# the .env file, it takes precedence over the default template.
#
cd "$(dirname "$0")"

ENV_FILE="../../.env"
TEMPLATE="../config/nginx-standalone.conf.tpl"
OUTPUT="../config/nginx-standalone.conf"
SSL_DIR="../config/ssl"
SSL_KEY="${SSL_DIR}/localhost.key"
SSL_CERT="${SSL_DIR}/localhost.crt"
OPENSSL_CONF="${SSL_DIR}/localhost-openssl.cnf"
SSL_KEY_PATH="/etc/nginx/ssl/localhost.key"
SSL_CERT_PATH="/etc/nginx/ssl/localhost.crt"

# Check for per-env nginx template override (same dir as .env)
ENV_DIR="$(cd "$(dirname "$ENV_FILE")" && pwd)"
ENV_TEMPLATE="$ENV_DIR/nginx-standalone.conf.tpl"
if [ -f "$ENV_TEMPLATE" ]; then
    TEMPLATE="$ENV_TEMPLATE"
    echo "Using env-specific nginx template: $ENV_TEMPLATE"
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "Warning: $ENV_FILE not found, using defaults."
else
    set -a
    . "$ENV_FILE"
    set +a
fi

if [ ! -f "$TEMPLATE" ]; then
    echo "Error: $TEMPLATE not found!"
    exit 1
fi

BE_PORT="${BE_SERVER_PORT:-8086}"
WS_PORT="${BE_WS_PORT:-8082}"
SUFFIX="${CONTAINER_SUFFIX:-standalone}"
BACKEND="byclaw-be-${SUFFIX}"
if [ -n "${CONTAINER_SUFFIX:-}" ]; then
    SANDBOX_SUFFIX="$CONTAINER_SUFFIX"
else
    SANDBOX_SUFFIX="middleware"
fi
SANDBOX_PORT="${BYCLAW_SANDBOX_PORT:-9005}"
SANDBOX="byclaw-opensandbox-${SANDBOX_SUFFIX}"
SANDBOX_URL="${PROXY_SANDBOXES_URL:-http://${SANDBOX}:${SANDBOX_PORT}}"

mkdir -p "$SSL_DIR"
if [ ! -f "$SSL_KEY" ] || [ ! -f "$SSL_CERT" ]; then
    if ! command -v openssl >/dev/null 2>&1; then
        echo "Error: openssl not found, cannot generate localhost HTTPS certificate."
        exit 1
    fi

    cat > "$OPENSSL_CONF" <<EOF
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
EOF

    openssl req \
        -x509 \
        -nodes \
        -newkey rsa:2048 \
        -days 825 \
        -keyout "$SSL_KEY" \
        -out "$SSL_CERT" \
        -config "$OPENSSL_CONF" \
        -extensions v3_req
    chmod 600 "$SSL_KEY"
    chmod 644 "$SSL_CERT"
fi

# Platform-specific nginx config strategy:
# - Docker (Linux): use resolver 127.0.0.11 + variable proxy_pass for lazy DNS
# - Podman (macOS): use direct proxy_pass (depends_on ensures BE is ready)
#
# Cluster mode: set BE_CLUSTER (comma-separated host:port list) to enable upstream load balancing.
# Example: BE_CLUSTER="byclaw-be-1:8086,byclaw-be-2:8086"
# WS cluster: set BE_WS_CLUSTER similarly. Defaults to BE_CLUSTER with WS_PORT if not set.

UPSTREAM_BLOCK=""

if [ -n "${BE_CLUSTER:-}" ]; then
    # Build upstream blocks for cluster deployment (POSIX sh compatible)
    UPSTREAM_HTTP="upstream backend_http {"
    UPSTREAM_WS="upstream backend_ws {
    ip_hash;"

    OLD_IFS="$IFS"
    IFS=','
    for node in $BE_CLUSTER; do
        node=$(echo "$node" | tr -d ' ')
        UPSTREAM_HTTP="${UPSTREAM_HTTP}
    server ${node};"
    done
    IFS="$OLD_IFS"
    UPSTREAM_HTTP="${UPSTREAM_HTTP}
}"

    WS_CLUSTER="${BE_WS_CLUSTER:-}"
    if [ -z "$WS_CLUSTER" ]; then
        OLD_IFS="$IFS"
        IFS=','
        for node in $BE_CLUSTER; do
            host=$(echo "$node" | tr -d ' ' | cut -d: -f1)
            ws_node="${host}:${WS_PORT}"
            if [ -z "$WS_CLUSTER" ]; then
                WS_CLUSTER="$ws_node"
            else
                WS_CLUSTER="${WS_CLUSTER},${ws_node}"
            fi
        done
        IFS="$OLD_IFS"
    fi

    OLD_IFS="$IFS"
    IFS=','
    for node in $WS_CLUSTER; do
        node=$(echo "$node" | tr -d ' ')
        UPSTREAM_WS="${UPSTREAM_WS}
    server ${node};"
    done
    IFS="$OLD_IFS"
    UPSTREAM_WS="${UPSTREAM_WS}
}"

    UPSTREAM_BLOCK="${UPSTREAM_HTTP}

${UPSTREAM_WS}"
    RESOLVER_BLOCK=""
    BACKEND_VARS=""
    PROXY_HTTP="http://backend_http"
    PROXY_WS="http://backend_ws"
    PROXY_SANDBOXES="${SANDBOX_URL}"
elif [ "$(uname)" = "Darwin" ] && command -v podman >/dev/null 2>&1; then
    RESOLVER_BLOCK=""
    BACKEND_VARS=""
    PROXY_HTTP="http://${BACKEND}:${BE_PORT}"
    PROXY_WS="http://${BACKEND}:${WS_PORT}"
    PROXY_SANDBOXES="${SANDBOX_URL}"
else
    RESOLVER_BLOCK="resolver 127.0.0.11 valid=10s;"
    BACKEND_VARS="set \$backend_http \"http://${BACKEND}:${BE_PORT}\"; set \$backend_ws \"http://${BACKEND}:${WS_PORT}\"; set \$sandbox_http \"${SANDBOX_URL}\";"
    PROXY_HTTP="\$backend_http"
    PROXY_WS="\$backend_ws"
    PROXY_SANDBOXES="\$sandbox_http"
fi

escape_sed_replacement() {
    printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

# Single-line replacements via sed
sed -e "s|{{BE_SERVER_PORT}}|$(escape_sed_replacement "$BE_PORT")|g" \
    -e "s|{{BE_WS_PORT}}|$(escape_sed_replacement "$WS_PORT")|g" \
    -e "s|{{CONTAINER_SUFFIX}}|$(escape_sed_replacement "$SUFFIX")|g" \
    -e "s|{{RESOLVER_BLOCK}}|$(escape_sed_replacement "$RESOLVER_BLOCK")|g" \
    -e "s|{{BACKEND_VARS}}|$(escape_sed_replacement "$BACKEND_VARS")|g" \
    -e "s|{{PROXY_HTTP}}|$(escape_sed_replacement "$PROXY_HTTP")|g" \
    -e "s|{{PROXY_WS}}|$(escape_sed_replacement "$PROXY_WS")|g" \
    -e "s|{{PROXY_SANDBOXES}}|$(escape_sed_replacement "$PROXY_SANDBOXES")|g" \
    -e "s|{{SSL_CERT_PATH}}|$(escape_sed_replacement "$SSL_CERT_PATH")|g" \
    -e "s|{{SSL_KEY_PATH}}|$(escape_sed_replacement "$SSL_KEY_PATH")|g" \
    "$TEMPLATE" > "${OUTPUT}.tmp"

# Multi-line replacement for UPSTREAM_BLOCK via awk
UPSTREAM_FILE=$(mktemp)
printf '%s' "$UPSTREAM_BLOCK" > "$UPSTREAM_FILE"
awk -v rfile="$UPSTREAM_FILE" '{
    if (index($0, "{{UPSTREAM_BLOCK}}")) {
        while ((getline line < rfile) > 0) print line
        close(rfile)
    } else {
        print
    }
}' "${OUTPUT}.tmp" > "$OUTPUT"
rm -f "${OUTPUT}.tmp" "$UPSTREAM_FILE"

echo "Generated $OUTPUT (BE_PORT=${BE_PORT}, WS_PORT=${WS_PORT}, SUFFIX=${SUFFIX}, SANDBOX_URL=${SANDBOX_URL})"
if [ -n "${BE_CLUSTER:-}" ]; then
    echo "Cluster mode: BE_CLUSTER=${BE_CLUSTER}"
fi
echo "Initialized HTTPS certificate: $SSL_CERT"
