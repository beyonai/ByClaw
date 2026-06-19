#!/bin/sh
set -eu

log() {
  printf '[openclaw] %s\n' "$*"
}

if [ "${OPENCLAW_BOOTSTRAPPED:-}" != "1" ] && [ -f /usr/local/bin/openclaw-runtime-bootstrap ]; then
  # shellcheck disable=SC1091
  . /usr/local/bin/openclaw-runtime-bootstrap
fi

: "${OPENCLAW_GATEWAY_BIND:=lan}"
: "${OPENCLAW_GATEWAY_PORT:=8080}"

cd /app
log "starting gateway on ${OPENCLAW_GATEWAY_BIND}:${OPENCLAW_GATEWAY_PORT}"
exec node dist/index.js gateway --bind="${OPENCLAW_GATEWAY_BIND}" --port="${OPENCLAW_GATEWAY_PORT}" --allow-unconfigured --verbose
