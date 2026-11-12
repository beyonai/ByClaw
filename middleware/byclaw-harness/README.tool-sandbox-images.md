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

Use `192.168.0.81:8080/byclaw/byclaw-harness-tools:<tag>` for Dockerfile parent defaults and pin the tested digest for release builds. Keep exact donor-image digests, source SHA manifests, image/rootfs sizes, registry digests and validation logs with the release receipt. A changed canonical tag must not silently retarget an existing sandbox; validate a new template and update only the explicitly selected aliyun83 service configuration. Existing running instances retain their lifecycle.

The whole family is built from one Harness (A) image and no other image: `base-slim` collects the SSH helper closure from A, `browser` takes A's native browser runtime and installs the Playwright release that runtime pins (Chromium from the domestic mirror) plus byCLI and noVNC, and every purpose layer builds on `browser`. Build in that order, passing the same A by digest:

```bash
A='<the A image>@sha256:<digest>'
docker build -f middleware/byclaw-harness/Dockerfile.tools.base-slim --build-arg TOOLS_IMAGE="$A" \
  --build-arg RUNTIME_IMAGE='<Debian 13 Python runtime>@sha256:<digest>' -t byclaw-harness-tools:<tag>_base_slim .
docker build -f middleware/byclaw-harness/Dockerfile.tools.browser --build-arg HARNESS_IMAGE="$A" \
  --build-arg TOOLS_IMAGE=byclaw-harness-tools:<tag>_base_slim -t byclaw-harness-tools:<tag>_browser .
```

Every parent image has an internal Harbor default (`192.168.0.81:8080`: A is `byclaw/byclaw-harness:D0.6.0_slim`, the runtime is `library/python:3.12-slim-trixie`, and each layer's parent is the previous `byclaw-harness-tools:D0.6.0_<layer>` tag), so on the internal network the family builds in order with no build arguments:

```bash
for layer in base-slim:base_slim browser:browser general:general; do
  docker build -f "middleware/byclaw-harness/Dockerfile.tools.${layer%%:*}" \
    -t "192.168.0.81:8080/byclaw/byclaw-harness-tools:D0.6.0_${layer##*:}" . &&
  docker push "192.168.0.81:8080/byclaw/byclaw-harness-tools:D0.6.0_${layer##*:}" || break
done
```

Docker uses a parent tag already present locally; pushing keeps Harbor current for other build hosts. On an Alibaba Cloud build host, add `--build-arg BYCLAW_APT_MIRROR=http://mirrors.cloud.aliyuncs.com` for a faster Debian mirror. When A changes, rebuild the family from it: A refuses a B whose SSH helper differs from its own. Verify the already-built local image from the repository root with the following command. Set `IMAGE` to the image to inspect, preferably by its tested immutable digest.

```bash
IMAGE='' # Required: the already-built local browser image or digest.
: "${IMAGE:?Set IMAGE to the local browser image to inspect}"
docker run --pull=never --rm --network none --entrypoint node "$IMAGE" --input-type=module -e '
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
const root = process.env.BYCLAW_BROWSER_NOVNC_DIR || "/opt/byclaw/novnc";
const html = await readFile(`${root}/index.html`, "utf8");
assert.match(html, /import\s*\{\s*createConnectionBridge\s*\}\s*from\s*["\x27]\.\/connection-bridge\.js["\x27]/,
  "desktop page must load its connection observation bridge");
await access(`${root}/core/rfb.js`);
const bridge = await readFile(`${root}/connection-bridge.js`, "utf8");
const module = await import(`data:text/javascript;base64,${Buffer.from(bridge).toString("base64")}`);
assert.equal(typeof module.createConnectionBridge, "function");
console.log("browser viewer assets verified");
'
```

This check starts only Node with networking disabled and never pulls an image or starts its supervisor. It checks that the desktop page loads the bridge and that the bridge module and RFB asset are present. Retest the complete runtime after this update; this check does not establish a live VNC connection or rebuild dependencies or binaries.

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
