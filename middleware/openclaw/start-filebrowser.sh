#!/bin/sh
set -eu

log() {
  printf '[filebrowser] %s\n' "$*"
}

if [ "${OPENCLAW_BOOTSTRAPPED:-}" != "1" ] && [ -f /usr/local/bin/openclaw-runtime-bootstrap ]; then
  # shellcheck disable=SC1091
  . /usr/local/bin/openclaw-runtime-bootstrap
fi

: "${OPENCLAW_ENABLE_FILEBROWSER:=true}"
: "${OPENCLAW_STATE_DIR:=/by/.openclaw}"
: "${FILEBROWSER_ROOT:=${OPENCLAW_STATE_DIR}}"
: "${FILEBROWSER_PORT:=8082}"
: "${FILEBROWSER_ADDRESS:=0.0.0.0}"
: "${FILEBROWSER_BASEURL:=/filebrowser}"

case "${OPENCLAW_ENABLE_FILEBROWSER}" in
  false|0|no|off)
    log "disabled"
    exit 0
    ;;
esac

if ! command -v filebrowser >/dev/null 2>&1; then
  log "filebrowser binary not found; skip"
  exit 0
fi

mkdir -p "${FILEBROWSER_ROOT}"

if pgrep -f "filebrowser .*--port ${FILEBROWSER_PORT}" >/dev/null 2>&1; then
  log "already running on port ${FILEBROWSER_PORT}"
  exit 0
fi

log "starting on ${FILEBROWSER_ADDRESS}:${FILEBROWSER_PORT}, root=${FILEBROWSER_ROOT}"
filebrowser \
  --root "${FILEBROWSER_ROOT}" \
  --port "${FILEBROWSER_PORT}" \
  --address "${FILEBROWSER_ADDRESS}" \
  --noauth \
  --baseurl "${FILEBROWSER_BASEURL}" \
  >/tmp/openclaw-filebrowser.log 2>&1 &
