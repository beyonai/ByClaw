#!/bin/sh
set -eu

log() {
  printf '[chrome] %s\n' "$*"
}

if [ "${OPENCLAW_BOOTSTRAPPED:-}" != "1" ] && [ -f /usr/local/bin/openclaw-runtime-bootstrap ]; then
  # shellcheck disable=SC1091
  . /usr/local/bin/openclaw-runtime-bootstrap
fi

: "${OPENCLAW_ENABLE_CHROME:=auto}"
: "${OPENCLAW_STATE_DIR:=/by/.openclaw}"
: "${OPENCLAW_CONFIG_FILE:=${OPENCLAW_STATE_DIR}/openclaw.json}"
: "${OPENCLAW_BROWSER_PROFILE:=openclaw}"
: "${OPENCLAW_BROWSER_USER_DATA_DIR:=${OPENCLAW_STATE_DIR}/browser/${OPENCLAW_BROWSER_PROFILE}/user-data}"
: "${OPENCLAW_CHROME_EXECUTABLE:=google-chrome-stable}"
: "${OPENCLAW_CHROME_REMOTE_DEBUGGING_ADDRESS:=0.0.0.0}"
: "${OPENCLAW_CHROME_REMOTE_DEBUGGING_PORT:=9222}"
: "${OPENCLAW_CHROME_INTERNAL_REMOTE_DEBUGGING_PORT:=}"
: "${OPENCLI_EXTENSION_DIR:=/opt/opencli/extension}"
: "${DISPLAY:=:99}"

case "${OPENCLAW_ENABLE_CHROME}" in
  false|0|no|off)
    log "disabled"
    exit 0
    ;;
esac

if [ -f "${OPENCLAW_CONFIG_FILE}" ] && command -v python3 >/dev/null 2>&1; then
  eval "$(
    python3 - <<'PY'
import json
import os
import shlex

config_file = os.environ.get("OPENCLAW_CONFIG_FILE", "")
try:
    with open(config_file, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
except Exception:
    cfg = {}

browser = cfg.get("browser") or ((cfg.get("tools") or {}).get("browser") or {})
profile = (
    browser.get("defaultProfile")
    or browser.get("profile")
    or os.environ.get("OPENCLAW_BROWSER_PROFILE")
    or "openclaw"
)
profiles = browser.get("profiles") or {}
entry = profiles.get(profile) if isinstance(profiles, dict) else {}
if not isinstance(entry, dict):
    entry = {}

values = {
    "OPENCLAW_BROWSER_ENABLED": browser.get("enabled", os.environ.get("OPENCLAW_ENABLE_CHROME", "auto")),
    "OPENCLAW_BROWSER_PROFILE": profile,
    "OPENCLAW_BROWSER_USER_DATA_DIR": entry.get("userDataDir") or os.environ.get("OPENCLAW_BROWSER_USER_DATA_DIR") or f"/by/.openclaw/browser/{profile}/user-data",
    "OPENCLAW_CHROME_EXECUTABLE": entry.get("executablePath") or os.environ.get("OPENCLAW_CHROME_EXECUTABLE") or "google-chrome-stable",
}
for key, value in values.items():
    print(f"export {key}={shlex.quote(str(value))}")
PY
  )"
fi

case "${OPENCLAW_BROWSER_ENABLED:-${OPENCLAW_ENABLE_CHROME}}" in
  false|0|no|off)
    log "disabled by openclaw.json"
    exit 0
    ;;
esac

if ! command -v "${OPENCLAW_CHROME_EXECUTABLE}" >/dev/null 2>&1; then
  if [ "${OPENCLAW_CHROME_EXECUTABLE}" = "google-chrome-stable" ] && command -v chromium >/dev/null 2>&1; then
    log "google-chrome-stable not found; falling back to chromium"
    OPENCLAW_CHROME_EXECUTABLE=chromium
  fi
fi

if ! command -v "${OPENCLAW_CHROME_EXECUTABLE}" >/dev/null 2>&1; then
  if [ "${OPENCLAW_ENABLE_CHROME}" = "true" ]; then
    log "Chrome executable not found: ${OPENCLAW_CHROME_EXECUTABLE}"
    exit 1
  fi
  log "Chrome executable not found; skip"
  exit 0
fi

if ! command -v Xvfb >/dev/null 2>&1; then
  if [ "${OPENCLAW_ENABLE_CHROME}" = "true" ]; then
    log "Xvfb not found"
    exit 1
  fi
  log "Xvfb not found; skip"
  exit 0
fi

mkdir -p "${OPENCLAW_BROWSER_USER_DATA_DIR}" "${OPENCLAW_STATE_DIR}/opencli"

if command -v flock >/dev/null 2>&1; then
  exec 9>"${OPENCLAW_STATE_DIR}/opencli/chrome-start.lock"
  if ! flock -n 9; then
    log "startup is already in progress"
    exit 0
  fi
fi

clear_stale_profile_lock() {
  profile_lock="${OPENCLAW_BROWSER_USER_DATA_DIR}/SingletonLock"
  [ -L "${profile_lock}" ] || return 0

  lock_target="$(readlink "${profile_lock}" 2>/dev/null || true)"
  lock_pid="${lock_target##*-}"
  case "${lock_pid}" in
    ''|*[!0-9]*) return 0 ;;
  esac

  if ps -p "${lock_pid}" -o args= 2>/dev/null | grep -F -- "--user-data-dir=${OPENCLAW_BROWSER_USER_DATA_DIR}" >/dev/null; then
    return 0
  fi

  log "removing stale Chromium profile lock (PID ${lock_pid})"
  rm -f \
    "${OPENCLAW_BROWSER_USER_DATA_DIR}/SingletonLock" \
    "${OPENCLAW_BROWSER_USER_DATA_DIR}/SingletonCookie" \
    "${OPENCLAW_BROWSER_USER_DATA_DIR}/SingletonSocket"
}

clear_stale_profile_lock

xvfb_screen="${OPENCLAW_XVFB_SCREEN:-1365x768x24}"
xvfb_width="${xvfb_screen%%x*}"
xvfb_height_and_depth="${xvfb_screen#*x}"
xvfb_height="${xvfb_height_and_depth%%x*}"
chrome_window_size="${OPENCLAW_CHROME_WINDOW_SIZE:-${xvfb_width},${xvfb_height}}"

if ! pgrep -f "Xvfb ${DISPLAY}" >/dev/null 2>&1; then
  log "starting Xvfb on ${DISPLAY}"
  Xvfb "${DISPLAY}" -screen 0 "${xvfb_screen}" -nolisten tcp >/tmp/openclaw-xvfb.log 2>&1 9>&- &
  sleep 1
fi

chrome_debug_address="${OPENCLAW_CHROME_REMOTE_DEBUGGING_ADDRESS}"
chrome_debug_port="${OPENCLAW_CHROME_REMOTE_DEBUGGING_PORT}"
if [ "${OPENCLAW_CHROME_REMOTE_DEBUGGING_ADDRESS}" = "0.0.0.0" ]; then
  chrome_debug_address="127.0.0.1"
  chrome_debug_port="${OPENCLAW_CHROME_INTERNAL_REMOTE_DEBUGGING_PORT:-$((OPENCLAW_CHROME_REMOTE_DEBUGGING_PORT + 1))}"
  if ! pgrep -f "openclaw-chrome-port-proxy ${OPENCLAW_CHROME_REMOTE_DEBUGGING_PORT} ${chrome_debug_port}" >/dev/null 2>&1; then
    log "starting CDP proxy on 0.0.0.0:${OPENCLAW_CHROME_REMOTE_DEBUGGING_PORT} -> 127.0.0.1:${chrome_debug_port}"
    python3 - "${OPENCLAW_CHROME_REMOTE_DEBUGGING_PORT}" "${chrome_debug_port}" openclaw-chrome-port-proxy <<'PY' >/tmp/openclaw-chrome-port-proxy.log 2>&1 9>&- &
import select
import socket
import sys
import threading

LISTEN_PORT = int(sys.argv[1])
TARGET_PORT = int(sys.argv[2])

def pipe(src, dst):
    try:
        while True:
            ready, _, _ = select.select([src], [], [], 30)
            if not ready:
                continue
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    finally:
        for sock in (src, dst):
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass

def handle(client):
    try:
        upstream = socket.create_connection(("127.0.0.1", TARGET_PORT))
    except OSError:
        client.close()
        return
    threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
    threading.Thread(target=pipe, args=(upstream, client), daemon=True).start()

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("0.0.0.0", LISTEN_PORT))
server.listen(128)
print(f"openclaw-chrome-port-proxy {LISTEN_PORT} {TARGET_PORT}", flush=True)
while True:
    client, _ = server.accept()
    threading.Thread(target=handle, args=(client,), daemon=True).start()
PY
    sleep 1
  fi
fi

if pgrep -f "${OPENCLAW_CHROME_EXECUTABLE}.*--user-data-dir=${OPENCLAW_BROWSER_USER_DATA_DIR}" >/dev/null 2>&1; then
  log "already running for user data dir ${OPENCLAW_BROWSER_USER_DATA_DIR}"
  exit 0
fi

extension_args=""
if [ -f "${OPENCLI_EXTENSION_DIR}/manifest.json" ]; then
  extension_args="--load-extension=${OPENCLI_EXTENSION_DIR} --disable-extensions-except=${OPENCLI_EXTENSION_DIR}"
else
  log "OpenCLI extension not found at ${OPENCLI_EXTENSION_DIR}; starting Chrome without extension"
fi

log "starting ${OPENCLAW_CHROME_EXECUTABLE}, profile=${OPENCLAW_BROWSER_PROFILE}, userData=${OPENCLAW_BROWSER_USER_DATA_DIR}"
# shellcheck disable=SC2086
"${OPENCLAW_CHROME_EXECUTABLE}" \
  --user-data-dir="${OPENCLAW_BROWSER_USER_DATA_DIR}" \
  --remote-debugging-address="${chrome_debug_address}" \
  --remote-debugging-port="${chrome_debug_port}" \
  ${extension_args} \
  --no-first-run \
  --no-default-browser-check \
  --disable-dev-shm-usage \
  --no-sandbox \
  --window-size="${chrome_window_size}" \
  --window-position=0,0 \
  about:blank >/tmp/openclaw-chrome.log 2>&1 9>&- &
