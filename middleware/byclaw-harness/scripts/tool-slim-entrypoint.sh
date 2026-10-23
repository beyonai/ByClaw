#!/usr/bin/env bash
set -Eeuo pipefail
# The supervisor passes its broker secret to its main child through a private FD.
# SSH sessions do not use that broker: close the FD before starting sshd and never
# copy its numeric value into sshd's SetEnv. Native browser RPC has a separate secret.
if [[ "${1:-}" == --sshd ]]; then
    exec python3 -c '
import os
fd = os.environ.pop("BYCLAW_BROWSER_SECRET_FD", None)
if fd is not None:
    os.close(int(fd))
os.environ.pop("BYCLAW_BROWSER_SECRET", None)
os.environ.pop("BYCLAW_DSH_PREPARED", None)
command = os.environ.get("BYCLAW_TOOL_SLIM_SSHD", "/usr/local/bin/byclaw-tool-env-sshd")
os.execv(command, [command])
'
fi
if [[ "${1:-tools}" != tools ]]; then
    echo 'Tool sandbox supports tools mode only.' >&2
    exit 2
fi
if ((EUID != 0)); then
    echo 'Tool sandbox requires root to prepare SSH and drop browser privileges.' >&2
    exit 2
fi
if [[ "${BYCLAW_TOOL_ENV_USER:-byclaw}" != byclaw ]]; then
    echo 'Tool sandbox requires BYCLAW_TOOL_ENV_USER=byclaw.' >&2
    exit 2
fi
install -d -m 0700 -o byclaw -g byclaw /by/.browser /by/.bycli \
    /run/byclaw-browser /run/byclaw-browser/downloads \
    /run/byclaw-browser/screenshots /run/byclaw-browser/sessions
if [[ "${BYCLAW_BYCLI_ENABLED:-true}" != true && "${BYCLAW_BYCLI_ENABLED:-true}" != 1 ]]; then
    exec /usr/local/bin/byclaw-tool-env-sshd
fi
# SSH is the main child; byCLI's separate browser/daemon starts on first CLI use.
# The existing supervisor handles signals, readiness, health and descendant cleanup.
exec /usr/local/bin/byclaw-browser-supervisor \
    --browser-user byclaw --dsh-user root \
    --socket-path /run/byclaw-browser/browserd.sock --readiness-timeout 60 \
    -- "$0" --sshd
