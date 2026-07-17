#!/bin/sh
set -eu

log() {
  printf '[bycli] %s\n' "$*"
}

if [ "${OPENCLAW_BOOTSTRAPPED:-}" != "1" ] && [ -f /usr/local/bin/openclaw-runtime-bootstrap ]; then
  # shellcheck disable=SC1091
  . /usr/local/bin/openclaw-runtime-bootstrap
fi

: "${OPENCLAW_ENABLE_OPENCLI:=auto}"
: "${OPENCLAW_STATE_DIR:=/by/.openclaw}"
: "${OPENCLAW_CONFIG_FILE:=${OPENCLAW_STATE_DIR}/openclaw.json}"
: "${OPENCLI_PROFILE:=openclaw}"
: "${OPENCLI_PROFILE_WATCH:=true}"
: "${OPENCLI_PROFILE_INIT_INTERVAL:=30}"
: "${OPENCLI_COMMAND_TIMEOUT:=3}"
: "${BYCLI_CONFIG_DIR:=/by/.bycli}"

case "${BYCLI_CONFIG_DIR}" in
  /*) ;;
  *)
    log "BYCLI_CONFIG_DIR must be an absolute path: ${BYCLI_CONFIG_DIR}"
    exit 1
    ;;
esac
export BYCLI_CONFIG_DIR

case "${OPENCLAW_ENABLE_OPENCLI}" in
  false|0|no|off)
    log "disabled"
    exit 0
    ;;
esac

if [ -f "${OPENCLAW_CONFIG_FILE}" ] && command -v python3 >/dev/null 2>&1; then
  OPENCLI_PROFILE="$(
    python3 - <<'PY'
import json
import os

config_file = os.environ.get("OPENCLAW_CONFIG_FILE", "")
try:
    with open(config_file, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
except Exception:
    cfg = {}

browser = cfg.get("browser") or ((cfg.get("tools") or {}).get("browser") or {})
if browser.get("enabled") is False:
    print("__disabled__")
    raise SystemExit
print(browser.get("defaultProfile") or browser.get("profile") or os.environ.get("OPENCLI_PROFILE") or "openclaw")
PY
  )"
  if [ "${OPENCLI_PROFILE}" = "__disabled__" ]; then
    log "disabled by openclaw.json"
    exit 0
  fi
  export OPENCLI_PROFILE
fi

if ! command -v bycli >/dev/null 2>&1; then
  if [ "${OPENCLAW_ENABLE_OPENCLI}" = "true" ]; then
    log "bycli binary not found"
    exit 1
  fi
  log "bycli binary not found; skip"
  exit 0
fi

# /by is mounted at sandbox runtime, after the image is built. Initialize the
# per-user byCLI tree only after that mount is visible.
mkdir -p \
  "${BYCLI_CONFIG_DIR}/clis" \
  "${BYCLI_CONFIG_DIR}/sites" \
  "${BYCLI_CONFIG_DIR}/.recorder-drafts"
# Backend (appuser) and sandbox (root) are separate processes sharing this
# per-user volume, so directory ownership alone cannot provide write access.
chmod a+rwx \
  "${BYCLI_CONFIG_DIR}" \
  "${BYCLI_CONFIG_DIR}/clis" \
  "${BYCLI_CONFIG_DIR}/sites" \
  "${BYCLI_CONFIG_DIR}/.recorder-drafts"

log "starting daemon and watching profile alias: ${OPENCLI_PROFILE}"

run_bycli() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${OPENCLI_COMMAND_TIMEOUT}" bycli "$@"
  else
    bycli "$@"
  fi
}

run_bycli_without_profile() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${OPENCLI_COMMAND_TIMEOUT}" env -u OPENCLI_PROFILE bycli "$@"
  else
    env -u OPENCLI_PROFILE bycli "$@"
  fi
}

run_bycli daemon restart >/tmp/openclaw-opencli-daemon.log 2>&1 || true

while true; do
  output="$(run_bycli_without_profile profile list 2>/dev/null || true)"

  if printf '%s\n' "${output}" | grep -Eq "[[:space:]]${OPENCLI_PROFILE}([[:space:]]|[),]|$)"; then
    run_bycli profile use "${OPENCLI_PROFILE}" >/tmp/openclaw-opencli-use.log 2>&1 || true
    run_bycli doctor >/tmp/openclaw-opencli-doctor.log 2>&1 || true
    log "profile ${OPENCLI_PROFILE} is ready"
    case "${OPENCLI_PROFILE_WATCH}" in
      false|0|no|off) exit 0 ;;
    esac
    sleep 30
    continue
  fi

  context_id="$(
    printf '%s\n' "${output}" | awk '
      /connected/ && $0 !~ /^[[:space:]]*No[[:space:]]/ {
        for (i = 1; i <= NF; i++) {
          if ($i == "•" || $i == "—" || $i == "-" || $i == "connected" || $i ~ /^v[0-9]/) {
            continue
          }
          if ($i ~ /^[A-Za-z0-9_-]+$/) {
            print $i
            exit
          }
        }
      }
    '
  )"

  if [ -n "${context_id}" ]; then
    run_bycli_without_profile profile rename "${context_id}" "${OPENCLI_PROFILE}" >/tmp/openclaw-opencli-rename.log 2>&1 || true
    run_bycli profile use "${OPENCLI_PROFILE}" >/tmp/openclaw-opencli-use.log 2>&1 || true
    run_bycli doctor >/tmp/openclaw-opencli-doctor.log 2>&1 || true
    log "profile ${OPENCLI_PROFILE} is bound to context ${context_id}"
    case "${OPENCLI_PROFILE_WATCH}" in
      false|0|no|off) exit 0 ;;
    esac
    sleep 30
    continue
  fi

  sleep "${OPENCLI_PROFILE_INIT_INTERVAL}"
done
