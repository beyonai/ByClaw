# @byclaw/dsh-tool-env

English | [中文](README.zh.md)

Run DSH's tool execution — files, Bash and other processes, terminals, PTC and
sandbox enforcement — in a separate sandbox (B), while the DSH process (A) keeps
the Web UI, agents, models, sessions and configuration.

**Opt-in.** Nothing changes unless `BYCLAW_DSH_TOOL_ENV` is `static`,
`opensandbox` or `byclaw-be`; with it unset the profile keeps the base local
providers.

## How it works

```
A (byclaw-dsh sandbox)                         B (tool sandbox, same image)
  Web UI · agents · models · sessions            sshd (byclaw-dsh-entrypoint tools)
  ctx.fs / ctx.subprocess / ctx.sandbox  ──SSH──▶ DSH SSH helper → local fs/processes/sandbox
  = DSH SSH providers over ctx.ssh                /by  (same host volume as A)
  ctx.ssh = ToolEnv: lease · resume · pause       ~/.dsh/agent-templates (read-only, synced skills)
```

- The profile patch swaps the base `fs-sandbox`, `subprocess`, `sandbox` and
  `ptc-runtime` rows for DSH's `dsh-fs-ssh`, `dsh-subprocess-ssh`,
  `dsh-sandbox-ssh` and an SSH-launched PTC runtime.
- `ctx.ssh` is this plugin. DSH's `SshConnection` never reconnects, so the
  service keeps one stable `ctx.ssh` and leases a fresh inner connection when the
  previous one is gone. Nothing is replayed: an operation in flight when B
  disappears fails once, and the next one reconnects.
- **Lease:** the first remote operation creates B, or resumes it when paused, and
  waits for its sshd.
- **Idle:** after `BYCLAW_TOOL_ENV_IDLE_MS` (default 10 min) without operations
  or open streams, B is paused. Running commands and background jobs hold
  streams open, so they are never paused underneath.
- **Gone:** a deleted or expired B is recreated on the next lease. The workspace
  is a host volume shared with A, so pausing or recreating B loses no files; only
  B's own root filesystem (e.g. ad-hoc installs) is lost on recreation.
- **Expiry:** A renews B's OpenSandbox expiry while it uses B. A B whose A
  disappeared without a graceful shutdown lives at most `timeoutSeconds`.
- **Identity:** A owns both SSH key pairs (client and B's host key) in its
  private DSH home, so the host key is pinned without trusting first contact.
  They reach B either in its create request (`opensandbox`) or through A's
  state directory mounted read-only into B (`byclaw-be`, see below). B's sshd
  accepts only that key for `byclaw`, with no passwords, root login, or
  agent/reverse forwarding.
- **Secrets:** every remote spawn and lookup passes through this service, which
  strips `BYCLAW_TOOL_ENV_*` and `BYCLAW_DSH_TOOL_ENV` from the forwarded
  environment. A's sessions, credentials and profiles are never mounted in B.
- **Confinement:** in split mode the entrypoint defaults `DSH_PERMISSION_MODE`
  to `danger-full-access` (override with `DSH_PERMISSION_MODE` or
  `BYCLAW_TOOL_ENV_PERMISSION_MODE`). B itself is the isolation boundary, and
  per-command bwrap/Landlock is unavailable inside containers on hosts that block
  user namespaces, where `workspace-write` would refuse every command.

A and B must run the **same image**: A computes the helper and PTC bootstrap
digests from its own installation, and the helper refuses a mismatch.

## Backends

| `BYCLAW_DSH_TOOL_ENV` | Who creates B | Idle pause | Where the keys come from |
|---|---|---|---|
| `static` | nobody: a fixed sshd (development, tests) | no | start sshd with them |
| `opensandbox` | A, through the OpenSandbox API with a key held in A | yes | B's create request |
| `byclaw-be` | ByClaw BE, from a `sandbox_service_spec` row, as the user | not yet | A's state directory, mounted into B |

### `byclaw-be`

A asks BE for the user's sandbox of type `serviceKey` (default
`byclaw-dsh-tools`) with `POST /sandbox/launchByUserCode`, which is
get-or-create per user and type, and reads B's sshd address from the returned
`instanceEndpoints[sshInstance]` (default `ssh`). BE keeps the OpenSandbox
credential, the spec and the sandbox record; A sends only the user's own
`BEYOND_TOKEN`, which BE already injects into A. When the returned address does
not accept connections, A releases that record once (`/sandbox/removeSandbox`)
and launches again.

The B spec is a normal `sandbox_service_spec` row. It must use A's image, run
the `tools` entrypoint, declare the sshd port as a `tcp` port named
`sshInstance`, share `/by`, and mount A's tool-env state directory read-only at
`BYCLAW_TOOL_ENV_SEED_DIR` (default `/etc/byclaw-tool-env`) so B's sshd finds
`client_ed25519.pub` and `host_ed25519`. Host paths below follow the `byclaw-dsh`
layout and are deployment-specific:

```json
{
  "image": "byclaw/dsh:local",
  "startup": { "entrypoint": ["/usr/local/bin/byclaw-dsh-entrypoint", "tools"] },
  "ports": [{ "port": 22, "instance": "ssh", "protocol": "tcp" }],
  "timeout": 3600,
  "resourceLimits": { "cpu": "2", "memory": "4Gi" },
  "env": { "BYCLAW_TOOL_ENV_PORT": "22", "TZ": "Asia/Shanghai" },
  "volumes": [
    { "key": "by", "scope": "PRIVATE", "hostPath": "/mnt/byclaw-file", "subPath": "byclaw-${user_code}/by",
      "mountPath": "/by", "uid": 1001, "gid": 1001, "mode": "0770" },
    { "key": "templates", "scope": "PRIVATE", "hostPath": "/mnt/byclaw-file",
      "subPath": "byclaw-dsh/byclaw-${user_code}/dsh-home/agent-templates",
      "mountPath": "/home/byclaw/.dsh/agent-templates", "readOnly": true },
    { "key": "tool-env-keys", "scope": "PRIVATE", "hostPath": "/mnt/byclaw-file",
      "subPath": "byclaw-dsh/byclaw-${user_code}/dsh-home/byclaw-tool-env",
      "mountPath": "/etc/byclaw-tool-env", "readOnly": true }
  ]
}
```

A `tcp` port makes BE resolve the sandbox-network address
(`?resolve_internal=true`), which is what `tcp://host:22` in `instanceEndpoints`
carries. BE builds before that resolver, or OpenSandbox servers without
`resolve_internal`, return nothing usable for the tcp port; A then falls back to
`BYCLAW_TOOL_ENV_HOST_TEMPLATE` (`sandbox-{id}`, the Docker runtime's container
name) with `BYCLAW_TOOL_ENV_PORT`.

### Runtimes behind an HTTP ingress (WebSocket transport)

Where B is reachable only through an HTTP ingress (an ALB in front of an ACS or
Kubernetes runtime, addresses like `http://alb-…/kruise/<sandbox>/<port>/…?token=…`),
raw SSH cannot pass. B then also serves a WebSocket bridge to its sshd
(`scripts/ws-bridge.py`, started by `tool-env-sshd.sh` when
`BYCLAW_TOOL_ENV_WS_PORT` is set; the image needs `python3-websockets`), and A's
ssh goes through `scripts/ws-proxy.mjs` as its `ProxyCommand`. The host key stays
pinned (`HostKeyAlias`). Declare the bridge port as the ssh instance:

```json
"ports": [{ "port": 8022, "instance": "ssh", "protocol": "http" }],
"env": { "BYCLAW_TOOL_ENV_PORT": "22", "BYCLAW_TOOL_ENV_WS_PORT": "8022" }
```

An `http(s)://` or `ws(s)://` value in `instanceEndpoints.ssh` is used verbatim
as the bridge URL, query string (ingress token) included; a BE ingress path is
resolved against the BE base URL. The `static` backend accepts the same through
`BYCLAW_TOOL_ENV_WS_URL`. The ingress must pass WebSocket upgrades on that path.
B's `/by` subPath must be the same as A's. Note that `launchByUserCode` records
`serviceKey` as the user's preferred sandbox spec, and that it acts for the
`userCode` in its body; both are accepted as they are.

## Configuration

| Variable | Meaning |
|---|---|
| `BYCLAW_DSH_TOOL_ENV` | `opensandbox`, `byclaw-be` or `static`; unset keeps local tools |
| `BYCLAW_TOOL_ENV_OPENSANDBOX` | JSON for the `opensandbox` backend (below) |
| `BYCLAW_TOOL_ENV_BE_BASE_URL` | `byclaw-be`: BE origin with path prefix; falls back to `BYCLAW_DSH_BASE_URL`, then `BYAI_SERVICE_BASE_URL` |
| `BYCLAW_TOOL_ENV_SERVICE_KEY` | `byclaw-be`: B's `service_key` (default `byclaw-dsh-tools`) |
| `BYCLAW_TOOL_ENV_SSH_INSTANCE` | `byclaw-be`: `instanceEndpoints` key of B's sshd (default `ssh`) |
| `BYCLAW_TOOL_ENV_HOST_TEMPLATE` | `byclaw-be`: B's host name from its sandbox id when BE returns no address for the ssh port (default `sandbox-{id}`, Docker DNS; empty disables) |
| `BYCLAW_TOOL_ENV_WS_PORT` | On B: also serve the WebSocket bridge to sshd on this port |
| `BYCLAW_TOOL_ENV_SYSTEM_CODE` | `byclaw-be`: optional `system-code` header |
| `BYCLAW_TOOL_ENV_READY_TIMEOUT_MS`, `BYCLAW_TOOL_ENV_BE_REQUEST_TIMEOUT_MS` | `byclaw-be`: sshd readiness and BE request deadlines (default 180000) |
| `USER_CODE`, `BEYOND_TOKEN` | `byclaw-be`: the user and token BE injected into A; reused as-is |
| `BYCLAW_TOOL_ENV_IDLE_MS` | idle pause delay; `0` keeps B running (default 600000) |
| `BYCLAW_TOOL_ENV_HOST`, `BYCLAW_TOOL_ENV_PORT` | `static` backend sshd endpoint |
| `BYCLAW_TOOL_ENV_WS_URL` | `static` backend: B's WebSocket bridge URL instead of a TCP endpoint |
| `BYCLAW_TOOL_ENV_WORKSPACE` | remote default workspace (default `/by`) |
| `BYCLAW_TOOL_ENV_PERMISSION_MODE` | permission mode in split mode (default `danger-full-access`) |

`BYCLAW_TOOL_ENV_OPENSANDBOX`:

```json
{
  "baseUrl": "http://opensandbox-server:9005",
  "apiKey": "<OpenSandbox API key>",
  "image": "byclaw/dsh:local",
  "timeoutSeconds": 1800,
  "resourceLimits": { "cpu": "2", "memory": "4Gi" },
  "env": { "TZ": "Asia/Shanghai" },
  "metadata": { "byclawToolEnvOwner": "<user>" },
  "volumes": [
    { "name": "<user>-byclaw-dsh-tools-0", "host": { "path": "/mnt/byclaw-file" },
      "mountPath": "/by", "subPath": "byclaw-<user>/by",
      "scope": "PRIVATE", "uid": 1001, "gid": 1001, "mode": "0770", "readOnly": false },
    { "name": "<user>-byclaw-dsh-tools-1", "host": { "path": "/mnt/byclaw-file" },
      "mountPath": "/home/byclaw/.dsh/agent-templates",
      "subPath": "byclaw-dsh/byclaw-<user>/dsh-home/agent-templates",
      "scope": "PRIVATE", "uid": 1001, "gid": 1001, "mode": "0770", "readOnly": true }
  ]
}
```

Other keys: `entrypoint` (default `["/usr/local/bin/byclaw-dsh-entrypoint","tools"]`),
`hostTemplate` (B's host name on the shared Docker network, default
`sandbox-{id}`) and `readyTimeoutMs` (default 180000). Do not use the
`userCode`/`serviceKey` metadata keys: ByClaw BE reuses sandboxes matching them.

With ByClaw BE, a spec only passes personal settings into a sandbox through
placeholders, so the `byclaw-dsh` spec declares
`"BYCLAW_DSH_TOOL_ENV": "${envVars.BYCLAW_DSH_TOOL_ENV}"` (and likewise for the
other variables). They render empty for everyone else. Keep the OpenSandbox key
out of the global spec: it would reach every A.

## Known limitations

- With the `opensandbox` backend the OpenSandbox API key is held by A; the
  `byclaw-be` backend exists to avoid that.
- Only DSH's providers move to B. ByClaw plugins that start processes themselves
  still run them in A: the sidebar terminal, file tree and git, browser-use
  (Chromium), CodeGraph, devflow's git calls and agent-teams' external members.
  A keeps the same image and the shared `/by`, so they behave as before.
- bash-provider's memory and cgroup guards for build commands read A's
  `/proc/meminfo` and cgroup, not B's.
- With `opensandbox`, B's host name relies on Docker DNS for the OpenSandbox
  Docker runtime (`hostTemplate`); `byclaw-be` uses the address BE resolves.
- The shared DSH host (`scripts/byclaw-multi-host.mjs`) still configures the
  `opensandbox` backend per user context.

## Follow-ups (`byclaw-be`, deliberately not done yet)

- **Idle pause/resume.** BE has no pause API, so `pause()` is a no-op and B keeps
  running between turns. OpenSandbox's pause/resume is reachable through BE's
  `/v1/sandboxes/**` passthrough if this is wanted later.
- **Releasing B.** Nothing removes B when A is released. BE's idle cleanup and
  the DSH silent release only cover A's own sandbox type; B needs either an
  explicit `removeSandbox` on A's shutdown or its own heartbeat and reclaim rule.

## Tests

`pnpm test` covers the OpenSandbox lifecycle and the ByClaw BE launch, fallback
and relaunch flows against fake servers, the SSH identity files, environment
scrubbing and the profile patch staying inert by default. `tests/fixtures/split-driver.ts` boots the real SSH provider
composition through this service against a live sshd. It checks files,
processes, PTY, PTC and sandbox confinement, plus a reconnect after B restarts.
