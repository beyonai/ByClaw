#!/bin/bash
#
# Generate nginx-standalone.conf from .tpl template + .env variables.
# Only replaces {{VAR}} placeholders — no heredoc duplication.
#
cd "$(dirname "$0")"

ENV_FILE="../../.env"
TEMPLATE="../config/nginx-standalone.conf.tpl"
OUTPUT="../config/nginx-standalone.conf"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found!"
    exit 1
fi

if [ ! -f "$TEMPLATE" ]; then
    echo "Error: $TEMPLATE not found!"
    exit 1
fi

set -a
. "$ENV_FILE"
set +a

BE_PORT="${BE_SERVER_PORT:-8086}"
WS_PORT="${BE_WS_PORT:-8082}"
SUFFIX="${CONTAINER_SUFFIX:-standalone}"
BACKEND="byclaw-be-${SUFFIX}"

# Platform-specific nginx config strategy:
# - Docker (Linux): use resolver 127.0.0.11 + variable proxy_pass for lazy DNS
# - Podman (macOS): use direct proxy_pass (depends_on ensures BE is ready)
if [ "$(uname)" = "Darwin" ] && command -v podman &>/dev/null; then
    RESOLVER_BLOCK=""
    BACKEND_VARS=""
    PROXY_HTTP="http://${BACKEND}:${BE_PORT}"
    PROXY_WS="http://${BACKEND}:${WS_PORT}"
else
    RESOLVER_BLOCK="resolver 127.0.0.11 valid=10s;"
    BACKEND_VARS="set \$backend_http \"http://${BACKEND}:${BE_PORT}\";\n    set \$backend_ws \"http://${BACKEND}:${WS_PORT}\";"
    PROXY_HTTP="\$backend_http"
    PROXY_WS="\$backend_ws"
fi

sed -e "s|{{BE_SERVER_PORT}}|${BE_PORT}|g" \
    -e "s|{{BE_WS_PORT}}|${WS_PORT}|g" \
    -e "s|{{CONTAINER_SUFFIX}}|${SUFFIX}|g" \
    -e "s|{{RESOLVER_BLOCK}}|${RESOLVER_BLOCK}|g" \
    -e "s|{{BACKEND_VARS}}|${BACKEND_VARS}|g" \
    -e "s|{{PROXY_HTTP}}|${PROXY_HTTP}|g" \
    -e "s|{{PROXY_WS}}|${PROXY_WS}|g" \
    "$TEMPLATE" > "$OUTPUT"

echo "Generated $OUTPUT (BE_PORT=${BE_PORT}, WS_PORT=${WS_PORT}, SUFFIX=${SUFFIX})"
