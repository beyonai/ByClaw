#!/usr/bin/env bash
# Transitional media environment. Runs only at image build, never at sandbox startup.
set -Eeuo pipefail
. /etc/os-release
test "$ID" = debian && test "$VERSION_ID" = 13
template_dir="$(cd "$(dirname "$0")" && pwd)"
source_dir="$template_dir/source"
venv=/opt/easel-venv
export DEBIAN_FRONTEND=noninteractive
export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple PIP_EXTRA_INDEX_URL=
export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
export PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST="$PLAYWRIGHT_DOWNLOAD_HOST"
export PLAYWRIGHT_BROWSERS_PATH=/opt/easel-runtime/playwright
export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
export npm_config_registry="$NPM_CONFIG_REGISTRY" npm_config_replace_registry_host=always
export COREPACK_NPM_REGISTRY="$NPM_CONFIG_REGISTRY"
export npm_config_disturl=https://npmmirror.com/mirrors/node
export npm_package_config_node_gyp_dist_url="$npm_config_disturl"
export NEXT_TELEMETRY_DISABLED=1
apt-get -o APT::Update::Error-Mode=any update
apt-get install -y --no-install-recommends \
    build-essential pkg-config python3-dev python3-pip python3-venv \
    ffmpeg fd-find ghostscript imagemagick jq libgl1 libgomp1 libsm6 \
    libxext6 libxrender1 pandoc poppler-utils ripgrep sqlite3
ln -sf /usr/bin/fdfind /usr/local/bin/fd
cd "$template_dir"
sha256sum -c easel-source-5c12e42.tar.gz.sha256
install -d "$source_dir"
tar -xzf easel-source-5c12e42.tar.gz -C "$source_dir"
python3 -m venv "$venv"
"$venv/bin/python" -m pip install --upgrade pip setuptools wheel
"$venv/bin/python" -m pip install --prefer-binary -e "$source_dir"
"$venv/bin/python" -m pip install \
    pdfplumber==0.11.10 PyYAML==6.0.3 'qrcode[pil]==8.2' CairoSVG==2.9.1 \
    openpyxl==3.1.5 pytest==9.2.0 ruff==0.17.4 uv==0.13.7
"$venv/bin/python" -m pip check
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 "$venv/bin/python" -m playwright install chromium
# Use a template-owned browser directory; never remove or retarget the core browser.
chromium_path=$("$venv/bin/python" -c 'from playwright.sync_api import sync_playwright; p=sync_playwright().start(); print(p.chromium.executable_path); p.stop()')
test -x "$chromium_path"
"$venv/bin/python" - <<'PY'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    page.set_content('<title>template</title>')
    assert page.title() == 'template'
    browser.close()
PY
# Publishing tools belong to this template; Codex itself comes only from coding-core.
npm install -g --registry="$NPM_CONFIG_REGISTRY" --ignore-scripts @lucasygu/redbook@0.8.1
npm install -g --registry="$NPM_CONFIG_REGISTRY" @wechatsync/cli@1.1.0
cd "$source_dir/web/frontend"
npm ci --ignore-scripts --registry="$NPM_CONFIG_REGISTRY" --replace-registry-host=always --no-audit --no-fund
npm run build
rm -rf node_modules
cd "$source_dir/skills/builtin/video-production/vendor/video-pipeline-sdk/deps/remotion"
npm ci --ignore-scripts --registry="$NPM_CONFIG_REGISTRY" --replace-registry-host=always --no-audit --no-fund
printf '%s\n' \
    "import {Config} from '@remotion/cli/config';" \
    "Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE || '/usr/local/bin/byclaw-playwright-chromium');" \
    'Config.setCachingEnabled(false);' > remotion.config.ts
install -d /opt/easel-runtime/remotion
cp package.json package-lock.json /opt/easel-runtime/remotion/
mv node_modules /opt/easel-runtime/remotion/node_modules
rm -rf /opt/easel-runtime/remotion/node_modules/.cache
ln -s /var/cache/easel/remotion /opt/easel-runtime/remotion/node_modules/.cache
ln -s /opt/easel-runtime/remotion/node_modules node_modules
chmod -R a-w /opt/easel-runtime/remotion
install -d -o byclaw -g byclaw -m 0700 /var/cache/easel /var/cache/easel/remotion
python3 -m py_compile "$template_dir/workspace.py"
"$venv/bin/python" -c 'import easel, fastapi, cv2, fitz, librosa, matplotlib, numpy, onnxruntime, pandas, pdfplumber, PIL, playwright, rembg, segno, yaml'
test -f /opt/easel-runtime/remotion/node_modules/remotion/package.json
rm -f "$template_dir/easel-source-5c12e42.tar.gz" "$template_dir/easel-source-5c12e42.tar.gz.sha256"
rm -rf /var/lib/apt/lists/* /root/.cache /root/.npm
