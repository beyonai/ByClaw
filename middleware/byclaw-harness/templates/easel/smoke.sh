#!/usr/bin/env bash
# Real rootfs/SSH/runtime acceptance. Run only on a host allowed to pull the image.
set -Eeuo pipefail

image=${1:?usage: templates/easel/smoke.sh CODING_IMAGE}
engine=${CONTAINER_ENGINE:-docker}
maximum=${EASEL_ROOTFS_MAX_BYTES:-0}
[[ "$maximum" =~ ^[0-9]+$ ]] || { echo "Invalid EASEL_ROOTFS_MAX_BYTES" >&2; exit 2; }
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
echo "EASEL_ROOTFS_TAR_BYTES=$bytes budget_bytes=$maximum"
if (( maximum > 0 && bytes >= maximum )); then
    echo "Image rootfs tar exceeds configured budget: $bytes >= $maximum" >&2
    exit 1
fi

container=$("$engine" run -d --network none --shm-size=1g \
    -e BYCLAW_TOOL_ENV_SEED_GENERATE=1 \
    -e BYCLAW_TOOL_ENV_WS_PORT=8022 \
    "$image")

wait_ready() {
    for _ in $(seq 1 120); do
        if "$engine" exec "$container" curl -fsS http://127.0.0.1:8082/_health >/dev/null 2>&1 \
            && "$engine" exec "$container" curl -fsS http://127.0.0.1:8022/ >/dev/null 2>&1; then
            return
        fi
        sleep 1
    done
    echo 'Easel Codex sandbox did not become ready' >&2
    return 1
}
wait_ready
"$engine" exec "$container" test ! -e /by/Easel
"$engine" exec --user byclaw "$container" sandbox-template init easel

"$engine" exec -i "$container" bash -se <<'CHECK'
test ! -e /etc/ssh/ssh_host_ed25519_key
ssh-keygen -y -f /etc/byclaw-tool-env/host_ed25519 \
    | awk '{print "127.0.0.1 " $0}' >/tmp/coding-template-known-hosts
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile=/tmp/coding-template-known-hosts \
    -i /etc/byclaw-tool-env/client_ed25519 byclaw@127.0.0.1 'bash -se' <<'SESSION'
test "$(id -un)" = byclaw
test "$CODEX_HOME" = /home/byclaw/.codex
test -f "$CODEX_HOME/config.toml"
test "$(stat -c %a "$CODEX_HOME/config.toml")" = 600
export PATH=/opt/easel-venv/bin:$PATH
export PYTHONPATH=/by/Easel
export PLAYWRIGHT_BROWSERS_PATH=/opt/easel-runtime/playwright
export EASEL_AGENT_RUNTIME=codex XDG_CACHE_HOME=/var/cache/easel
test -f /by/Easel/pyproject.toml
test -d /by/Easel/skills/builtin
test -f /by/Easel/web/frontend/dist/index.html
test -f /by/Easel/outputs/_harness/config.json
test -f /by/Easel/.byclaw-easel-workspace.json
test -L /by/Easel/.venv
remotion=/by/Easel/skills/builtin/video-production/vendor/video-pipeline-sdk/deps/remotion
test -L "$remotion/node_modules"
test "$(readlink "$remotion/node_modules")" = /opt/easel-runtime/remotion/node_modules
test ! -w /opt/easel-runtime/remotion/node_modules/remotion/package.json
test -w /var/cache/easel
test "$XDG_CACHE_HOME" = /var/cache/easel
# find does not follow the dependency links. Guard the personal file-count budget.
test "$(find /by/Easel -xdev -print | wc -l)" -lt 3000
cd /by/Easel
test "$(python -c 'import json;print(json.load(open("outputs/_harness/config.json"))["runtime"])')" = codex
if command -v openclaw >/dev/null 2>&1; then
    echo 'OpenClaw must not be installed in the Codex-only sandbox' >&2
    exit 1
fi
command -v easel
command -v codex
codex --version
node --version
python --version
ffmpeg -version | head -1
python - <<'PY'
from pathlib import Path
import cv2, faster_whisper, fitz, librosa, matplotlib, numpy, onnxruntime
import pandas, pdfplumber, PIL, rembg, segno, yaml
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    page = browser.new_page()
    page.set_content("<title>easel-byclaw</title>")
    assert page.title() == "easel-byclaw"
    browser.close()
print("EASEL_RUNTIME_IMPORTS_OK")
PY
python -m pip check
# Exercise Node resolution through the image link and render a real frame offline.
render_probe=$(mktemp -d /var/cache/easel/render-check.XXXXXX)
ln -s /opt/easel-runtime/remotion/node_modules "$render_probe/node_modules"
printf '%s\n' '{"private":true}' >"$render_probe/package.json"
printf '%s\n' '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"node","jsx":"react-jsx","esModuleInterop":true,"skipLibCheck":true}}' \
    >"$render_probe/tsconfig.json"
cat >"$render_probe/index.tsx" <<'TSX'
import React from 'react';
import {Composition, registerRoot} from 'remotion';
const Frame = () => React.createElement('div', {style: {background: 'white'}}, 'Easel');
registerRoot(() => React.createElement(Composition, {
  id: 'Probe', component: Frame, durationInFrames: 1, fps: 30, width: 320, height: 240,
}));
TSX
cat >"$render_probe/remotion.config.ts" <<'TS'
import {Config} from '@remotion/cli/config';
Config.setCachingEnabled(false);
Config.setBrowserExecutable('/usr/local/bin/byclaw-playwright-chromium');
TS
(cd "$render_probe" && ./node_modules/.bin/remotion still index.tsx Probe frame.png --log=error)
test -s "$render_probe/frame.png"
rm -rf "$render_probe"
mkdir -p outputs/_acceptance
printf 'template-workspace-write-read\n' >outputs/_acceptance/smoke.txt
grep -qx 'template-workspace-write-read' outputs/_acceptance/smoke.txt
python -m pytest -q tests/test_core.py tests/test_agent_harnesses.py \
    tests/test_codex_permissions.py tests/test_installation.py \
    tests/test_harness_workspace.py
easel doctor
SESSION
CHECK

test "$("$engine" exec "$container" stat -c %a /home/byclaw/.codex)" = 700
"$engine" exec "$container" test -f /by/Easel/outputs/_acceptance/smoke.txt
"$engine" restart -t 45 "$container" >/dev/null
wait_ready
"$engine" exec --user byclaw "$container" grep -qx \
    template-workspace-write-read /by/Easel/outputs/_acceptance/smoke.txt
"$engine" exec --user byclaw "$container" test -L \
    /by/Easel/skills/builtin/video-production/vendor/video-pipeline-sdk/deps/remotion/node_modules
echo "BYCLAW_EASEL_CODEX_SMOKE_OK rootfs_tar_bytes=$bytes max_bytes=$maximum"
