#!/usr/bin/env bash
set -euo pipefail
# Godot 4.6 looks in XDG_DATA_HOME, not XDG_DATA_DIRS. Link the immutable
# installation into each runtime home instead of storing templates in that home.
template_home="${XDG_DATA_HOME:-${HOME:?HOME is required}/.local/share}/godot/export_templates"
template_version=4.6.3.stable
mkdir -p "$template_home"
if [[ ! -e "$template_home/$template_version" && ! -L "$template_home/$template_version" ]]; then
    ln -s "/opt/godot/export_templates/$template_version" "$template_home/$template_version" \
        || [[ -e "$template_home/$template_version" || -L "$template_home/$template_version" ]]
fi
if [[ "${BYCLAW_GODOT_HEADLESS:-0}" == 1 ]]; then
    exec /opt/godot/bin/godot --headless "$@"
fi
exec /opt/godot/bin/godot "$@"
