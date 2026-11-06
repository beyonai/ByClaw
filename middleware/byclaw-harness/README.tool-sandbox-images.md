# Slim tool sandbox image family

Build from the repository root on host53 for `linux/amd64`. Dockerfile parents use81 LAN Harbor; copy tested artifacts to the Beijing ACR repository only for cloud template pulls. All release tags use `byclaw-harness-tools:D0.6.0_<purpose>`.

| Dockerfile | Tag | Parent / business capabilities |
| --- | --- | --- |
| `Dockerfile.tools.base-slim` | `D0.6.0_base_slim` | Clean Debian13, Python/Node/Git, exact Harness SSH/helper/PTC transport |
| `Dockerfile.tools.browser` | `D0.6.0_browser` | Slim base; Chromium/Playwright/byCLI, native browser automation and noVNC |
| `Dockerfile.tools.media` | `D0.6.0_media` | Browser business layer; HyperFrames/GSAP, FFmpeg/FFprobe |
| `Dockerfile.tools.unity` | `D0.6.0_unity` | Browser business layer; Unity Editor/Hub, WebGL/Linux toolchains and game desktop |
| `Dockerfile.tools.godot` | `D0.6.0_godot` | Browser business layer; Godot editor, built-in GDScript, Web/Linux exports and game desktop |

GDScript is provided by Godot. There is no separate GDScript image or service.

A's `glob` and `grep` run in the tool sandbox as `rg` from `PATH`: the shared host sets `BYCLAW_RIPGREP_PATH=rg`, because the ripgrep packaged in A's installation does not exist here. `Dockerfile.tools` keeps the parent's `rg` and `Dockerfile.tools.base-slim` installs `ripgrep`; both run `rg --version` at build time.

Use `192.168.0.81:8080/byclaw/byclaw-harness-tools:<tag>` for Dockerfile parent defaults and pin the tested digest for release builds. Keep exact donor-image digests, source SHA manifests, image/rootfs sizes, registry digests and validation logs with the release receipt. A changed canonical tag must not silently retarget an existing sandbox; validate a new template and update only the explicitly selected aliyun83 service configuration. Existing running instances retain their lifecycle.

For a reviewed browser supervisor-only correction, `Dockerfile.tools.browser --target browser-runtime-update` can reuse an already validated slim browser through an immutable `INSTALLED_BROWSER_IMAGE` digest. The default target still performs the complete build from the slim base. Business Dockerfiles explicitly copy the current supervisor after dependency installation, so a pinned parent never omits that correction. Retest the complete runtime after this update; do not use the target to imply dependencies or binaries were rebuilt.

All dependency downloads must default to verified domestic sources with no overseas fallback, as required by root `AGENTS.md`. The shared configurator persists APT, pip/npm/uv, Node/Corepack, Playwright/Puppeteer and Maven defaults in image configuration, login shells and SSH sessions. Reapply it after installing an older Maven3.8, which ignores `MAVEN_ARGS`. Explicit private repositories remain explicit. Godot installation uses fixed-SHA512 local archives admitted by its dedicated Docker ignore file, with no build-time fetch or fallback. Never bake runtime keys, licenses, Hub login, project data or provider credentials into any image.

Run the actual image checks, not only version commands:

- `scripts/tool-base-slim-smoke.sh IMAGE` on the Docker host; exercise matching A-to-B helper, filesystem, subprocess, PTY and PTC over TCP and WebSocket.
- `scripts/tool-browser-slim-smoke.sh IMAGE` on the Docker host; supervised byCLI activation, native browser actions/screenshots and RFB/WebSocket session isolation.
- `scripts/tool-media-slim-smoke.sh` inside the Media image as `byclaw`; actual offline video/audio render, decoded motion/audio and preview.
- `scripts/godot-business-smoke.sh` inside Godot as `byclaw`; valid/invalid GDScript, import, Web/Linux export and player execution. Also run its browser/desktop verification.

For each published image, validate an isolated aliyun83 cloud template plus command/file operations. Docker ENTRYPOINT does not replace MicroVM start configuration; SSH identities are provisioned per instance after restore. Keep authenticated viewer routing: browser8081, Unity/Godot desktop8083.

After all53 image builds, checks and publications finish, remove this run's validation containers, temporary payload copies and BuildKit build cache. Record before/after disk usage. Preserve published images, existing services, persistent volumes and release receipts; do not use volume or global image pruning as build-cache cleanup.

Unity project import, Player builds and WebGL export require the owner's valid runtime license. Verify those separately from Editor/Hub and installed toolchain readiness.

See [base details](README.tools-base-slim.md), [Unity](README.tools.unity.md) and [Godot](README.tools.godot.md).
