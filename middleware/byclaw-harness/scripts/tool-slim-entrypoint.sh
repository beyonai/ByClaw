#!/usr/bin/env bash
set -Eeuo pipefail
# Tool sandboxes built on the browser layer (browser, media, coding, godot, unity, general).
# SSH and the bridge run under byclaw-tool-base-entrypoint, which also runs byCLI's
# browser supervisor as a declared service (/etc/byclaw-tool-sandbox/services.d/browser.json).
# The browser is never the parent of SSH: a browser that fails or is killed for memory
# ends only itself, and the entrypoint restarts it into its on-demand wait.
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
exec /usr/local/bin/byclaw-tool-base-entrypoint tools
