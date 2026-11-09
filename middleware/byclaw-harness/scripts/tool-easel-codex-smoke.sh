#!/usr/bin/env bash
# Real rootfs/SSH/runtime acceptance. Run only on a host allowed to pull the image.
set -Eeuo pipefail

image=${1:?usage: tool-easel-codex-smoke.sh IMAGE}
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
test "$bytes" -lt "$maximum" || {
    echo "Image rootfs tar exceeds 4 GiB: $bytes" >&2
    exit 1
}

container=$("$engine" run -d --network none --shm-size=1g \
    -e BYCLAW_TOOL_ENV_SEED_GENERATE=1 \
    -e BYCLAW_TOOL_ENV_WS_PORT=8022 \
    "$image")

wait_ready() {
    for _ in $(seq 1 120); do
        if "$engine" exec "$container" test -f /by/Easel/pyproject.toml \
            && "$engine" exec "$container" curl -fsS http://127.0.0.1:8022/ >/dev/null 2>&1; then
            return
        fi
        sleep 1
    done
    echo 'Easel Codex sandbox did not become ready' >&2
    return 1
}
wait_ready

"$engine" exec -i "$container" bash -se <<'CHECK'
test ! -e /etc/ssh/ssh_host_ed25519_key
ssh-keygen -y -f /etc/byclaw-tool-env/host_ed25519 \
    | awk '{print "127.0.0.1 " $0}' >/tmp/easel-known-hosts
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile=/tmp/easel-known-hosts \
    -i /etc/byclaw-tool-env/client_ed25519 byclaw@127.0.0.1 'bash -se' <<'SESSION'
test "$(id -un)" = byclaw
test "$EASEL_AGENT_RUNTIME" = codex
test "$CODEX_HOME" = /by/.codex
test -f /by/Easel/pyproject.toml
test -d /by/Easel/skills/builtin
test -f /by/Easel/web/frontend/dist/index.html
test -f /by/Easel/outputs/_harness/config.json
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
mkdir -p outputs/_acceptance
printf 'easel-codex-write-read\n' >outputs/_acceptance/smoke.txt
grep -qx 'easel-codex-write-read' outputs/_acceptance/smoke.txt
python -m pytest -q tests/test_core.py tests/test_agent_harnesses.py \
    tests/test_codex_permissions.py tests/test_installation.py \
    tests/test_harness_workspace.py
easel doctor
SESSION
CHECK

test "$("$engine" exec "$container" stat -c %a /by/.codex)" = 700
"$engine" exec "$container" test -f /by/Easel/outputs/_acceptance/smoke.txt
"$engine" restart -t 45 "$container" >/dev/null
wait_ready
"$engine" exec --user byclaw "$container" grep -qx \
    easel-codex-write-read /by/Easel/outputs/_acceptance/smoke.txt
echo "BYCLAW_EASEL_CODEX_SMOKE_OK rootfs_tar_bytes=$bytes max_bytes=$maximum"
