#!/usr/bin/env bash
# Actual image/rootfs and SSH/database acceptance; touches only its own container.
set -Eeuo pipefail
image=${1:?usage: tool-software-development-smoke.sh IMAGE}
engine=${CONTAINER_ENGINE:-docker}
maximum=4294967296
probe=$("$engine" create "$image")
container=
cleanup() {
    if [[ -n "$container" ]]; then
        "$engine" logs "$container" >&2 || true
        "$engine" rm -f "$container" >/dev/null
    fi
    if [[ -n "$probe" ]]; then "$engine" rm -f "$probe" >/dev/null; fi
}
trap cleanup EXIT
bytes=$("$engine" export "$probe" | wc -c | tr -d ' ')
"$engine" rm "$probe" >/dev/null
probe=
test "$bytes" -lt "$maximum" || { echo "Image rootfs tar exceeds 4 GiB: $bytes" >&2; exit 1; }
container=$("$engine" run -d --network none --shm-size=512m \
    -e BYCLAW_TOOL_ENV_SEED_GENERATE=1 -e BYCLAW_TOOL_ENV_WS_PORT=8022 "$image")
wait_ready() {
    for attempt in $(seq 1 90); do
        if "$engine" exec "$container" test -f /run/byclaw-software-development/ready \
            && "$engine" exec "$container" curl -fsS http://127.0.0.1:8022/ >/dev/null 2>&1; then return; fi
        sleep 1
    done
    echo 'Software development sandbox did not become ready' >&2
    return 1
}
wait_ready
"$engine" exec -i "$container" bash -se <<'CHECK'
test ! -e /etc/ssh/ssh_host_ed25519_key
ssh-keygen -y -f /etc/byclaw-tool-env/host_ed25519 | awk '{print "127.0.0.1 " $0}' >/tmp/software-known-hosts
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/tmp/software-known-hosts \
    -i /etc/byclaw-tool-env/client_ed25519 byclaw@127.0.0.1 'bash -se' <<'SESSION'
test "$(id -un)" = byclaw
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = development
test "$UV_PYTHON_DOWNLOADS" = never
test "$npm_package_config_node_gyp_dist_url" = https://npmmirror.com/mirrors/node
node --version; pnpm --version; uv --version
test "$(psql -XAt -c 'SELECT current_user')" = byclaw
test "$(psql -XAt -c "SELECT rolsuper FROM pg_roles WHERE rolname=current_user")" = f
psql -Xv ON_ERROR_STOP=1 -c 'CREATE TABLE software_smoke (value integer); INSERT INTO software_smoke VALUES (42);'
psql -XAt -c "SELECT '[1,0]'::vector <-> '[0,1]'::vector" | grep '^1\.414'
createdb software_smoke_project
psql -XAt -d software_smoke_project -c "SELECT extversion FROM pg_extension WHERE extname='vector'" | grep .
python3 -m venv /tmp/software-venv
/tmp/software-venv/bin/python -c 'import sqlite3, ssl'
rm -rf /tmp/software-venv
if PGPASSWORD=incorrect psql -XAt -c 'SELECT 1' >/dev/null 2>&1; then
    echo 'Incorrect TCP password was accepted' >&2; exit 1
fi
SESSION
test "$(stat -c %a /run/byclaw-software-development/client/database.env)" = 600
test -z "$(find /var/lib/postgresql -name PG_VERSION ! -path '*/software-development/17/data/PG_VERSION' -print)"
CHECK
before=$("$engine" exec "$container" sha256sum /run/byclaw-software-development/client/database.env)
"$engine" restart -t 45 "$container" >/dev/null
wait_ready
after=$("$engine" exec "$container" sha256sum /run/byclaw-software-development/client/database.env)
test "$before" != "$after" || { echo 'Database credential did not rotate on restart' >&2; exit 1; }
"$engine" exec --user byclaw "$container" bash -ec \
    '. /run/byclaw-software-development/client/database.env; test "$(psql -XAt -c "SELECT value FROM software_smoke")" = 42'
echo "BYCLAW_SOFTWARE_DEVELOPMENT_SMOKE_OK rootfs_tar_bytes=$bytes max_bytes=$maximum"
