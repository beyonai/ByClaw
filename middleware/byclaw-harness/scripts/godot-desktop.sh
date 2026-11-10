#!/usr/bin/env bash
set -euo pipefail
# Separate from browser sessions (displays 100..199; RFB 5901..6000).
export DISPLAY=:3
log_dir="${HOME:?HOME is required}/.cache/byclaw-godot"
mkdir -p "$log_dir"
pids=()
cleanup() {
    if ((${#pids[@]})); then kill "${pids[@]}" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
Xvfb :3 -screen 0 1280x800x24 -nolisten tcp >"$log_dir/xvfb.log" 2>&1 &
pids+=("$!")
ready=0
for _ in $(seq 1 50); do
    if xdpyinfo >/dev/null 2>&1; then ready=1; break; fi
    sleep 0.1
done
[[ "$ready" == 1 ]] || { echo 'Godot X display did not become ready' >&2; exit 1; }
openbox >"$log_dir/openbox.log" 2>&1 &
pids+=("$!")
x11vnc -display :3 -forever -shared -localhost -rfbport 6903 -nopw -quiet >"$log_dir/x11vnc.log" 2>&1 &
pids+=("$!")
websockify --web /opt/byclaw/novnc "${BYCLAW_GODOT_DESKTOP_PORT:-8083}" localhost:6903 >"$log_dir/viewer.log" 2>&1 &
pids+=("$!")
desktop_pids=("${pids[@]}")
BYCLAW_GODOT_HEADLESS=0 godot --project-manager --rendering-method gl_compatibility >"$log_dir/editor.log" 2>&1 &
pids+=("$!")
# The project manager can close when opening an editor. Keep its display alive.
wait -n "${desktop_pids[@]}"
