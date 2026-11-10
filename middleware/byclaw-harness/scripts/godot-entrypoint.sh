#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-tools}" != tools ]]; then
    echo 'Godot tool sandbox supports tools mode only.' >&2
    exit 2
fi
if [[ "${BYCLAW_GODOT_DESKTOP_ENABLED:-1}" == 1 ]]; then
    env -u BYCLAW_TOOL_ENV_HOST_KEY -u BYCLAW_TOOL_ENV_AUTHORIZED_KEY \
        su -s /bin/bash byclaw -c 'nohup /usr/local/bin/byclaw-godot-desktop >/dev/null 2>&1 &'
fi
exec /usr/local/bin/byclaw-dsh-entrypoint "$@"
