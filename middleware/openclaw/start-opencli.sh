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
: "${BYCLI_TRUSTED_GID:=$(id -g)}"
: "${BYCLAW_MAIL_ADAPTER_SOURCE:=/usr/local/share/byclaw/bycli-adapters/mail.iwhalecloud.com/mail.js}"

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

python3 - "${BYCLI_CONFIG_DIR}" "${BYCLAW_MAIL_ADAPTER_SOURCE}" "${BYCLI_TRUSTED_GID}" <<'PY'
import os
import secrets
import stat
import sys

config_path, source_path, trusted_gid_text = sys.argv[1:]
if not trusted_gid_text.isdecimal():
    raise PermissionError("invalid trusted byCLI group")
trusted_gid = int(trusted_gid_text)
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

def components(path):
    if sys.platform == "darwin" and path == "/var":
        path = "/private/var"
    elif sys.platform == "darwin" and path.startswith("/var/"):
        path = "/private" + path
    elif sys.platform == "darwin" and (path == "/tmp" or path.startswith("/tmp/")):
        path = "/private" + path
    if not path.startswith("/"):
        raise PermissionError("path must be absolute")
    result = [part for part in path.split("/") if part]
    if any(part in {".", ".."} for part in result):
        raise PermissionError("unsafe path")
    return result

def open_directory(path, create=False):
    current = os.open("/", flags)
    try:
        for part in components(path):
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=current)
                except FileExistsError:
                    pass
            next_fd = os.open(part, flags, dir_fd=current)
            os.close(current)
            current = next_fd
        return current
    except BaseException:
        os.close(current)
        raise

def open_file(path):
    parts = components(path)
    if not parts:
        raise PermissionError("unsafe source")
    parent = open_directory("/" + "/".join(parts[:-1]))
    try:
        return os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
    finally:
        os.close(parent)

config_fd = open_directory(config_path, create=True)
def secure_shared(fd, mode):
    current = os.fstat(fd)
    if current.st_gid != trusted_gid:
        if current.st_uid != os.geteuid():
            raise PermissionError("unsafe byCLI ownership")
        os.fchown(fd, -1, trusted_gid)
        current = os.fstat(fd)
    if current.st_gid != trusted_gid or (current.st_mode & 0o007 and current.st_uid != os.geteuid()):
        raise PermissionError("unsafe byCLI group contract")
    os.fchmod(fd, mode)

secure_shared(config_fd, 0o2770)
child_fds = {}
for name in ("clis", "sites", ".recorder-drafts"):
    try:
        os.mkdir(name, 0o700, dir_fd=config_fd)
    except FileExistsError:
        pass
    child_fd = os.open(name, flags, dir_fd=config_fd)
    secure_shared(child_fd, 0o2770)
    child_fds[name] = child_fd
clis_fd = child_fds["clis"]
managed_fd = None
temporary = None
try:
    try:
        os.mkdir("mail.iwhalecloud.com", 0o700, dir_fd=clis_fd)
    except FileExistsError:
        pass
    managed_fd = os.open("mail.iwhalecloud.com", flags, dir_fd=clis_fd)
    managed_stat = os.fstat(managed_fd)
    if not stat.S_ISDIR(managed_stat.st_mode):
        raise PermissionError("unsafe managed adapter directory")
    secure_shared(managed_fd, 0o2770)
    try:
        target_stat = os.stat("byclaw-mail.js", dir_fd=managed_fd, follow_symlinks=False)
        if not stat.S_ISREG(target_stat.st_mode) or target_stat.st_gid != trusted_gid or target_stat.st_mode & 0o027:
            raise PermissionError("unsafe managed adapter target")
    except FileNotFoundError:
        pass
    source_fd = open_file(source_path)
    try:
        if not stat.S_ISREG(os.fstat(source_fd).st_mode):
            raise PermissionError("unsafe managed adapter source")
        temporary = f".byclaw-mail.{secrets.token_hex(12)}"
        output_fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                            0o640, dir_fd=managed_fd)
        try:
            while True:
                chunk = os.read(source_fd, 65536)
                if not chunk:
                    break
                view = memoryview(chunk)
                while view:
                    written = os.write(output_fd, view)
                    if written <= 0:
                        raise OSError("short managed-adapter write")
                    view = view[written:]
            os.fsync(output_fd)
            os.fchmod(output_fd, 0o640)
        finally:
            os.close(output_fd)
    finally:
        os.close(source_fd)
    os.rename(temporary, "byclaw-mail.js", src_dir_fd=managed_fd, dst_dir_fd=managed_fd)
    os.fsync(managed_fd)
    temporary = None
finally:
    if temporary is not None and managed_fd is not None:
        try:
            os.unlink(temporary, dir_fd=managed_fd)
        except FileNotFoundError:
            pass
    if managed_fd is not None:
        os.close(managed_fd)
    for child_fd in child_fds.values():
        os.close(child_fd)
    os.close(config_fd)
PY

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

run_bycli daemon restart >/dev/null 2>&1 || true

while true; do
  output="$(run_bycli_without_profile profile list 2>/dev/null || true)"

  if printf '%s\n' "${output}" | grep -Eq "[[:space:]]${OPENCLI_PROFILE}([[:space:]]|[),]|$)"; then
    run_bycli profile use "${OPENCLI_PROFILE}" >/dev/null 2>&1 || true
    run_bycli doctor >/dev/null 2>&1 || true
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
    run_bycli_without_profile profile rename "${context_id}" "${OPENCLI_PROFILE}" >/dev/null 2>&1 || true
    run_bycli profile use "${OPENCLI_PROFILE}" >/dev/null 2>&1 || true
    run_bycli doctor >/dev/null 2>&1 || true
    log "profile ${OPENCLI_PROFILE} is bound to context ${context_id}"
    case "${OPENCLI_PROFILE_WATCH}" in
      false|0|no|off) exit 0 ;;
    esac
    sleep 30
    continue
  fi

  sleep "${OPENCLI_PROFILE_INIT_INTERVAL}"
done
