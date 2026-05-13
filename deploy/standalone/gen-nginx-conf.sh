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

sed -e "s/{{BE_SERVER_PORT}}/${BE_PORT}/g" \
    -e "s/{{BE_WS_PORT}}/${WS_PORT}/g" \
    -e "s/{{CONTAINER_SUFFIX}}/${SUFFIX}/g" \
    "$TEMPLATE" > "$OUTPUT"

echo "Generated $OUTPUT (BE_PORT=${BE_PORT}, WS_PORT=${WS_PORT}, SUFFIX=${SUFFIX})"
