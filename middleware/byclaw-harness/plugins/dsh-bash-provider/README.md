# @byclaw/dsh-bash-provider

[中文](README.zh.md) | English

This opt-in DSH profile bundle forwards every defined variable from the DSH host process into model-facing Bash commands, and routes eligible commands through [rtk](https://github.com/rtk-ai/rtk) (Rust Token Killer) to compress their output and save tokens. It also resolves the current `USER_CODE` through `SHARE_BFM_USER_CODE_<USER_CODE>`, then loads runtime values from `byai:user:private_params:<USER_CODE>` and `user:<userId>:login:auth`. Credential-shaped names such as `BEYOND_TOKEN`, `DEEPSEEK_API_KEY`, `PASSWORD`, and `SECRET` are supplied through the shell request's explicit environment, so they survive DSH's ambient subprocess scrub and remain available to programs launched by Bash, including Python `os.environ`.

The plugin subclasses the shipped sandboxed Bash provider. It preserves the active sandbox provider, sandbox policy, process-tree ownership, timeouts, output limits, and termination behavior; only the explicit child environment and (for an eligible command) the shell source change. It does not modify DSH source or replace the shared subprocess service.

The rtk-wrapping half was originally the standalone `@byclaw/dsh-bash-rtk` plugin (itself from [`DeepTrial/dsh-bash-rtk`](https://github.com/DeepTrial/dsh-bash-rtk), MIT) and was merged in here so a single row covers both capabilities, since this deployment always wants them together.

## Install

Build the package in the DSH workspace, then add it to each profile that should expose its host environment:

```sh
pnpm --filter @byclaw/dsh-bash-provider run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-bash-provider
```

The bundle disables the shipped `bash-sandbox` row and installs `byclaw-bash-provider` with the same 60-second default timeout. It remains disabled on Windows, matching the shipped Bash provider.

## Busy Enter delivery

This package was previously named `dsh-env-forward`; `dsh-bash-provider` is its current source directory. The bundle sets the default of the Web profile's `ui-conversation` row from the launch environment; the shipped `settings` row is unchanged.

Set this in the DSH launch environment or its `.env` file:

```dotenv
BYCLAW_DSH_BUSY_ENTER=queue
```

`queue` (also the default when unset) means Queue; `steer` means Steer. Other values, including an empty string, fail validation and the `ui-conversation` row does not load. The value is read when the profile loads; restart DSH after changing it. Redis parameters forwarded to Bash do not configure the Host UI.

The value is the `ui-conversation` row's `busyEnter` default and is never written anywhere. A preference saved in the UI goes to the profile's `cordis.patch.yml`, whose `ui-conversation` entry replaces that config and so takes precedence; remove that entry to inherit the environment default again. UI changes continue to apply live. While the agent is busy, Enter uses the selected behavior and Cmd/Ctrl+Enter uses the other behavior; the mouse send button still queues. Steer delivers at the next available step boundary, without interrupting a running operation.

## Command compression (rtk)

The plugin rewrites eligible commands at the `resolve()` boundary, after environment forwarding, before anything runs:

| Input (`command`) | Resolved output | Reason |
|---|---|---|
| `git status` | `rtk git status` | Simple + whitelisted |
| `cargo build --release` | `rtk cargo build --release` | Simple + whitelisted |
| `git status \| grep x` | `git status \| grep x` | Complex shell — **passthrough** |
| `ls -la` | `ls -la` | Not whitelisted — **passthrough** |
| `git status` (rtk absent) | `git status` | Binary missing — **identity fallback** |

Three independent guards decide (see [`src/rtk-wrap.ts`](src/rtk-wrap.ts)):

1. **Complexity** — any shell metacharacter (`| & ; < > \` $`) disqualifies the command. Wrapping those would silently alter what runs, so they pass through untouched.
2. **Whitelist** — only known dev tools that `rtk` actually implements are eligible (map in `rtk-wrap.ts`).
3. **Availability** — at construction the executor probes `rtk --version` on `PATH` (`resolveRtk()` in `src/index.ts`); if it's absent, command routing is the **identity** transform (environment forwarding still applies).

**Requires:** `rtk` on `PATH` (`rtk --version` exits 0). The plugin does **not** install or manage rtk — install and update it yourself (e.g. `cargo install rtk` or a release binary). `Dockerfile.base` already installs a pinned `rtk` release for the byclaw-harness Docker image, so this only matters for a non-Docker deployment. The set of routed commands is defined by rtk itself; see the [rtk command reference](https://github.com/rtk-ai/rtk#supported-ecosystems). An optional `rtkAvailable: boolean` config field force-enables or force-disables the transform (useful for tests or a non-standard binary path).

## Environment precedence

For every Bash execution, values are merged in this order:

1. Every defined entry in the current DSH host `process.env`.
2. An explicit `ShellExecRequest.env` supplied by an in-process caller.
3. String values under the Redis private-parameter payload's `params` object.
4. The current Redis login Hash, mapped to `BEYOND_TOKEN`, `SSO_TOKEN`, `WHALE_AGENT_AUTHORIZATION`, `USER_CODE`, `USER_ID`, and `USER_NAME`.
5. The current managed `DSH_*` snapshot supplied by `dsh-shell-env`.

Later layers win. Redis runtime values therefore replace matching local or request values, while current managed values such as `DSH_SESSION_ID` still cannot be displaced. Every command, foreground or background, refreshes Redis immediately before execution (the cache is also refreshed at startup and every five seconds). Each refresh gets one connection attempt with a one-second hard deadline and no in-attempt retries. Missing keys are normal empty results; connection/command failures, invalid JSON, and invalid payload shapes are logged without Redis values and retain the last-good cache. If no cache exists, Bash continues with its local and request environment.

The forwarding applies to the model-facing `bash` tool and other calls routed through `ctx.shell`. It does not change persistent terminals, PowerShell, MCP/LSP transports, subagents, or other consumers that call `ctx.subprocess` directly.

### Shared host credentials

The bundle replaces the shipped `credentials` row with `byclaw-credentials`, a subclass of the local credential provider. It reuses the existing Bash Redis reader with its own on-demand refresh and last-good cache. The original Bash reader, timer, and environment injection are unchanged. Native web search and other host plugins can resolve Redis values through `ctx.credentials.resolve(ref)` without running Bash first; no search adapter or additional model tool is installed.

Each reference read refreshes Redis for the current `USER_CODE`, using the same one-second timeout and failure handling. A non-empty Redis value wins over the original local provider's sources. A successful refresh removing or emptying the value restores the local fallback; an outage retains the last good value, or falls back if none was loaded. Search's explicit `apiKey` still takes precedence. This only extends credential resolution, not general environment lookup or search endpoint configuration.

Credential descriptions return only configuration state, source (`redis`), and writability, never secret values. Redis values are available to trusted host plugins but are not published as model-readable tools, copied to global `process.env`, or persisted in credentials/settings files. Redis-backed references are read-only through the credentials UI/API; update them in the user's Redis private parameters. The existing Bash access described below still applies.

Move any custom store path, `dshHome`, or watcher configuration from the `credentials` profile row to `byclaw-credentials`. The inherited file store and credential-record APIs remain available. The native `web-search-deepseek` plugin and its existing profile and persisted settings remain unchanged.

## Security

The default and only mode forwards all host environment variables. Any Agent allowed to run Bash can read, print, write, or transmit every forwarded credential. The DSH sandbox still controls filesystem effects, but this plugin deliberately removes environment-variable isolation from Bash commands.

Use it only in trusted profiles whose host process contains no credential that the Agent must not access. Run DSH with a minimal environment or a dedicated service account when possible.

## Development

```sh
pnpm --filter @byclaw/dsh-bash-provider run test
pnpm --filter @byclaw/dsh-bash-provider run typecheck
pnpm --filter @byclaw/dsh-bash-provider run build
```
