#!/usr/bin/env bash
set -euo pipefail

# Keep dependency resolution on domestic mirrors, including later SSH sessions.
for source in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
  [ -f "$source" ] || continue
  sed -i \
    -e 's|http://deb.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
    -e 's|https://deb.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
    -e 's|http://security.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
    -e 's|http://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' \
    -e 's|https://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' "$source"
done
printf '%s\n' '[global]' 'index-url = https://pypi.tuna.tsinghua.edu.cn/simple' > /etc/pip.conf
npm config set registry https://registry.npmmirror.com --location=global
# Keep the default Central lookup domestic; explicit private repositories remain explicit.
if [ -d /etc/maven ]; then
  cat > /etc/maven/settings.xml <<'MAVEN'
<?xml version="1.0" encoding="UTF-8"?>
<settings xmlns="http://maven.apache.org/SETTINGS/1.2.0">
  <mirrors>
    <mirror>
      <id>byclaw-domestic-central</id>
      <name>Aliyun Maven Central mirror</name>
      <url>https://maven.aliyun.com/repository/public</url>
      <mirrorOf>central</mirrorOf>
    </mirror>
  </mirrors>
</settings>
MAVEN
fi
session=/etc/byclaw-tool-env.session-env
if [ -f "$session" ]; then
  sed -i '/^\(NPM_CONFIG_REGISTRY\|npm_config_registry\|PIP_INDEX_URL\|PIP_EXTRA_INDEX_URL\|PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD\|PUPPETEER_SKIP_DOWNLOAD\|HYPERFRAMES_BROWSER_PATH\|UV_DEFAULT_INDEX\|UV_INDEX_URL\|UV_EXTRA_INDEX_URL\|UV_PYTHON_DOWNLOADS\|COREPACK_NPM_REGISTRY\|NVM_NODEJS_ORG_MIRROR\|HYPERFRAMES_FFMPEG_PATH\|HYPERFRAMES_FFPROBE_PATH\)=/d' "$session"
  printf '%s\n' \
    'NPM_CONFIG_REGISTRY=https://registry.npmmirror.com' \
    'npm_config_registry=https://registry.npmmirror.com' \
    'PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple' \
    'PIP_EXTRA_INDEX_URL=' \
    'UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple' \
    'UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple' \
    'UV_EXTRA_INDEX_URL=' \
    'UV_PYTHON_DOWNLOADS=never' \
    'COREPACK_NPM_REGISTRY=https://registry.npmmirror.com' \
    'NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node/' \
    'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' \
    'PUPPETEER_SKIP_DOWNLOAD=1' \
    'HYPERFRAMES_BROWSER_PATH=/usr/local/bin/byclaw-playwright-chromium' \
    'HYPERFRAMES_FFMPEG_PATH=/usr/bin/ffmpeg' \
    'HYPERFRAMES_FFPROBE_PATH=/usr/bin/ffprobe' >> "$session"
fi
