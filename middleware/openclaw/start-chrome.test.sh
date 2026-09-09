#!/bin/sh
set -eu

test_root="$(mktemp -d)"
cleanup() {
  find "${test_root}" -type f -name '*.pid' -print 2>/dev/null | while IFS= read -r pid_file; do
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    case "${pid}" in
      ''|*[!0-9]*) continue ;;
    esac
    kill "${pid}" 2>/dev/null || true
  done
  rm -rf "${test_root}"
}
trap cleanup EXIT

fake_bin="${test_root}/bin"
extension_dir="${test_root}/extension"
user_data_dir="${test_root}/user-data"
state_dir="${test_root}/state"
mkdir -p "${fake_bin}" "${extension_dir}" "${user_data_dir}" "${state_dir}"
touch "${extension_dir}/manifest.json"

cat > "${fake_bin}/chromium" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" > "${START_CHROME_TEST_ARGS}"
if (: >&9) 2>/dev/null; then
  printf 'inherited\n' > "${START_CHROME_TEST_CHROME_LOCK_FD}"
else
  printf 'closed\n' > "${START_CHROME_TEST_CHROME_LOCK_FD}"
fi
if [ "${START_CHROME_TEST_HOLD:-}" = "1" ]; then
  printf '%s\n' "$$" > "${START_CHROME_TEST_PID_FILE}"
  trap 'printf "%s\n" "$$" >> "${START_CHROME_TEST_TERMINATED}"; exit 0' TERM
  while :; do sleep 1; done
fi
EOF
cat > "${fake_bin}/Xvfb" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "${fake_bin}/python3" <<'EOF'
#!/bin/sh
if [ "${4:-}" = openclaw-chrome-port-proxy ]; then
  if (: >&9) 2>/dev/null; then
    printf 'inherited\n' > "${START_CHROME_TEST_PROXY_LOCK_FD}"
  else
    printf 'closed\n' > "${START_CHROME_TEST_PROXY_LOCK_FD}"
  fi
  exit 0
fi
exit 1
EOF
chmod +x "${fake_bin}/chromium" "${fake_bin}/Xvfb" "${fake_bin}/python3"

ln -s "$(hostname)-999999" "${user_data_dir}/SingletonLock"
ln -s stale-cookie "${user_data_dir}/SingletonCookie"
ln -s "${test_root}/stale-socket" "${user_data_dir}/SingletonSocket"

PATH="${fake_bin}:${PATH}" \
START_CHROME_TEST_ARGS="${test_root}/chromium.args" \
START_CHROME_TEST_CHROME_LOCK_FD="${test_root}/chromium.lock-fd" \
START_CHROME_TEST_PROXY_LOCK_FD="${test_root}/proxy.lock-fd" \
OPENCLAW_STATE_DIR="${state_dir}" \
OPENCLAW_BROWSER_USER_DATA_DIR="${user_data_dir}" \
OPENCLAW_CHROME_REMOTE_DEBUGGING_ADDRESS=0.0.0.0 \
OPENCLAW_XVFB_SCREEN=1600x960x24 \
OPENCLI_EXTENSION_DIR="${extension_dir}" \
OPENCLAW_ENABLE_CHROME=true \
OPENCLAW_CONFIG_FILE="${test_root}/missing-openclaw.json" \
"$(dirname "$0")/start-chrome.sh"

attempt=0
while [ ! -f "${test_root}/chromium.args" ] && [ "${attempt}" -lt 20 ]; do
  sleep 1
  attempt=$((attempt + 1))
done

test -z "$(find "${user_data_dir}" -maxdepth 1 -name SingletonLock -print)"
test -z "$(find "${user_data_dir}" -maxdepth 1 -name SingletonCookie -print)"
test -z "$(find "${user_data_dir}" -maxdepth 1 -name SingletonSocket -print)"
grep -Fx -- "--load-extension=${extension_dir}" "${test_root}/chromium.args"
grep -Fx -- "--window-size=1600,960" "${test_root}/chromium.args"
grep -Fx -- "--window-position=0,0" "${test_root}/chromium.args"
grep -Fx -- closed "${test_root}/chromium.lock-fd"
grep -Fx -- closed "${test_root}/proxy.lock-fd"

PATH="${fake_bin}:${PATH}" \
START_CHROME_TEST_ARGS="${test_root}/chromium-override.args" \
START_CHROME_TEST_CHROME_LOCK_FD="${test_root}/chromium-override.lock-fd" \
OPENCLAW_STATE_DIR="${state_dir}" \
OPENCLAW_BROWSER_USER_DATA_DIR="${user_data_dir}" \
OPENCLAW_CHROME_REMOTE_DEBUGGING_ADDRESS=127.0.0.1 \
OPENCLAW_XVFB_SCREEN=1600x960x24 \
OPENCLAW_CHROME_WINDOW_SIZE=1280,720 \
OPENCLI_EXTENSION_DIR="${extension_dir}" \
OPENCLAW_ENABLE_CHROME=true \
OPENCLAW_CONFIG_FILE="${test_root}/missing-openclaw.json" \
"$(dirname "$0")/start-chrome.sh"

attempt=0
while [ ! -f "${test_root}/chromium-override.args" ] && [ "${attempt}" -lt 20 ]; do
  sleep 1
  attempt=$((attempt + 1))
done

grep -Fx -- "--window-size=1280,720" "${test_root}/chromium-override.args"
grep -Fx -- "--window-position=0,0" "${test_root}/chromium-override.args"

lifecycle_extension_dir="${test_root}/lifecycle-extension"
lifecycle_user_data_dir="${test_root}/lifecycle-user-data"
lifecycle_state_dir="${test_root}/lifecycle-state"
lifecycle_pid_file="${test_root}/lifecycle-chromium.pid"
lifecycle_terminated="${test_root}/lifecycle-terminated"
lifecycle_marker="${lifecycle_state_dir}/opencli/extension-runtime.fingerprint"
mkdir -p \
  "${lifecycle_extension_dir}/dist" \
  "${lifecycle_user_data_dir}" \
  "${lifecycle_state_dir}"
printf '%s\n' '{"version":"2.1.22"}' > "${lifecycle_extension_dir}/manifest.json"
printf '%s\n' 'const capability = "ima-reader-v1";' > "${lifecycle_extension_dir}/dist/background.js"

run_lifecycle_start() {
  PATH="${fake_bin}:${PATH}" \
  START_CHROME_TEST_ARGS="${test_root}/lifecycle-chromium.args" \
  START_CHROME_TEST_CHROME_LOCK_FD="${test_root}/lifecycle-chromium.lock-fd" \
  START_CHROME_TEST_PID_FILE="${lifecycle_pid_file}" \
  START_CHROME_TEST_TERMINATED="${lifecycle_terminated}" \
  START_CHROME_TEST_HOLD=1 \
  OPENCLAW_STATE_DIR="${lifecycle_state_dir}" \
  OPENCLAW_BROWSER_USER_DATA_DIR="${lifecycle_user_data_dir}" \
  OPENCLAW_CHROME_REMOTE_DEBUGGING_ADDRESS=127.0.0.1 \
  OPENCLI_EXTENSION_DIR="${lifecycle_extension_dir}" \
  OPENCLAW_ENABLE_CHROME=true \
  OPENCLAW_CONFIG_FILE="${test_root}/missing-openclaw.json" \
  "$(dirname "$0")/start-chrome.sh"
}

run_lifecycle_start
attempt=0
while [ ! -f "${lifecycle_pid_file}" ] && [ "${attempt}" -lt 20 ]; do
  sleep 1
  attempt=$((attempt + 1))
done
test -f "${lifecycle_marker}"
original_fingerprint="$(cat "${lifecycle_marker}")"
original_pid="$(cat "${lifecycle_pid_file}")"
kill -0 "${original_pid}"

run_lifecycle_start
test "$(cat "${lifecycle_pid_file}")" = "${original_pid}"
test ! -f "${lifecycle_terminated}"

printf '%s\n' 'const capability = "ima-reader-v2";' > "${lifecycle_extension_dir}/dist/background.js"
run_lifecycle_start
attempt=0
while [ "$(cat "${lifecycle_pid_file}")" = "${original_pid}" ] && [ "${attempt}" -lt 20 ]; do
  sleep 1
  attempt=$((attempt + 1))
done
replacement_pid="$(cat "${lifecycle_pid_file}")"
test "${replacement_pid}" != "${original_pid}"
grep -Fx -- "${original_pid}" "${lifecycle_terminated}"
test "$(cat "${lifecycle_marker}")" != "${original_fingerprint}"

no_extension_dir="${test_root}/no-extension"
no_extension_user_data_dir="${test_root}/no-extension-user-data"
no_extension_state_dir="${test_root}/no-extension-state"
no_extension_pid_file="${test_root}/no-extension-chromium.pid"
no_extension_terminated="${test_root}/no-extension-terminated"
mkdir -p "${no_extension_dir}" "${no_extension_user_data_dir}" "${no_extension_state_dir}"

run_no_extension_start() {
  PATH="${fake_bin}:${PATH}" \
  START_CHROME_TEST_ARGS="${test_root}/no-extension-chromium.args" \
  START_CHROME_TEST_CHROME_LOCK_FD="${test_root}/no-extension-chromium.lock-fd" \
  START_CHROME_TEST_PID_FILE="${no_extension_pid_file}" \
  START_CHROME_TEST_TERMINATED="${no_extension_terminated}" \
  START_CHROME_TEST_HOLD=1 \
  OPENCLAW_STATE_DIR="${no_extension_state_dir}" \
  OPENCLAW_BROWSER_USER_DATA_DIR="${no_extension_user_data_dir}" \
  OPENCLAW_CHROME_REMOTE_DEBUGGING_ADDRESS=127.0.0.1 \
  OPENCLI_EXTENSION_DIR="${no_extension_dir}" \
  OPENCLAW_ENABLE_CHROME=true \
  OPENCLAW_CONFIG_FILE="${test_root}/missing-openclaw.json" \
  "$(dirname "$0")/start-chrome.sh"
}

run_no_extension_start
attempt=0
while [ ! -f "${no_extension_pid_file}" ] && [ "${attempt}" -lt 20 ]; do
  sleep 1
  attempt=$((attempt + 1))
done
no_extension_pid="$(cat "${no_extension_pid_file}")"
run_no_extension_start
test "$(cat "${no_extension_pid_file}")" = "${no_extension_pid}"
test ! -f "${no_extension_terminated}"
