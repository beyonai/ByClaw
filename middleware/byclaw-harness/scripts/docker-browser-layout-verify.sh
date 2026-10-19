#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

assert_no_match() {
    local status=0
    "$@" || status=$?
    if [[ ${status} -eq 0 ]]; then
        printf '%s\n' 'forbidden browser runtime configuration found' >&2
        exit 1
    elif [[ ${status} -ne 1 ]]; then
        exit "${status}"
    fi
}

dockerfiles=(Dockerfile Dockerfile.extensions)
if [[ $# -eq 0 ]]; then
    cmp Dockerfile Dockerfile.extensions
elif [[ $# -eq 2 && "$1" == "--dockerfile" && ( "$2" == "Dockerfile" || "$2" == "Dockerfile.extensions" ) ]]; then
    dockerfiles=("$2")
else
    printf '%s\n' 'usage: docker-browser-layout-verify.sh [--dockerfile Dockerfile|Dockerfile.extensions]' >&2
    exit 2
fi
node scripts/docker-plugin-layout.mjs bundles plugins | grep -E '/plugins/dsh-browser-use/package.json$'

grep -F 'FROM python:3.12-slim-trixie AS dsh-base' Dockerfile.base >/dev/null
grep -F 'ARG APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn' Dockerfile.base >/dev/null
grep -F 'Acquire::Retries "5";' Dockerfile.base >/dev/null
grep -F 'Acquire::http::Timeout "30";' Dockerfile.base >/dev/null
grep -F 'Acquire::https::Timeout "30";' Dockerfile.base >/dev/null
grep -F '"${PLAYWRIGHT_BROWSERS_PATH}"' Dockerfile.base >/dev/null

for package in novnc xauth x11vnc xvfb websockify; do
    grep -Eq "^[[:space:]]+${package}( \\\\)?$" Dockerfile.base
done

for dockerfile in "${dockerfiles[@]}"; do
    grep -F 'BYCLAW_BROWSER_VIEWER=shared-novnc' "${dockerfile}" >/dev/null
    grep -F 'BYCLAW_BROWSER_USER_DATA_DIR=/home/byclaw/.dsh/browser/user-data' "${dockerfile}" >/dev/null
    grep -F 'BYCLAW_BROWSER_EXTENSIONS=/opt/nvm/current/lib/node_modules/@sovovs/bycli/extension' "${dockerfile}" >/dev/null
    grep -F 'BYCLAW_BYCLI_ENABLED=true' "${dockerfile}" >/dev/null
    grep -F 'BYCLI_BROWSER_IDLE_TIMEOUT=900' "${dockerfile}" >/dev/null
    grep -F '"@sovovs/bycli@${BYCLI_VERSION}"' "${dockerfile}" >/dev/null
    grep -F 'BYCLAW_BROWSER_DISPLAY_RANGE=100-199' "${dockerfile}" >/dev/null
    grep -F 'BYCLAW_BROWSER_RFB_PORT_RANGE=5901-6000' "${dockerfile}" >/dev/null
    grep -F 'BYCLAW_BROWSER_WEBSOCKIFY_PORT_RANGE=6101-6200' "${dockerfile}" >/dev/null
    grep -F 'USER root' "${dockerfile}" >/dev/null
    grep -F 'byclaw-browser-supervisor.py' "${dockerfile}" >/dev/null
    grep -F 'dsh-browser-use/lib/browserd.js' "${dockerfile}" >/dev/null
    grep -F 'browser-download-permissions-verify.py' "${dockerfile}" >/dev/null
    grep -F 'docker-entrypoint-fd-verify.py' "${dockerfile}" >/dev/null
    grep -F '@byclaw/dsh-browser-use/scripts/vnc-isolation-integration.mjs' "${dockerfile}" >/dev/null
    grep -F 'COPY --chown=byclaw:byclaw middleware/byclaw-harness/scripts/prune-dsh-profile.mjs /tmp/prune-dsh-profile.mjs' "${dockerfile}" >/dev/null
    grep -F 'node /tmp/prune-dsh-profile.mjs "${BYCLAW_DSH_MANAGED_HOME}/profiles/web/node_modules"' "${dockerfile}" >/dev/null
    assert_no_match grep -Eq '^[[:space:]]+apt-get install -y --no-install-recommends chromium;' "${dockerfile}"
    grep -F 'ln -s "${browser_path}" /usr/local/bin/byclaw-playwright-chromium;' "${dockerfile}" >/dev/null
    grep -F 'ln -s "${browser_path}" /usr/local/bin/chromium;' "${dockerfile}" >/dev/null
    grep -F '/usr/local/bin/chromium --version;' "${dockerfile}" >/dev/null
    assert_no_match grep -Eq 'useradd .*browserd|groupadd .*byclaw-browser' "${dockerfile}"
    assert_no_match grep -F 'byclaw-browser-desktop' "${dockerfile}"
    assert_no_match grep -F 'DISPLAY=:99' "${dockerfile}"
    if grep -Eq '(playwright|patchright)[[:space:]]+install|apt-get[^#]*google-chrome' "${dockerfile}"; then
        printf '%s unexpectedly downloads another managed browser\n' "${dockerfile}" >&2
        exit 1
    fi
done

grep -F 'PR_SET_CHILD_SUBREAPER' scripts/byclaw-browser-supervisor.py >/dev/null
grep -F -- '--readiness-timeout 60' docker-entrypoint.sh >/dev/null
grep -F 'DSH `browser` 工具的 `status`' builtin/skills/bycli/SKILL.md >/dev/null
grep -F '${DSH_HOME}/browser/user-data' builtin/skills/bycli/SKILL.md >/dev/null
assert_no_match rg -i 'openclaw|start-chrome|browser-profile openclaw' builtin/skills/bycli
grep -F 'BYCLAW_RUN_VNC_INTEGRATION' plugins/dsh-browser-use/scripts/vnc-isolation-integration.mjs >/dev/null
grep -F '"scripts/vnc-isolation-integration.mjs"' plugins/dsh-browser-use/package.json >/dev/null
grep -F "ignoreDefaultArgs: ['--disable-extensions', '--no-startup-window']" plugins/dsh-browser-use/src/browserd.ts >/dev/null
grep -F '每次执行 raw browser 命令或 COOKIE/INTERCEPT/UI Adapter 命令前' builtin/skills/bycli/SKILL.md >/dev/null
grep -F -- '--browser-user byclaw' docker-entrypoint.sh >/dev/null
grep -F -- '--dsh-user byclaw' docker-entrypoint.sh >/dev/null
node scripts/docker-plugin-dependencies-verify.mjs
node scripts/prune-dsh-profile.test.mjs

printf 'docker browser layout verification passed (%s)\n' "${dockerfiles[*]}"
