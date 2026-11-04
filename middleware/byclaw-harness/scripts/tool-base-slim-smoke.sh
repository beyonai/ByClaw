#!/usr/bin/env bash
# Run on a Docker build host. Creates and removes only its own test container.
set -euo pipefail
image=${1:?usage: tool-base-slim-smoke.sh IMAGE}
max_bytes=${BYCLAW_TOOL_BASE_MAX_BYTES:-1000000000}
engine_bytes=$(docker image inspect --format '{{.Size}}' "$image")
probe=$(docker create "$image")
trap 'docker rm -f "$probe" >/dev/null' EXIT
# With the containerd store, inspect.Size can describe compressed content.
# Export measures the entire flattened filesystem, including inherited layers.
bytes=$(docker export "$probe" | wc -c | tr -d ' ')
docker rm "$probe" >/dev/null
trap - EXIT
test "$bytes" -lt "$max_bytes" || { echo "Rootfs tar exceeds ${max_bytes} bytes: ${bytes}" >&2; exit 1; }
container=$(docker run -d --network none \
    -e BYCLAW_TOOL_ENV_SEED_GENERATE=1 -e BYCLAW_TOOL_ENV_WS_PORT=8022 \
    -e BYCLAW_SLIM_SMOKE_VALUE=forwarded "$image")
trap 'docker rm -f "$container" >/dev/null' EXIT
for attempt in $(seq 1 30); do
    if docker exec "$container" curl -fsS http://127.0.0.1:8022/ >/dev/null 2>&1; then break; fi
    sleep 1
done
docker exec -i "$container" bash -s <<'CHECK'
set -euo pipefail
test "$(uname -m)" = x86_64
test -x /bin/bash
for file in /etc/passwd /etc/group; do test -f "$file"; test ! -L "$file"; test -w "$file"; done
for package in systemd systemd-sysv sudo openssh-server; do dpkg-query -W -f='${Status}' "$package" | grep -qx 'install ok installed'; done
test -x /sbin/init
for binary in chromium byclaw-playwright-chromium ffmpeg java libreoffice godot; do
    if command -v "$binary"; then echo "Unexpected business binary: $binary" >&2; exit 1; fi
done
test ! -d /ms-playwright
test ! -d /opt/byclaw/dsh-managed/profiles/web/node_modules/@byclaw
cmp /workspace/packages/ssh/ssh/lib/helper.js /opt/byclaw/dsh-managed/profiles/web/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js
python3 -c 'import websockets; print("Python/WebSocket OK")'
python3 -m venv /tmp/base-venv
/tmp/base-venv/bin/python -m pip --version
node -e 'console.log("Node OK")'
npm --version
bash -lc 'node --version; npm --version; npx --version'
sha256sum -c /etc/byclaw-tool-sandbox/helper.sha256
test -x "$(cat /etc/byclaw-tool-sandbox/node-exec-path)"
# Pin the host key; password and root login must remain disabled.
ssh-keygen -y -f /etc/byclaw-tool-env/host_ed25519 | awk '{print "127.0.0.1 " $0}' >/tmp/known_hosts
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/tmp/known_hosts \
    -i /etc/byclaw-tool-env/client_ed25519 byclaw@127.0.0.1 'bash -se' <<'SESSION'
test "$(id -un)" = byclaw
test "$BYCLAW_SLIM_SMOKE_VALUE" = forwarded
test "$NPM_CONFIG_REGISTRY" = https://registry.npmmirror.com
test -w /by
printf 'roundtrip' >/by/base-smoke.txt
test "$(cat /by/base-smoke.txt)" = roundtrip
python3 -c 'print("SSH Python OK")'
node --input-type=module -e 'await import("/workspace/packages/ptc-runtime/ptc-runtime-node/lib/index.js"); console.log("SSH PTC library import OK")'
node --check /workspace/packages/ssh/ssh/lib/helper.js
node --check /workspace/packages/ptc-runtime/ptc-runtime-node/lib/process.js
node --check /workspace/packages/ptc-runtime/ptc-runtime-node/lib/persistent-process.js
SESSION
/usr/sbin/sshd -T -f /run/byclaw-tool-env/sshd_config | grep -E '^(passwordauthentication no|permitrootlogin no)$' | sort | diff - <(printf 'passwordauthentication no\npermitrootlogin no\n')
python3 - <<'WS'
import asyncio
import websockets
async def main():
    async with websockets.connect('ws://127.0.0.1:8022/') as connection:
        banner = await asyncio.wait_for(connection.recv(), timeout=5)
        assert banner.startswith(b'SSH-2.0-'), repr(banner)
        print('WebSocket SSH banner OK')
asyncio.run(main())
WS
CHECK
echo "BYCLAW_TOOL_BASE_SLIM_SMOKE_OK rootfs_tar_bytes=${bytes} engine_image_bytes=${engine_bytes}"
