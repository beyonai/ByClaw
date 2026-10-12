#!/bin/sh
set -eu

log() {
  printf '[startAll] %s\n' "$*"
}

if [ -f /usr/local/bin/openclaw-runtime-bootstrap ]; then
  # shellcheck disable=SC1091
  . /usr/local/bin/openclaw-runtime-bootstrap
fi

: "${OPENCLAW_STATE_DIR:=/by/.openclaw}"
: "${OPENCLAW_NODE_DIAGNOSTICS_DIR:=/by/node-diagnostics}"

mkdir -p "${OPENCLAW_NODE_DIAGNOSTICS_DIR}"
chmod 1777 "${OPENCLAW_NODE_DIAGNOSTICS_DIR}" 2>/dev/null || true

log "state dir: ${OPENCLAW_STATE_DIR}"
log "config file: ${OPENCLAW_CONFIG_FILE:-${OPENCLAW_STATE_DIR}/openclaw.json}"

if command -v start-filebrowser.sh >/dev/null 2>&1; then
  start-filebrowser.sh
fi

if command -v start-display.sh >/dev/null 2>&1; then
  start-display.sh
fi

if command -v start-vnc.sh >/dev/null 2>&1; then
  start-vnc.sh
fi

if command -v start-opencli.sh >/dev/null 2>&1; then
  start-opencli.sh >/tmp/openclaw-opencli-profile.log 2>&1 &
fi

exec start-openclaw.sh
