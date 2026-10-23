#!/usr/bin/env bash
set -Eeuo pipefail
case "${BYCLAW_DSH_TOOL_ENV:-}" in
    static|opensandbox|byclaw-be) ;;
    *) echo 'Lean Harness requires BYCLAW_DSH_TOOL_ENV=static, opensandbox or byclaw-be and a paired Dockerfile.tool_slim image.' >&2; exit 2 ;;
esac
if [[ "${1:-}" == tools ]]; then
    echo 'Run tools mode with Dockerfile.tool_slim, not the lean Harness image.' >&2
    exit 2
fi
export BYCLAW_BROWSER_ON_TOOL_ENV=1
original=${BYCLAW_LEAN_ORIGINAL_ENTRYPOINT:-/usr/local/bin/byclaw-dsh-entrypoint}
if ((EUID == 0)); then
    install -d -m 0700 -o byclaw -g byclaw "${DSH_HOME:-/home/byclaw/.dsh}"
    exec setpriv --reuid=byclaw --regid=byclaw --init-groups env HOME=/home/byclaw "$0" "$@"
fi
# Multi-host owns per-user profile initialization itself. Its browser row retains
# workspaceOnToolEnvironment from the bundle; it does not spawn a local supervisor.
if [[ "${1:-}" == multi-host ]]; then exec "$original" "$@"; fi
# Reuse profile/credential-lock preparation and the established CLI launcher.
# The lean wrapper replaces only the local browser supervisor step.
BYCLAW_DSH_PREPARE_ONLY=1 BYCLAW_DSH_PREPARED=0 "$original" "$@"
unset BYCLAW_DSH_PREPARE_ONLY
export BYCLAW_DSH_PREPARED=1
exec "$original" "$@"
