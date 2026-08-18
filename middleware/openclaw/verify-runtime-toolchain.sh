#!/bin/sh
set -eu

ffmpeg -version >/dev/null
chromium --version
test "$(hyperframes --version)" = "0.8.1"
remotion --version 2>&1 | grep -F '@remotion/cli 4.0.512' >/dev/null
patchright --version 2>&1 | grep -F '1.62.1' >/dev/null
node -e 'const p=require("/usr/local/lib/node_modules/@byclaw/by-framework/package.json"); if(p.version!=="1.5.2") process.exit(1)'
python3 -c 'from importlib.metadata import version; assert version("by-framework") == "0.2.2.dev10"; assert version("patchright") == "1.62.1"'
python3 - <<'PY'
from patchright.sync_api import sync_playwright
with sync_playwright() as runtime:
    browser = runtime.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_content("<title>byclaw-toolchain-ok</title>")
    assert page.title() == "byclaw-toolchain-ok"
    browser.close()
PY
