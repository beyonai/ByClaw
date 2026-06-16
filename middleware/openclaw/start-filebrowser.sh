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
: "${FILEBROWSER_UPSTREAM_PORT:=18082}"
: "${FILEBROWSER_UPSTREAM_ADDRESS:=127.0.0.1}"
: "${FILEBROWSER_UI_DIR:=/usr/local/share/openclaw/filebrowser-ui}"
: "${FILEBROWSER_UI_PROXY:=/usr/local/bin/openclaw-filebrowser-ui-proxy}"

if [ -z "${FILEBROWSER_DEFAULT_PATH:-}" ]; then
  FILEBROWSER_DEFAULT_PATH="${OPENCLAW_STATE_DIR%/}"
fi

if [ -z "${FILEBROWSER_ALLOWED_ROOTS:-}" ]; then
  FILEBROWSER_ALLOWED_ROOTS="${OPENCLAW_STATE_DIR%/}"
fi

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

if pgrep -f "openclaw-filebrowser-ui-proxy .*--port ${FILEBROWSER_PORT}" >/dev/null 2>&1; then
  log "already running on port ${FILEBROWSER_PORT}"
  exit 0
fi

if [ -f "${FILEBROWSER_UI_PROXY}" ] && [ -d "${FILEBROWSER_UI_DIR}" ]; then
  if ! pgrep -f "filebrowser .*--port ${FILEBROWSER_UPSTREAM_PORT}" >/dev/null 2>&1; then
    log "starting upstream filebrowser on ${FILEBROWSER_UPSTREAM_ADDRESS}:${FILEBROWSER_UPSTREAM_PORT}, root=${FILEBROWSER_ROOT}"
    filebrowser \
      --root "${FILEBROWSER_ROOT}" \
      --port "${FILEBROWSER_UPSTREAM_PORT}" \
      --address "${FILEBROWSER_UPSTREAM_ADDRESS}" \
      --noauth \
      --baseurl "${FILEBROWSER_BASEURL}" \
      >/tmp/openclaw-filebrowser-upstream.log 2>&1 &
  fi

  log "starting ByClaw filebrowser UI on ${FILEBROWSER_ADDRESS}:${FILEBROWSER_PORT}, root=${FILEBROWSER_ROOT}, default=${FILEBROWSER_DEFAULT_PATH}"
  python3 "${FILEBROWSER_UI_PROXY}" \
    --root "${FILEBROWSER_ROOT}" \
    --port "${FILEBROWSER_PORT}" \
    --address "${FILEBROWSER_ADDRESS}" \
    --baseurl "${FILEBROWSER_BASEURL}" \
    --upstream "http://${FILEBROWSER_UPSTREAM_ADDRESS}:${FILEBROWSER_UPSTREAM_PORT}" \
    --ui-dir "${FILEBROWSER_UI_DIR}" \
    --default-path "${FILEBROWSER_DEFAULT_PATH}" \
    --allowed-roots "${FILEBROWSER_ALLOWED_ROOTS}" \
    >/tmp/openclaw-filebrowser-ui.log 2>&1 &
else
  log "ByClaw UI proxy not found; starting native filebrowser on ${FILEBROWSER_ADDRESS}:${FILEBROWSER_PORT}"
  filebrowser \
    --root "${FILEBROWSER_ROOT}" \
    --port "${FILEBROWSER_PORT}" \
    --address "${FILEBROWSER_ADDRESS}" \
    --noauth \
    --baseurl "${FILEBROWSER_BASEURL}" \
    >/tmp/openclaw-filebrowser.log 2>&1 &
fi
