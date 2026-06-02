#!/bin/sh
set -eu

log() {
  printf '[vnc] %s\n' "$*"
}

if [ "${OPENCLAW_BOOTSTRAPPED:-}" != "1" ] && [ -f /usr/local/bin/openclaw-runtime-bootstrap ]; then
  # shellcheck disable=SC1091
  . /usr/local/bin/openclaw-runtime-bootstrap
fi

: "${OPENCLAW_ENABLE_VNC:=auto}"
: "${DISPLAY:=:99}"
: "${OPENCLAW_XVFB_SCREEN:=1365x768x24}"
: "${OPENCLAW_VNC_PORT:=5901}"
: "${OPENCLAW_VNC_WEB_PORT:=8081}"
: "${OPENCLAW_VNC_LISTEN_ADDRESS:=127.0.0.1}"
: "${OPENCLAW_VNC_WEB_LISTEN_ADDRESS:=0.0.0.0}"

case "${OPENCLAW_ENABLE_VNC}" in
  false|0|no|off)
    log "disabled"
    exit 0
    ;;
esac

if ! command -v x11vnc >/dev/null 2>&1; then
  log "x11vnc not found; skip"
  exit 0
fi

if ! command -v websockify >/dev/null 2>&1; then
  log "websockify not found; skip"
  exit 0
fi

if command -v Xvfb >/dev/null 2>&1 && ! pgrep -f "Xvfb ${DISPLAY}" >/dev/null 2>&1; then
  log "starting Xvfb on ${DISPLAY}"
  Xvfb "${DISPLAY}" -screen 0 "${OPENCLAW_XVFB_SCREEN}" -nolisten tcp >/tmp/openclaw-xvfb.log 2>&1 &
  sleep 1
fi

if ! pgrep -f "x11vnc .*${DISPLAY}.*${OPENCLAW_VNC_PORT}" >/dev/null 2>&1; then
  log "starting x11vnc on ${OPENCLAW_VNC_LISTEN_ADDRESS}:${OPENCLAW_VNC_PORT}, display=${DISPLAY}"
  x11vnc \
    -display "${DISPLAY}" \
    -localhost \
    -listen "${OPENCLAW_VNC_LISTEN_ADDRESS}" \
    -rfbport "${OPENCLAW_VNC_PORT}" \
    -forever \
    -shared \
    -nopw \
    -bg \
    -o /tmp/openclaw-x11vnc.log
fi

novnc_dir=""
for dir in /usr/share/novnc /usr/share/noVNC; do
  if [ -d "${dir}" ]; then
    novnc_dir="${dir}"
    break
  fi
done

if [ -z "${novnc_dir}" ]; then
  log "noVNC web assets not found; skip web endpoint"
  exit 0
fi

if pgrep -f "websockify .*${OPENCLAW_VNC_WEB_PORT}.*127.0.0.1:${OPENCLAW_VNC_PORT}" >/dev/null 2>&1; then
  log "noVNC already running on ${OPENCLAW_VNC_WEB_PORT}"
  exit 0
fi

log "starting noVNC on ${OPENCLAW_VNC_WEB_LISTEN_ADDRESS}:${OPENCLAW_VNC_WEB_PORT}"
websockify \
  --web="${novnc_dir}" \
  "${OPENCLAW_VNC_WEB_LISTEN_ADDRESS}:${OPENCLAW_VNC_WEB_PORT}" \
  "127.0.0.1:${OPENCLAW_VNC_PORT}" \
  >/tmp/openclaw-novnc.log 2>&1 &
