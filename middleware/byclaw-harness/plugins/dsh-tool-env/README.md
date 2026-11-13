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
- **Idle:** after `BYCLAW_TOOL_ENV_IDLE_MS` (default 5 min) without operations
  or open streams, the SSH connection is detached. For `byclaw-be`, real turns hold separate Platform leases and their final return starts the shared idle deadline. Actorless IO/streams hold temporary leases until 5 seconds after completion. OpenSandbox pauses on the connection timer.
- **Gone:** a deleted or expired B is recreated on the next lease. The workspace
  is a host volume shared with A, so pausing or recreating B loses no files; only
  B's own root filesystem (e.g. ad-hoc installs) is lost on recreation.
- **Expiry (`opensandbox`):** A renews B's OpenSandbox expiry while it uses B. A B whose A
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

## When B starts

Only a tool call starts B. A context's boot (resource projection, Skill views,
media projections) and the start of a turn (the session directory) do not: the
connection facade (`ctx.ssh`) exposes `connected` and `whenConnected(key, op)`,
and the integration plugin hands B-bound writes and directory creation to it,
so they run once B connects for a tool, before that tool runs. Reads of the
user tree while B is down come from what this host last read or wrote there
and are `ENOENT` otherwise, so a model-only answer never waits for a sandbox.
Before the model runs, a turn also resolves its session directory and probes
for files (git roots, session Skills). While B is down the facade answers
those itself: path resolution only normalizes, queued directories are empty
directories with nothing inside, `.git` and instruction-file probes
(`AGENTS.md`, `CLAUDE.md` and their `.local` variants along the session
directory's ancestors) are absent, DSH's own homes (`DSH_HOME`,
`DSH_AGENTS_HOME`) hold nothing, Skill roots list as empty, and `executable`
lookups resolve on this host (same image build). What tools do (stat, list,
read, write of real paths; processes) still goes to B and starts it. The
trade-off: until a session's first tool call, its prompt sees no
session-local Skills and no instruction files from the user tree.
Directories this host created on B (session directories) are created once per
context and, connected or not, their resolve/stat probes are answered here: B's
volume outlives B, so they stay directories. A directory removed on B behind the
host's back is therefore not recreated until the context restarts.
After a failed launch the `byclaw-be` backend waits before trying again
(1 s, doubling to 30 s) and reports the cause instead of calling BE on every
operation.

## Backends

| `BYCLAW_DSH_TOOL_ENV` | Who creates B | Idle pause | Where the keys come from |
|---|---|---|---|
| `static` | nobody: a fixed sshd (development, tests) | no | start sshd with them |
| `opensandbox` | A, through the OpenSandbox API with a key held in A | yes | B's create request |
| `byclaw-be` | Platform through authenticated BE lease ingress | return leases; reclaim after shared idle deadline | A's state directory, mounted into B; or the user's BE private parameters (`publishKeys`) |

### `byclaw-be`

A calls `POST /sandbox/toolLease/acquire` as the user for `serviceKey` (default
`byclaw-dsh-tools`). Platform coordinates get-or-create and the lease under the
same user lock, then returns the existing launch coordinates plus an opaque
lease ID/token. Initial lock contention/transport failures retry with the same holder/session identity within the bounded launch window. It never uses a separate uncoordinated launch after acquisition.
`renew` and `release` require that exact token. Renewals run only while a real
session/operation still holds the lease. Transient renewal failures retry within the last confirmed expiry; a definitive rejection or the local expiry watchdog invalidates SSH. A late HTTP success cannot revive an expired local lease. An unreachable endpoint does not authorize deleting
another session's compute.

Real `agent/status=running` events record active session IDs without starting B.
The first actual tool IO acquires only its own session lease, carried through tools/execute using per-backend AsyncLocalStorage. Unattributed provider IO gets a transient operation lease. Turn-stopping, idle
(cancellation/failure) and agent disposal return only that session's tokens after
its in-flight IO finishes. Catalog acquisitions also hold independent remote
leases per actor/acquisition. With no session, a request/stream gets a transient
operation lease, returned 5 seconds after its final operation/stream closes, so a
turn's preparation (session directory, working-directory and Skill checks) shares
one lease instead of acquiring and returning one around every request. Merely opening
history, refreshing the catalog or booting a user context acquires no lease.

The last returned or expired lease starts Platform's idle countdown, default
300 seconds. `BYCLAW_TOOL_ENV_IDLE_MS=300000` configures it through the per-user
plugin configuration (bounded 1..86400 seconds). Platform's lease TTL (90 seconds,
renew every30 seconds) bounds crashed or killed Harness processes before idle
reclamation. The plugin's SSH idle timer is not a second physical-retention
period. `sandbox_release` defaults to returning the caller's lease (`destroy:false`),
so the last lease return starts the configured idle countdown. Only an explicit
user request to immediately destroy compute allows `destroy:true`; Platform still
protects leases held by every other process/session.
Context disposal returns all tokens owned by that context. Platform handles
shared-context cascade, exact-instance fencing and retrying provider deletion.
Deploy coordinated BE/Platform endpoints before this plugin; production does
not silently fall back to the old manual-release launch path.

SSH keys are shared per user/service under persistent
`stateDir/identities/<service-key-sha256>/keys-v1`, atomically published as one
complete key bundle across Harness processes. Default and market `general`
backends reuse the same service identity. Client config, ingress credentials and
host-key pins remain per connection alias. Do not share a state directory between
users. Deploying this key layout requires draining existing tool allocations
before the new shared host starts; retain pinned host-key verification.

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

When A cannot share a volume with B (a shared DSH host outside the sandbox
cluster), set `BYCLAW_TOOL_ENV_BE_PUBLISH_KEYS=1` instead of the key mount.
Before each launch A stores its authorized key and B's host key as the user's
private parameters (`POST /userPrivateParam/save`, keys
`BYCLAW_TOOL_ENV_AUTHORIZED_KEY` and `BYCLAW_TOOL_ENV_HOST_KEY`, the host key
base64-encoded as B's sshd script expects), skipping values already there.
The B spec forwards them with the spec's private-parameter placeholders and
needs no key volume:

```json
  "env": {
    "BYCLAW_TOOL_ENV_PORT": "22",
    "BYCLAW_TOOL_ENV_AUTHORIZED_KEY": "${envVars.BYCLAW_TOOL_ENV_AUTHORIZED_KEY}",
    "BYCLAW_TOOL_ENV_HOST_KEY": "${envVars.BYCLAW_TOOL_ENV_HOST_KEY}"
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
| `BYCLAW_TOOL_ENV_BE_PUBLISH_KEYS` | `byclaw-be`: `1` stores the keys as the user's BE private parameters before each launch, for B specs that take them from `${envVars.…}` instead of a key mount |
| `BYCLAW_TOOL_ENV_READY_TIMEOUT_MS`, `BYCLAW_TOOL_ENV_BE_REQUEST_TIMEOUT_MS` | `byclaw-be`: sshd readiness and BE request deadlines (default 180000) |
| `USER_CODE`, `BEYOND_TOKEN` | `byclaw-be`: the user and token BE injected into A; reused as-is |
| `BYCLAW_TOOL_ENV_IDLE_MS` | idle timeout in ms (default300000); `0` disables only SSH detachment, not Platform lease reclamation |
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
- The shared DSH host (`scripts/byclaw-multi-host.mjs`) configures the
  `opensandbox` backend per user context unless `BYCLAW_DSH_TOOL_ENV=byclaw-be`
  is set on the host; then each context uses the `BEYOND_TOKEN` BE passed in
  its PUT, and `BYCLAW_TOOL_ENV_BE_PUBLISH_KEYS=1` hands B the keys when the
  host cannot mount the user's volume.

## ByClaw BE lifecycle

The backend acquires nothing before real IO. Session events are local bookkeeping;
ordinary file-provider reads, subprocesses, PTC and terminal streams share the
same scoped lease policy. Graceful context shutdown returns its tokens and crash
TTL covers ungraceful loss. Multiple sessions and Harness processes share the
user-global service instance without releasing each other's leases. Shared
managed contexts send `parentSandboxId`, `parentContextId` and
`parentContextGeneration` directly from their immutable host request, never from
mutable process-global user environment. Platform rejects stale acquire/renew
and cascades context removal to the user's tool sandboxes.

## Building B's image

B runs the user's commands, so it needs A's toolchain: system packages,
Python and Node CLIs, the builtin skills. `middleware/byclaw-harness/Dockerfile.tools`
therefore starts from the harness (A) image and removes only what A's runtime
alone uses: A's DSH installation except the SSH helper closure
(`docker/collect-closure.sh` traces it with Node's own resolver inside A), the
Playwright browser, and build caches; the result is flattened into one layer.
A's image environment is recorded in `/etc/byclaw-tool-env.session-env`, and
B's sshd hands it (plus B's own spec env) to every session, so commands see the
same `PATH` and `BYCLAW_*` settings as on A. A checks the helper and bootstrap
by digest, so B is built from the very A image it serves, right after it:

```sh
docker build -f middleware/byclaw-harness/Dockerfile -t byclaw/dsh:<tag> .
docker build -f middleware/byclaw-harness/Dockerfile.tools --build-arg HARNESS_IMAGE=byclaw/dsh:<tag> -t byclaw/dsh-tools:<tag> .
```

The A image itself also serves as B (`byclaw-dsh-entrypoint tools`); the
separate image only saves the pull.

## Tests

`pnpm test` covers the OpenSandbox lifecycle and the ByClaw BE launch, fallback
and relaunch flows against fake servers, the SSH identity files, environment
scrubbing and the profile patch staying inert by default. `tests/fixtures/split-driver.ts` boots the real SSH provider
composition through this service against a live sshd. It checks files,
processes, PTY, PTC and sandbox confinement, plus a reconnect after B restarts.

### Desktop instance references

The ByClaw BE adapter retains optional `instanceContext` from the actual allocation
response or an exact-ID directory lookup. The snapshot stays on the execution
lease and is omitted from model-visible acquisition output. Capability-specific
bindings take precedence over an explicit `default`; arbitrary shell argv and
stdout never select a desktop. For an allocation without a context, the adapter
retains the legacy `vnc`/`desktop` endpoint convention using only that allocation's
exact ID and mapping. The browser binding is only `vnc`; `desktop` alone is not a
browser target. An exact-ID directory fallback must also match the mapping.
Explicit empty bindings and malformed contexts never fall back to endpoint names.
Missing identity leaves execution usable and emits no guessed target.

Supported tool definitions advertise `byclawInstanceRefsVersion: 1` to the host
presenter. Each invocation emits the Cordis `byclaw/tool-instance-refs` notification,
using the real call ID and the precise native/PTC call-start sequence captured
at invocation start, first with `[]`, then with trusted references before long
execution. This notification is never appended to the DSH session log: the SDK
rejects unknown required event types when reopening stored sessions.
ByClaw integration persists references in its existing `byclaw_sessions` domain,
scoped by session identity, lifecycle creation time, call ID and `sourceCallSeq`.
References form a stable union; later empty arrays do not erase known targets.
Old calls without metadata retain the absent field. The 3015 projection carries
`instanceRefs` only on the AnswerDelta root, and late metadata preserves the
exact call's success/error without attaching to a later turn that reuses its ID.

`sandbox_exec` accepts an optional `opts: { show_desktop: {} }` for commands that open
a visible window for the user. The launcher must verify the window on the
sandbox display before returning exit code 0. The chat UI uses the explicit
request, the successful command result and the authorized instance references
to decide whether to expand the desktop.

Browser adapters only read the explicit `browser.automation` binding; reporting
never accesses the allocating SSH `ready` getter. Before execution they report
only `[]`, so a cached identity cannot attach an old allocation to a new open.
They report targets after a real browser open (including a first `runGoal`) or
when the controller confirms an existing browser session. Only those confirmed
invocations report again in `finally`. Unopened close and failed open never use
an unrelated cached provider target. Display observers cannot block close/control
operations or replace the controller's actual errors.

Set `BYCLAW_INSTANCE_REFS_ENABLED=false` on the Harness process to stop new tool
reference production and definition markers without disabling tool execution.
The integration reader continues to accept previously persisted references.
Only a browser configured with `workspaceOnToolEnvironment` uses the SSH
provider's binding and advertises reference support before cold allocation.
A local browser leaves references absent, preserving the existing frontend
viewer lookup, even if an unrelated SSH provider is available in the same context.

### Forwarding B's own environment

Tool SSH sessions explicitly forward B's own environment by default, including
credential-shaped business variables such as `REDIS_PASSWORD`. Configure
`BYCLAW_TOOL_ENV_FORWARD_ENVIRONMENT` in **B's spec env** as `all` (default),
`{"allow":["REDIS_PASSWORD","BUSINESS_API_TOKEN"]}`, or `{"allow":[]}`. Invalid
policies stop startup without logging the supplied value.

Request env overrides B's forwarded values, including empty strings and null
unset markers (without refilling them from B during assembly). The allowlist selects the explicit B overlay, not the ordinary
system environment inherited by DSH, and does not restrict explicit business
request entries. Internal `BYCLAW_(DSH_)TOOL_ENV*`, browser secret/listen-FD
variables, and MicroVM/command payloads are excluded even when allowlisted or
supplied by a request. A's host-credential filtering remains unchanged.

The pinned helper build patch covers the shared ordinary/terminal environment
assembly and keeps workspace/profile copies aligned for digest verification.
Run `node --test middleware/byclaw-harness/scripts/tool-helper-env.test.mjs`
from the repository root. Image builds and live SSH still require validation.

## Preparation and tool failures

Tool execution errors become native failed tool results. Remote preparation
failures also reach the model as required runtime context, allowing ordinary
chat to continue without claiming that unavailable files were read. Reasons
are redacted; successful later preparation supersedes the previous failure
notice. Cancellation and unrelated plugin errors retain their original behavior.

Preparation recovery decorates only the callbacks returned by native Cordis
`events.dispatch` for `system-prompt/assemble`. Native filtering, binding,
ordering and listener snapshots remain authoritative. A failed contributor
continues its remaining chain, or preserves the completed downstream result if
it already called `next()`. No contributor or terminal continuation is replayed,
and no old prompt snapshot is reused. Errors caught locally by a preparation
provider are observed at the SSH boundary as well. The adapter is removed on
plugin unload; SDK upgrades must rerun the dispatch contract tests.

Nested provider `AggregateError` wrappers are recoverable only when every child
and explicit cause traces to the tool environment. Mixed policy/configuration
failures, empty aggregates and cycles still propagate. Aggregate diagnostics
include redacted child reasons. Successful preparation reads retain their
context when lease release fails, with `TOOL_ENV_LEASE_RELEASE_FAILED` sent to
the model as required runtime context. Reads are not replayed or mislabeled as
failed; later warning-free preparation supersedes the old warning.

Redacted remote application errors retain their `RemoteOperationError` type and
code. Repeated wrapping and lease-release diagnostics preserve the original
classification instead of relabeling application timeouts as connection failures.

Stream establishment failures include both the connection and lease-release
errors. Close releases run once and retain their original diagnostic scope.
Preparation/tool boundaries await releases for destroyed/closed streams or
already-started releases; live streams do not block a result. Close warnings do
not imply that the remote operation succeeded. Release failures arriving after
a result are queued to the owning agent through native `agent.inject` for a
later model request, without waking idle chat or replaying tools. Already-sent
requests and returned tool results are not changed. Cancellation/disposal can
discard pending injected context; warnings remain logged.

## Unavailable lifecycle checks

Remote discovery in `agent/pre-step` and checks in `agent/turn-stopping` can also
access the tool sandbox (for example, iron-rule discovery reads `.git` after a
file update). These boundaries recover only proven tool-environment transport
failures. Authority, authentication, actual rule violations, mixed aggregates,
and unrelated plugin errors keep their existing behavior. Native listener
filtering, order, snapshots, downstream admission rejection, role guards, and
sandbox routing remain in force; remaining stop listeners still execute.

`TOOL_ENV_CHECK_INCOMPLETE` explicitly reports unverified checks with redacted
reasons. Pre-step notices reach the current model request. Stop notices are
appended as durable session context, available to the existing UI projection and
the next normal model request. No inject/steer is issued during stopping, so a
notice does not force another model step or replay checks/tools. Transport loss
alone no longer changes an answered turn into a failed turn. Existing connection
timeouts and cancellation behavior remain unchanged. Regression tests use the
real iron-rule hook with simulated writes, connection loss, ordinary rule
violations, follow-up chat, and policy rejection; live deployment remains a
separate verification step.

Connection waits retain the existing timeouts. Local tests cover real SSH
filesystem/working-directory provider composition, routing and role policies,
complete prompts, suppressed optional context, cancellation and agent isolation.
They do not replace live container, SSH or model-channel validation.
