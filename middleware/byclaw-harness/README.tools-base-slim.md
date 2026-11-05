# Minimal tool sandbox base

`Dockerfile.tools.base-slim` provides the common execution layer for business tool sandboxes (B), paired with a compatible Harness (A). Build from the repository root for `linux/amd64`. It assembles a clean Debian 13 runtime with Python/pip/venv, Node/npm/npx, Bash, Git, CA certificates, SSH client/server, sudo, systemd/init and small command-line utilities. The matching donor's SSH helper/PTC closure is retained at its original paths, including native PTY/FFI payloads. It does not include the full Harness application.

Browser/Chromium/Playwright, X11/noVNC, media tools, Java/Office, business connectors, builtin business skills and game engines are supplied and tested by each business layer. Existing business Dockerfiles are not automatically compatible with this base. A command being absent is intentional unless that layer declares it.

## Business image usage

Business Dockerfiles use the canonical LAN Harbor base tag:

```dockerfile
FROM 192.168.0.81:8080/byclaw/byclaw-harness-tools:D0.6.0_base_slim
USER root
# Install this business layer's runtime dependencies and resources here.
# Retain the tool SSH entrypoint, /workspace helper closure and /by workspace.
```

Use the published digest in production `FROM` references and record it alongside the business release. The canonical tag is a release pointer; unique dated candidate tags and the digest identify the actual tested artifact. Rebuilding a mutable tag does not reproduce the tested image. Do not switch existing browser/media images to this base without porting their dependencies and rerunning their own acceptance checks.

## Building and compatibility

Supply immutable `TOOLS_IMAGE` and `RUNTIME_IMAGE` references when building:

```bash
docker build --platform linux/amd64 \
  -f middleware/byclaw-harness/Dockerfile.tools.base-slim \
  --build-arg TOOLS_IMAGE='<compatible transport-only tool image>@sha256:<digest>' \
  --build-arg RUNTIME_IMAGE='<Debian 13 Python runtime>@sha256:<digest>' \
  -t 'byclaw-harness-tools:<unique-candidate-tag>' .
bash middleware/byclaw-harness/scripts/tool-base-slim-smoke.sh \
  'byclaw-harness-tools:<unique-candidate-tag>'
```

`TOOLS_IMAGE` must have the already collected transport-only `/workspace` closure, not a complete Harness workspace. Match its helper/PTC hashes and Node executable to A. Digest checks and imports alone do not establish native PTY, subprocess or PTC execution: exercise those operations against the intended A version. Record runtime donor digests, build logs and dependency versions; package mirrors can change independently of image digests.

The Dockerfile's narrow ignore file excludes user workspaces, configuration and credentials. Pip and npm default to domestic mirrors. Debian `/etc/passwd` and `/etc/group` remain ordinary writable files; systemd/init and sudo satisfy the selected platform image contract. Installing systemd does not make it PID 1 in a normal Docker smoke test.

## Startup and cloud templates

Docker starts `/usr/local/bin/byclaw-tool-base-entrypoint`; the legacy `/usr/local/bin/byclaw-dsh-entrypoint tools` path remains compatible. The transport uses the `byclaw` account, key-only authentication and `/by` workspace. Configure `BYCLAW_TOOL_ENV_AUTHORIZED_KEY` and base64 `BYCLAW_TOOL_ENV_HOST_KEY`, or mount a private seed directory with `client_ed25519.pub` and `host_ed25519`. Never bake those keys into an image. `BYCLAW_TOOL_ENV_SEED_GENERATE=1` is an isolated test/bootstrap option, not a reason to snapshot shared identities.

Set `BYCLAW_TOOL_ENV_WS_PORT=8022` for the HTTP/WebSocket bridge. If platform SSH occupies port 22, set `BYCLAW_TOOL_ENV_PORT=2222`; retain pinned host-key verification. Runtime environment values are forwarded to tool SSH sessions with credential-control variables excluded by the launcher. Do not mount over `/workspace` or the Node runtime. A home mount must supply a writable usable home; this minimal entrypoint does not repopulate a mounted home from the full Harness image.

The cloud platform injects envd: no envd binary belongs in this base. A Docker `ENTRYPOINT` is not a MicroVM template start command. Configure template start/readiness explicitly for the platform, and start tool SSH only after runtime keys are available. Template snapshots must not retain generated SSH identities, temporary validation keys, authorization headers or user data; provision per-instance keys after restore. Successful image build, Docker smoke and template readiness are separate checks. Cloud acceptance additionally requires a real command plus file write/read roundtrip in an isolated instance.

Report uncompressed rootfs/image bytes separately from compressed registry transfer bytes, and report any unverified container, confinement or cloud behavior explicitly.
