# Minimal tool sandbox base

`Dockerfile.tools.base-slim` provides the common execution layer for business tool sandboxes (B), paired with a compatible Harness (A). Build from the repository root for `linux/amd64`. It assembles a clean Debian 13 runtime with Python/pip/venv, Node/npm/npx, Bash, Git, CA certificates, SSH client/server, sudo, systemd/init and small command-line utilities. The matching donor's SSH helper/PTC closure is retained at its original paths, including native PTY/FFI payloads. It does not include the full Harness application.

Browser/Chromium/Playwright, X11/noVNC, media tools, Java/Office, business connectors, builtin business skills and game engines are supplied and tested by each business layer. Existing business Dockerfiles are not automatically compatible with this base. A command being absent is intentional unless that layer declares it.

## Business image usage

Business Dockerfiles use the canonical LAN Harbor base tag:

```dockerfile
FROM 192.168.0.81:8080/byclaw/byclaw-harness:D0.6.0_base_slim
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
  --build-arg TOOLS_IMAGE='<the A image, e.g. byclaw-harness:D0.7.0_slim>@sha256:<digest>' \
  --build-arg RUNTIME_IMAGE='<Debian 13 Python runtime>@sha256:<digest>' \
  -t 'byclaw-harness:<unique-candidate-tag>' .
bash middleware/byclaw-harness/scripts/tool-base-slim-smoke.sh \
  'byclaw-harness:<unique-candidate-tag>'
```

`TOOLS_IMAGE` is the transport donor: preferably the A image this base will serve (for example `D0.7.0_slim`). The build collects the SSH helper/PTC closure from it with `collect-closure.sh`, so B carries the very files A verifies by digest, together with A's Node executable. A transport-only tool image built earlier still works as a donor. Rebuild this base whenever A changes. Digest checks and imports alone do not establish native PTY, subprocess or PTC execution: exercise those operations against the intended A version. Record runtime donor digests, build logs and dependency versions; package mirrors can change independently of image digests.

The Dockerfile's narrow ignore file excludes user workspaces, configuration and credentials. Pip and npm default to domestic mirrors. Debian `/etc/passwd` and `/etc/group` remain ordinary writable files; systemd/init and sudo satisfy the selected platform image contract. Installing systemd does not make it PID 1 in a normal Docker smoke test.

## Startup and cloud templates

Docker starts `/usr/local/bin/byclaw-tool-base-entrypoint`; the legacy `/usr/local/bin/byclaw-dsh-entrypoint tools` path remains compatible. The transport uses the `byclaw` account, key-only authentication and `/by` workspace. Configure `BYCLAW_TOOL_ENV_AUTHORIZED_KEY` and base64 `BYCLAW_TOOL_ENV_HOST_KEY`, or mount a private seed directory with `client_ed25519.pub` and `host_ed25519`. Never bake those keys into an image. `BYCLAW_TOOL_ENV_SEED_GENERATE=1` is an isolated test/bootstrap option, not a reason to snapshot shared identities.

Set `BYCLAW_TOOL_ENV_WS_PORT=8022` for the HTTP/WebSocket bridge. If platform SSH occupies port 22, set `BYCLAW_TOOL_ENV_PORT=2222`; retain pinned host-key verification. Runtime environment values are forwarded to tool SSH sessions with credential-control variables excluded by the launcher. Do not mount over `/workspace` or the Node runtime. A home mount must supply a writable usable home. When the image ships a home seed at `/usr/local/share/byclaw-tool-home` (a business layer may add one), the entrypoint copies missing files from it into the mounted home at start and never overwrites existing ones.

The cloud platform injects envd: no envd binary belongs in this base. A Docker `ENTRYPOINT` is not a MicroVM template start command. Configure template start/readiness explicitly for the platform, and start tool SSH only after runtime keys are available. Template snapshots must not retain generated SSH identities, temporary validation keys, authorization headers or user data; provision per-instance keys after restore. Successful image build, Docker smoke and template readiness are separate checks. Cloud acceptance additionally requires a real command plus file write/read roundtrip in an isolated instance.

Report uncompressed rootfs/image bytes separately from compressed registry transfer bytes, and report any unverified container, confinement or cloud behavior explicitly.

## Process supervision and services

`byclaw-tool-base-entrypoint` is a root process that never exits except on SIGTERM/SIGINT; on a MicroVM it runs as a plain service without restart. It writes the SSH keys and configuration (through `byclaw-tool-env-sshd` with `BYCLAW_TOOL_ENV_PREPARE_ONLY=1`), then runs sshd and, when `BYCLAW_TOOL_ENV_WS_PORT` is set, the WebSocket bridge as independent children. A child that exits is restarted on its own with backoff (1 s doubling to 30 s, reset after a minute of uptime); no child's exit stops another.

Business layers declare long-running services in `/etc/byclaw-tool-sandbox/services.d/*.json` instead of wrapping the entrypoint:

```json
{"name": "browser", "command": ["/usr/local/bin/byclaw-browser-supervisor", "--browser-service"],
 "user": "root", "group": "work", "oomScoreAdj": 500, "restart": "always",
 "skipIfEnv": {"BYCLAW_BYCLI_ENABLED": ["false", "0"]}, "env": {}}
```

`name` is lowercase letters, digits and hyphens; `command` is an argv list; `user` defaults to `byclaw`; `group` is `work` (default, OOM score 500) or `transport` (default -1000); `restart` is `always` or `on-failure`. An invalid declaration is logged and skipped; it never prevents SSH from starting. A service must not start or stop SSH.

## Memory isolation

When cgroup v2 is writable and has the memory controller, the entrypoint creates `/sys/fs/cgroup/byclaw/transport` (sshd, the bridge and every SSH session, with `memory.min` = `BYCLAW_TOOL_TRANSPORT_MEMORY_MIN`, default 160 MiB) and `/sys/fs/cgroup/byclaw/work` (services and tool commands, `memory.max` = machine memory − `BYCLAW_TOOL_WORK_MEMORY_RESERVE`, default 256 MiB, never under half the machine). `memory.oom.group` stays off, so the kernel kills one process, normally the browser or the heaviest command, rather than everything in `work`. In a container with its own writable cgroup namespace the entrypoint first moves the root's processes into `init`, as a container init does, because a namespaced root holding processes may not delegate controllers; there `/proc/meminfo` shows the host, so the container's own limit, not `work`'s cap, bounds memory. The groups sit under the cgroup root rather than inside the start service, which a MicroVM template does not delegate and whose ancestors have no memory floor; the entrypoint itself stays in its service. The `byclaw` user may write `byclaw/cgroup.procs` and `byclaw/work/cgroup.procs`, which moving a command into `work` requires; it could equally join `transport`.

Without a writable cgroup tree only OOM priorities are set: the entrypoint and the bridge at -1000, services at their declared score. sshd starts at 0 so that OpenSSH protects its listener and returns sessions to 0.

The result is written to `/run/byclaw-tool-sandbox/isolation`. `/usr/local/bin/byclaw-tool-workload COMMAND…` reads it, joins `work` and raises its OOM score to 500, then execs the command in place. A puts this wrapper in front of every process it starts on B when B has it, so commands, the PTC runtime and the native browser bridge are workloads while the SSH helper is not.
