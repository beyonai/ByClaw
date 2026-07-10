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
: "${OPENCLAW_FIX_ACPX_NPM_PERMISSIONS:=true}"
: "${OPENCLAW_ACPX_NPM_PROJECT_PREFIX:=openclaw-acpx-}"
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

sanitize_acpx_npm_plugin_candidates() {
  case "${OPENCLAW_FIX_ACPX_NPM_PERMISSIONS}" in
    true|1|yes|on) ;;
    *) return 0 ;;
  esac

  npm_projects_dir="${OPENCLAW_STATE_DIR}/npm/projects"
  [ -d "${npm_projects_dir}" ] || return 0

  fixed=0
  for project_dir in "${npm_projects_dir}/${OPENCLAW_ACPX_NPM_PROJECT_PREFIX}"*; do
    [ -e "${project_dir}" ] || continue
    if find "${project_dir}" -perm -0002 -print -quit 2>/dev/null | grep -q .; then
      if find "${project_dir}" -perm -0002 -exec chmod go-w {} + 2>/dev/null; then
        fixed=1
      else
        printf '[runtime-bootstrap] warning: failed to sanitize acpx plugin permissions under %s\n' "${project_dir}" >&2
      fi
    fi
  done

  if [ "${fixed}" = "1" ]; then
    printf '[runtime-bootstrap] sanitized acpx npm plugin candidate permissions under %s\n' "${npm_projects_dir}"
  fi
}

sanitize_acpx_npm_plugin_candidates

if [ ! -f "${OPENCLAW_CONFIG_FILE}" ] && [ -f /usr/local/share/openclaw/openclaw.json ]; then
  cp /usr/local/share/openclaw/openclaw.json "${OPENCLAW_CONFIG_FILE}"
fi

export OPENCLAW_BOOTSTRAPPED=1
