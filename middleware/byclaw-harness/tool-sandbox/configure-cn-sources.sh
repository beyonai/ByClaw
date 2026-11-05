#!/usr/bin/env bash
set -euo pipefail

# Keep dependency resolution on domestic mirrors, including later SSH sessions.
for source in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
  [ -f "$source" ] || continue
  sed -i \
    -e 's|http://deb.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
    -e 's|https://deb.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
    -e 's|http://security.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
    -e 's|https://security.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
    -e 's|http://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' \
    -e 's|https://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' "$source"
done
printf '%s\n' '[global]' 'index-url = https://pypi.tuna.tsinghua.edu.cn/simple' > /etc/pip.conf
npm config set registry https://registry.npmmirror.com --location=global
# uv has an independent resolver and configuration hierarchy from pip.
install -d /etc/uv /etc/byclaw-tool-sandbox /etc/profile.d
cat >/etc/uv/uv.toml <<'UV'
python-downloads = "never"
[[index]]
name = "byclaw-domestic"
url = "https://pypi.tuna.tsinghua.edu.cn/simple"
default = true
UV
# Maven3.9+ reads MAVEN_ARGS; Debian/older Maven reads its installation settings.
# A later Maven3.8 install must re-run this configurator (MAVEN_ARGS is ignored).
cat >/etc/byclaw-tool-sandbox/maven-settings.xml <<'MAVEN'
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
if [ -d /etc/maven ]; then
  cp /etc/byclaw-tool-sandbox/maven-settings.xml /etc/maven/settings.xml
fi
# Genuine downloader settings, shared by login shells and SSH session snapshots.
# Playwright custom host replaces its full CDN list (not an additional fallback).
# Puppeteer-core ignores Puppeteer env configuration and never downloads itself.
cat >/etc/byclaw-tool-sandbox/domestic-sources.env <<'ENV'
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
npm_config_registry=https://registry.npmmirror.com
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
PIP_EXTRA_INDEX_URL=
UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
UV_EXTRA_INDEX_URL=
UV_PYTHON_DOWNLOADS=never
COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node/
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
PLAYWRIGHT_FIREFOX_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
PUPPETEER_SKIP_DOWNLOAD=1
PUPPETEER_CHROME_DOWNLOAD_BASE_URL=https://npmmirror.com/mirrors/chrome-for-testing
PUPPETEER_CHROME_HEADLESS_SHELL_DOWNLOAD_BASE_URL=https://npmmirror.com/mirrors/chrome-for-testing
PUPPETEER_FIREFOX_SKIP_DOWNLOAD=1
MAVEN_ARGS='--settings /etc/byclaw-tool-sandbox/maven-settings.xml'
ENV
# Shell assignments stay quoted; session files store raw NAME=VALUE records.
{ printf '%s\n' '# Managed tool-sandbox domestic download defaults.'; sed 's/^/export /' /etc/byclaw-tool-sandbox/domestic-sources.env; } >/etc/profile.d/byclaw-domestic-sources.sh
session=/etc/byclaw-tool-env.session-env
if [ -f "$session" ]; then
  while IFS= read -r assignment; do
    name="${assignment%%=*}"
    sed -i "/^${name}=/d" "$session"
    # MAVEN_ARGS is shell-quoted above, but SSH SetEnv needs its literal value.
    value="${assignment#*=}"
    value="${value#\'}"
    value="${value%\'}"
    printf '%s=%s\n' "$name" "$value" >>"$session"
  done </etc/byclaw-tool-sandbox/domestic-sources.env
  # Runtime media executables are preinstalled, never downloader fallbacks.
  for assignment in \
    HYPERFRAMES_BROWSER_PATH=/usr/local/bin/byclaw-playwright-chromium \
    HYPERFRAMES_FFMPEG_PATH=/usr/bin/ffmpeg \
    HYPERFRAMES_FFPROBE_PATH=/usr/bin/ffprobe; do
    sed -i "/^${assignment%%=*}=/d" "$session"
    printf '%s\n' "$assignment" >>"$session"
  done
fi
