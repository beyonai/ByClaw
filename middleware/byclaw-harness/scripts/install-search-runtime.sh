#!/bin/sh
# Install the pinned, no-key online-search fallback in an image or existing sandbox.
set -eu
settings=${1:?usage: install-search-runtime.sh SETTINGS CONSTRAINTS}
constraints=${2:?usage: install-search-runtime.sh SETTINGS CONSTRAINTS}
python3 -m venv /opt/searxng-cli-venv
if [ -n "${SEARXNG_WHEELHOUSE:-}" ]; then
    /opt/searxng-cli-venv/bin/python -m pip install --no-index \
        --find-links "$SEARXNG_WHEELHOUSE" --constraint "$constraints" 'searxng-cli==0.1.0'
else
    # extra-index-url is not a fallback: pip may select the overseas wheel even
    # when Tsinghua has it. Keep this build strictly on the Tsinghua mirror.
    python3 - "$constraints" <<'PY'
import math
import os
import subprocess
import sys
import time

limit = float(os.environ.get('SEARXNG_INSTALL_TIMEOUT_SECONDS', '180'))
if not math.isfinite(limit) or limit <= 0:
    raise SystemExit('SEARXNG_INSTALL_TIMEOUT_SECONDS must be positive and finite')
env = dict(os.environ, PIP_CONFIG_FILE=os.devnull, PIP_EXTRA_INDEX_URL='')
command = ['/opt/searxng-cli-venv/bin/python', '-m', 'pip', 'install',
           '--no-cache-dir', '--timeout', '20', '--retries', '2',
           '--index-url', 'https://pypi.tuna.tsinghua.edu.cn/simple',
           '--constraint', sys.argv[1], 'searxng-cli==0.1.0']
print(f'Search runtime: Tsinghua mirror only; total deadline {limit:g}s', flush=True)
started = time.monotonic()
process = subprocess.Popen(command, env=env)
try:
    while True:
        remaining = limit - (time.monotonic() - started)
        if remaining <= 0:
            print('Search runtime: total deadline exceeded; no official-index fallback', file=sys.stderr)
            raise SystemExit(124)
        try:
            raise SystemExit(process.wait(timeout=min(30, remaining)))
        except subprocess.TimeoutExpired:
            print(f'Search runtime: installation running ({time.monotonic() - started:.0f}s elapsed)', flush=True)
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
PY
fi
mkdir -p /opt/searxng-cli
cp "$settings" /opt/searxng-cli/searxng_pack_settings.yml
install -m 644 "$(dirname "$0")/searxng-cli/runtime.py" /opt/searxng-cli/runtime.py
install -m 755 "$(dirname "$0")/searxng-cli/launcher.sh" /usr/local/bin/byclaw-searxng-cli
ln -sf /usr/local/bin/byclaw-searxng-cli /usr/local/bin/searxng-cli
# Engine initialization belongs to the image's runtime-user verification.
# Running it as the installer would populate root-owned caches in the image.
