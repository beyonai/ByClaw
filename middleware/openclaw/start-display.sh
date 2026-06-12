#!/bin/sh
set -eu

log() {
  printf '[display] %s\n' "$*"
}

if [ "${OPENCLAW_BOOTSTRAPPED:-}" != "1" ] && [ -f /usr/local/bin/openclaw-runtime-bootstrap ]; then
  # shellcheck disable=SC1091
  . /usr/local/bin/openclaw-runtime-bootstrap
fi

: "${OPENCLAW_ENABLE_DISPLAY:=auto}"
: "${DISPLAY:=:99}"

case "${OPENCLAW_ENABLE_DISPLAY}" in
  false|0|no|off)
    log "disabled"
    exit 0
    ;;
esac

if ! command -v Xvfb >/dev/null 2>&1; then
  log "Xvfb not found; skip"
  exit 0
fi

if pgrep -f "Xvfb ${DISPLAY}" >/dev/null 2>&1; then
  log "already running on ${DISPLAY}"
  exit 0
fi

log "starting Xvfb on ${DISPLAY}"
Xvfb "${DISPLAY}" -screen 0 "${OPENCLAW_XVFB_SCREEN:-1365x768x24}" -nolisten tcp >/tmp/openclaw-xvfb.log 2>&1 &
