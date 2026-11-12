# Godot tool sandbox

`Dockerfile.tools.godot` adds standard Godot 4.6.3 to the slim-derived browser image. GDScript is built into the engine: this single business sandbox provides the full Godot editor and GDScript validation/execution capabilities. It retains the browser, SSH/helper/PTC transport and Web/Linux x86_64 export. It excludes .NET, Unity and Android/iOS/macOS/Windows export templates.

Default parents and release tags use the LAN Harbor repository:

| Dockerfile | Default parent | Output tag |
| --- | --- | --- |
| `Dockerfile.tools.godot` | `192.168.0.81:8080/byclaw/byclaw-harness:D0.6.0_browser` | `D0.6.0_godot` |

Build from the repository root for linux/amd64. Pin the tested parent digest through `BROWSER_IMAGE` for release reproducibility. ACR copies are cloud deployment artifacts, not default Dockerfile parents. Build unique candidate tags and validate them before updating any approved release pointer; do not replace existing instances or service specs.

## Controlled installation payload

Supply a separate local BuildKit named context containing these verified upstream files:

- `Godot_v4.6.3-stable_linux.x86_64.zip`
- `Godot_v4.6.3-stable_export_templates.tpz`

Use `--build-context godot-assets=/controlled/assets/directory`. A local `.cache/byclaw-build-assets/godot/` directory is also suitable and already ignored by Git. The repository build context admits only the required source/manifest files, without installation archives. The build checks fixed SHA-512 digests from the upstream 4.6.3 release, then extracts only the editor and Web/Linux x64 templates into the final image. The source archives remain in an intermediate stage. An empty `FROM scratch AS godot-assets` placeholder makes a missing named context fail with a missing-file error; it cannot implicitly pull a similarly named Docker Hub image. There are no build-time download URLs or network fallback for Godot artifacts. A fresh checkout can run static repository checks without fetching binary payloads.

On build host 53, the previously verified payload is `/data/byai/releases/godot-tools-20261103/assets/`. Build directly from that controlled directory:

```bash
docker build --platform linux/amd64 \
  -f middleware/byclaw-harness/Dockerfile.tools.godot \
  --build-context godot-assets=/data/byai/releases/godot-tools-20261103/assets \
  -t '192.168.0.81:8080/byclaw/byclaw-harness:<unique-godot-candidate>' .
```

Templates reside in immutable `/opt/godot/export_templates/4.6.3.stable`. Godot 4.6.3 uses its user data directory for template lookup, so the `godot` wrapper creates a version symlink under `${XDG_DATA_HOME:-$HOME/.local/share}/godot/export_templates` on invocation. It preserves existing owner-provided template entries and works with a fresh writable mounted home without duplicating templates. `XDG_DATA_DIRS` alone does not configure template lookup; this follows [upstream EditorPaths](https://github.com/godotengine/godot/blob/4.6.3-stable/editor/file_system/editor_paths.cpp).

## Runtime behavior and acceptance

Godot starts a project manager on X display `:3`, loopback RFB `6903`, with its own viewer at `BYCLAW_GODOT_DESKTOP_PORT=8083`. Browser preview remains on viewer `8081` and its own displays/ports. Both viewers require the existing authenticated platform ingress; never expose raw noVNC publicly. The launcher starts as root for SSH preparation and runs the editor desktop as `byclaw`. Runtime SSH keys follow the common base's existing injection contract.

The business Dockerfile applies the reviewed browser supervisor after installing assets. Its launcher removes injected SSH host/authorization key variables before starting unprivileged desktop processes, while retaining them for the privileged SSH bootstrap. This security overlay also applies when rebuilding against an older pinned browser parent.

Use `godot --headless --check-only --script file.gd` for GDScript validation and `godot --headless --script file.gd` for execution. For an entirely noninteractive instance, set `BYCLAW_GODOT_HEADLESS=1` and `BYCLAW_GODOT_DESKTOP_ENABLED=0` at startup; browser preview remains available. The default full Godot instance starts its editor desktop. Keep projects under `/by`; no project or user credential is built into the image.

Run `/usr/local/bin/byclaw-godot-business-smoke` as `byclaw` inside the actual image. It checks valid/invalid GDScript, project import, Web export and Linux export/player execution. Also verify the Web export in the inherited browser, both viewer routes, Godot project manager interaction, mounted-home template discovery and A-to-B SSH/helper/PTC command/file operations. Image build/version output alone does not establish business or cloud readiness. Record uncompressed image bytes, registry transfer bytes and isolated cloud template build results separately.

For browser and editor evidence, mount the repository's `scripts/godot-browser-smoke.mjs` read-only into an isolated container and execute it with Node as `byclaw`, passing a writable output directory. The check runs the business smoke, serves its Web export on loopback, waits for the scene's console marker in Chromium, connects to the editor's noVNC session and records both screenshots. It requires no external network or user project. This script starts its own desktop: run it with the container entrypoint overridden, for example `--entrypoint node`, and a fresh writable home. Verify normal production startup separately with the default entrypoint; do not run a second desktop against its occupied ports.

For a managed service specification declaring `vnc` on 8081 and `game-vnc` on
8083, set `env.BYCLAW_BROWSER_STARTUP=eager`. MicroVM readiness checks every
declared port before returning an execution lease; an on-demand browser would
leave 8081 closed and block acquisition even while SSH and the Godot desktop are
healthy. Keep the browser enabled in that specification. Headless callers that
omit viewer ports can retain the inherited on-demand behavior.
