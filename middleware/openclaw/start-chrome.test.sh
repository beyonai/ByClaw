#!/bin/sh
set -eu

test_root="$(mktemp -d)"
trap 'rm -rf "${test_root}"' EXIT

fake_bin="${test_root}/bin"
extension_dir="${test_root}/extension"
user_data_dir="${test_root}/user-data"
state_dir="${test_root}/state"
mkdir -p "${fake_bin}" "${extension_dir}" "${user_data_dir}" "${state_dir}"
touch "${extension_dir}/manifest.json"

cat > "${fake_bin}/chromium" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" > "${START_CHROME_TEST_ARGS}"
EOF
cat > "${fake_bin}/Xvfb" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "${fake_bin}/chromium" "${fake_bin}/Xvfb"

ln -s "$(hostname)-999999" "${user_data_dir}/SingletonLock"
ln -s stale-cookie "${user_data_dir}/SingletonCookie"
ln -s "${test_root}/stale-socket" "${user_data_dir}/SingletonSocket"

PATH="${fake_bin}:${PATH}" \
START_CHROME_TEST_ARGS="${test_root}/chromium.args" \
OPENCLAW_STATE_DIR="${state_dir}" \
OPENCLAW_BROWSER_USER_DATA_DIR="${user_data_dir}" \
OPENCLAW_CHROME_REMOTE_DEBUGGING_ADDRESS=127.0.0.1 \
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
