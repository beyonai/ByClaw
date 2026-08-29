#!/bin/sh
# Slim runtime bootstrap for the openclaw-only image.
#
# Source this before starting OpenClaw. It relocates OpenClaw state onto the
# mounted /by volume so agent state survives container restarts, while system
# and language package installs stay ephemeral.
#
# Compared to the full runtime-bootstrap.sh, this variant drops all browser /
# VNC / OpenCLI variables — the simple image does not ship those stacks.

set -eu

if [ "${OPENCLAW_STATE_DIR:-}" = "" ] || [ "${OPENCLAW_STATE_DIR:-}" = "/root/.openclaw" ]; then
  OPENCLAW_STATE_DIR=/by/.openclaw
fi

: "${OPENCLAW_HOME:=${OPENCLAW_STATE_DIR}/home}"
: "${OPENCLAW_CONFIG_FILE:=${OPENCLAW_STATE_DIR}/openclaw.json}"

export OPENCLAW_STATE_DIR
export OPENCLAW_CONFIG_FILE
export HOME="${OPENCLAW_HOME}"

mkdir -p "${HOME}"

GITHUB_GIT_CREDENTIAL_HELPER="/usr/local/lib/byclaw/runtime-tools/git-credential.mjs"
if command -v git >/dev/null 2>&1 && [ -x "${GITHUB_GIT_CREDENTIAL_HELPER}" ]; then
  git config --global credential.https://github.com.helper "${GITHUB_GIT_CREDENTIAL_HELPER}"
fi

if [ ! -f "${OPENCLAW_CONFIG_FILE}" ] && [ -f /usr/local/share/openclaw/openclaw.json ]; then
  cp /usr/local/share/openclaw/openclaw.json "${OPENCLAW_CONFIG_FILE}"
fi

export OPENCLAW_BOOTSTRAPPED=1
