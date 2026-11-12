# General tool sandbox

`byclaw-dsh-tools` is a user-scoped execution sandbox paired with the shared Harness. It runs the user's Shell, Python, Node and business CLI commands, processes files, and starts its Chromium/remote desktop on demand. It does not run the shared Harness application. Java/Maven builds belong to the coding template and ffmpeg/video work to the media template; browser-only and game templates remain separate choices.

`Dockerfile.tools.general` builds it from the slim family: base-slim (SSH transport) → browser layer → general layer. It replaces `Dockerfile.tools`, which trimmed the full Harness image. The runtime publishes `/etc/byclaw-tool-sandbox/capabilities.json` with purpose `general`, matching the template market's strict admission handshake.

## Build chain

All images are `linux/amd64` and built from the repository root. Pin every input by digest.

```bash
# 1. Transport base: the SSH helper closure is collected from the A image itself.
docker build -f middleware/byclaw-harness/Dockerfile.tools.base-slim \
  --build-arg TOOLS_IMAGE='<A, e.g. byclaw-harness:D0.7.0_slim>@sha256:<digest>' \
  --build-arg RUNTIME_IMAGE='<Debian 13 Python runtime>@sha256:<digest>' \
  -t byclaw-harness:<tag>_base_slim .
# 2. Browser layer (see Dockerfile.tools.browser).
# 3. General layer.
docker build -f middleware/byclaw-harness/Dockerfile.tools.general \
  --build-arg BROWSER_IMAGE='byclaw-harness:<tag>_browser@sha256:<digest>' \
  --build-arg HARNESS_IMAGE='<the same A>@sha256:<digest>' \
  -t byclaw-harness:<tag>_general .
docker run --rm --entrypoint bash -u byclaw byclaw-harness:<tag>_general \
  -c "$(cat middleware/byclaw-harness/scripts/tool-general-slim-smoke.sh)"
```

Rebuild the chain whenever A changes; A rejects a B whose helper digest differs.

## Contents

| Group | Contents |
|---|---|
| From the browser layer | Chromium/Playwright, byCLI with its extension, browser supervisor (`BYCLAW_BROWSER_STARTUP=on-demand`), Xvfb/noVNC, CJK fonts, SSH transport |
| Skills | `/opt/byclaw/builtin` (Skills, `dws`, Python CLI sources, runtime tools), `/opt/byclaw/dsh-managed/skills`, plugin Skills copied from A |
| Python | `by-framework`, kbcli, callcli, dbcli, groksearchcli, `byclaw_caps[documents]` with its PPT stack, python-docx, matplotlib, uv, alibabacloud.mcp-proxy, searxng-cli |
| Node | wecom-cli and lark-cli (copied from A), pnpm |
| System | LibreOffice, ImageMagick, pandoc, poppler-utils, gh, ripgrep, fd, sqlite3, file, build tools, WQY fonts, aliyun CLI |

The browser does not run until first use, so an idle sandbox keeps its memory for user commands. A persistent home volume is filled at start from the image's home seed (`/usr/local/share/byclaw-tool-home`) without overwriting user files.

## Using it

Point the `byclaw-dsh-tools` spec's image at the `_general` tag. The entrypoint is `/usr/local/bin/byclaw-tool-slim-entrypoint tools`; the legacy `byclaw-dsh-entrypoint tools` path is routed to it. Ports: 22 (SSH), 8022 (WebSocket bridge when `BYCLAW_TOOL_ENV_WS_PORT` is set), 8081 (shared noVNC, instance `vnc`), 19825 (byCLI daemon, instance `bycli`).

The recommended starting specification is 2 CPU / 4Gi for scripts, CLI tools and a small number of browser pages. Large builds, batch processing and parallel browser workloads need larger profiles. Suggestions are not load-test guarantees. The tool market's built-in administrative preset maintains its description, capabilities, cover and this sizing guidance; actual service/resource configuration and template rebuild remain explicit administrative operations.

Sessions acquire separate leases against one user-scoped instance. Last-lease expiry/return starts the configured idle timeout (default five minutes); shared user-context cleanup also reclaims the user's tool resources. Persistent files belong to the generic filesystem and remain independent of the instance lifetime.
