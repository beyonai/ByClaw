#!/usr/bin/env bash
# Run inside either game tool image as the sandbox user.
set -euo pipefail
godot --version
probe_dir=$(mktemp -d)
trap 'rm -rf "${probe_dir}"' EXIT
cd "${probe_dir}"
cat > project.godot <<'PROJECT'
config_version=5
[application]
config/name="ByClaw Godot smoke"
run/main_scene="res://main.tscn"
[display]
window/size/viewport_width=640
window/size/viewport_height=360
[rendering]
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
PROJECT
cat > main.gd <<'SCRIPT'
extends Node2D
func _ready():
	var background = ColorRect.new()
	background.color = Color(0.04, 0.08, 0.16)
	background.size = Vector2(640, 360)
	add_child(background)
	var label = Label.new()
	label.text = "ByClaw Godot + GDScript OK"
	label.position = Vector2(100, 160)
	label.add_theme_font_size_override("font_size", 24)
	add_child(label)
	print("BYCLAW_GODOT_SCENE_OK")
SCRIPT
cat > main.tscn <<'SCENE'
[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://main.gd" id="1"]
[node name="Main" type="Node2D"]
script = ExtResource("1")
SCENE
cat > valid.gd <<'SCRIPT'
extends SceneTree
func _initialize():
	print("BYCLAW_GDSCRIPT_OK")
	quit()
SCRIPT
printf 'extends SceneTree\nfunc broken(:\n' > invalid.gd
godot --headless --path . --script valid.gd | tee valid.log
grep -q BYCLAW_GDSCRIPT_OK valid.log
if godot --headless --path . --check-only --script invalid.gd > invalid.log 2>&1; then
    echo 'Invalid GDScript was accepted' >&2
    exit 1
fi
rm invalid.gd
godot --headless --path . --editor --import
cat > export_presets.cfg <<'PRESETS'
[preset.0]
name="Web"
platform="Web"
runnable=true
export_filter="all_resources"
export_path="build/web/index.html"
[preset.0.options]
variant/extensions_support=false
variant/thread_support=false
[preset.1]
name="Linux"
platform="Linux"
runnable=true
export_filter="all_resources"
export_path="build/linux/game.x86_64"
[preset.1.options]
binary_format/architecture="x86_64"
PRESETS
mkdir -p build/web build/linux
godot --headless --path . --export-release Web
godot --headless --path . --export-release Linux
test -s build/web/index.html
test -s build/web/index.wasm
test -s build/web/index.pck
chmod +x build/linux/game.x86_64
build/linux/game.x86_64 --headless --quit-after 2 | tee linux.log
grep -q BYCLAW_GODOT_SCENE_OK linux.log
# Optionally retain only exported test artifacts for external browser verification.
if [[ -n "${BYCLAW_GODOT_SMOKE_OUTPUT:-}" ]]; then
    mkdir -p "${BYCLAW_GODOT_SMOKE_OUTPUT}"
    cp -a build/. "${BYCLAW_GODOT_SMOKE_OUTPUT}/"
fi
echo BYCLAW_GODOT_BUSINESS_SMOKE_OK
