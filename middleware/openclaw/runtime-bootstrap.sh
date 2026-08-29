#!/bin/sh
# Source this file before starting OpenClaw. It keeps OpenClaw state under the
# mounted /by volume while leaving system and language package installs
# ephemeral, so agents can reinstall missing tools on demand after a restart.

set -eu

if [ "${OPENCLAW_STATE_DIR:-}" = "" ] || [ "${OPENCLAW_STATE_DIR:-}" = "/root/.openclaw" ]; then
  OPENCLAW_STATE_DIR=/by/.openclaw
fi

: "${OPENCLAW_HOME:=${OPENCLAW_STATE_DIR}/home}"
: "${OPENCLAW_CONFIG_FILE:=${OPENCLAW_STATE_DIR}/openclaw.json}"
: "${OPENCLAW_BROWSER_PROFILE:=openclaw}"
: "${OPENCLAW_BROWSER_USER_DATA_DIR:=${OPENCLAW_STATE_DIR}/browser/${OPENCLAW_BROWSER_PROFILE}/user-data}"
: "${OPENCLI_PROFILE:=${OPENCLAW_BROWSER_PROFILE}}"
: "${OPENCLI_CONFIG_DIR:=${OPENCLAW_HOME}/.opencli}"
: "${OPENCLI_CACHE_DIR:=${OPENCLI_CONFIG_DIR}/cache}"
: "${OPENCLI_EXTENSION_DIR:=/opt/opencli/extension}"
: "${DISPLAY:=:99}"

export OPENCLAW_STATE_DIR
export OPENCLAW_CONFIG_FILE
export HOME="${OPENCLAW_HOME}"
export OPENCLAW_BROWSER_PROFILE
export OPENCLAW_BROWSER_USER_DATA_DIR
export OPENCLI_PROFILE
export OPENCLI_CONFIG_DIR
export OPENCLI_CACHE_DIR
export OPENCLI_EXTENSION_DIR
export DISPLAY

mkdir -p \
  "${HOME}" \
  "${OPENCLAW_BROWSER_USER_DATA_DIR}" \
  "${OPENCLI_CONFIG_DIR}" \
  "${OPENCLI_CACHE_DIR}"

GITHUB_GIT_CREDENTIAL_HELPER="/usr/local/lib/byclaw/runtime-tools/git-credential.mjs"
if command -v git >/dev/null 2>&1 && [ -x "${GITHUB_GIT_CREDENTIAL_HELPER}" ]; then
  git config --global credential.https://github.com.helper "${GITHUB_GIT_CREDENTIAL_HELPER}"
fi

if [ ! -f "${OPENCLAW_CONFIG_FILE}" ] && [ -f /usr/local/share/openclaw/openclaw.json ]; then
  cp /usr/local/share/openclaw/openclaw.json "${OPENCLAW_CONFIG_FILE}"
fi

export OPENCLAW_BOOTSTRAPPED=1
