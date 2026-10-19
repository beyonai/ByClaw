# @byclaw/dsh-tool-env

English | [中文](README.zh.md)

Run DSH's tool execution — files, Bash and other processes, terminals, PTC and
sandbox enforcement — in a separate sandbox (B), while the DSH process (A) keeps
the Web UI, agents, models, sessions and configuration.

**Opt-in.** Nothing changes unless `BYCLAW_DSH_TOOL_ENV` is `static` or
`opensandbox`; with it unset the profile keeps the base local providers.

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
  private DSH home and hands them to B at creation, so the host key is pinned
  without trusting first contact. B's sshd accepts only that key for `byclaw`,
  with no passwords, root login, or agent/reverse forwarding.
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

## Configuration

| Variable | Meaning |
|---|---|
| `BYCLAW_DSH_TOOL_ENV` | `opensandbox` or `static`; unset keeps local tools |
| `BYCLAW_TOOL_ENV_OPENSANDBOX` | JSON for the `opensandbox` backend (below) |
| `BYCLAW_TOOL_ENV_IDLE_MS` | idle pause delay; `0` keeps B running (default 600000) |
| `BYCLAW_TOOL_ENV_HOST`, `BYCLAW_TOOL_ENV_PORT` | `static` backend sshd endpoint |
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

- The OpenSandbox API key is held by A. A dedicated lifecycle endpoint in BE,
  using BE's own key, would remove that and is the natural next step.
- Only DSH's providers move to B. ByClaw plugins that start processes themselves
  still run them in A: the sidebar terminal, file tree and git, browser-use
  (Chromium), CodeGraph, devflow's git calls and agent-teams' external members.
  A keeps the same image and the shared `/by`, so they behave as before.
- bash-provider's memory and cgroup guards for build commands read A's
  `/proc/meminfo` and cgroup, not B's.
- B's host name relies on Docker DNS for the OpenSandbox Docker runtime
  (`hostTemplate`); other runtimes need their own address rule.

## Tests

`pnpm test` covers the OpenSandbox lifecycle against a fake server, the SSH
identity files, environment scrubbing and the profile patch staying inert by
default. `tests/fixtures/split-driver.ts` boots the real SSH provider
composition through this service against a live sshd. It checks files,
processes, PTY, PTC and sandbox confinement, plus a reconnect after B restarts.
