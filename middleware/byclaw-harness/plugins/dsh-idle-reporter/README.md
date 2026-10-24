# @byclaw/dsh-idle-reporter

[中文](README.zh.md) | English

This DSH profile bundle reports whether its sandbox is doing work. It appends snapshots to one Redis Stream shared by every sandbox; the ByClaw backend (`byclaw-be`) reads the stream and releases sandboxes that report `releasable` once the user's page is idle too. Releasing the sandbox is the platform's job; DSH sessions under `DSH_HOME` survive it.

## What counts as busy

The sandbox is **busy** while any of these holds:

- a live Agent of any session, root or subagent, is running a turn and is not blocked on the user;
- a background job is `running` or `stopping`. A resident dev server started as a job therefore keeps the sandbox alive.

An Agent waiting for an approval or an ask-user answer is not busy, and neither is a parent Agent whose subagent is waiting. Waiting Agents are reported as a count instead. A turn left waiting on the user becomes releasable after the idle timeout; on resume the turn is recorded as interrupted and the pending question is lost, while the session itself survives.

The sandbox is **releasable** when it has not been busy for `idleTimeoutMs`. Idle time starts at process start. Before it reports `releasable`, the plugin briefly checks that no Agent is running idle-status maintenance work such as compaction; if one is, it stays `busy` until the next heartbeat.

## Known limitations

The judgement covers the whole sandbox, not one session: any working Agent or running job in any session keeps it busy. Each case below can only cause a wrong `releasable` when it is the only thing happening in the sandbox for the whole idle timeout.

| Case | Counted as | When it matters |
|---|---|---|
| A parent Agent runs another tool in parallel while its subagent waits for approval | Idle: the parent is treated as blocked on the waiting child | Only if that parallel tool itself runs longer than the idle timeout while the approval stays unanswered. Foreground Bash is capped well below 30 minutes in stock DSH; a long MCP call is the realistic case. |
| A process started outside DSH jobs, e.g. `nohup npm run dev &` from Bash | Idle: DSH cannot see it | Realistic. Once the turn that started it ends and nothing else runs for the idle timeout, the sandbox is reported releasable and the process dies with it. Commands DSH runs in the background itself are jobs and do count as busy. |
| A subagent run by an external provider (Claude Code, Codex, ACP) | Foreground delegation: busy, because the parent waits for its result. Background delegation: idle, because the child is neither in the Agent registry nor a job | Not reachable with the ByClaw image, which configures no external provider; in-process subagents are always visible (background one-shot children are jobs, continuable children are Agents). |

Scheduled work: the ByClaw image loads no in-sandbox scheduler (`@deepseek-ai/dsh-schedule` is not in the `web` profile). ByClaw chat schedules (`byclaw-cron-schedule`) run on the ByClaw server, so releasing a sandbox does not stop them.

## Install

The ByClaw Docker image loads this bundle automatically. Elsewhere, build it and add it to the `web` profile:

```sh
pnpm --dir plugins/dsh-idle-reporter run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-idle-reporter
```

Redis is reached with the same `REDIS_*` environment as `@byclaw/dsh-integration` (standalone or cluster, through `@byclaw/by-framework`). The plugin owns its own connection.

## Configuration

The patch inserts the host row `byclaw-idle-reporter`. Disable it with `disabled: true` on that row.

| Key | Default | Environment in the patch | Meaning |
|---|---|---|---|
| `sandboxId` | `os.hostname()` | `BYAI_WORKER_ID` | Sandbox identity written to every entry |
| `userCode` | empty | `USER_CODE` | Owner of the sandbox written to every entry |
| `streamKey` | `byclaw:dsh:sandbox:activity` | `BYCLAW_DSH_ACTIVITY_STREAM` | Stream shared by all sandboxes |
| `maxLen` | `10000` | — | Approximate stream cap (`MAXLEN ~`) |
| `idleTimeoutMs` | `1800000` (30 min) | `BYCLAW_DSH_IDLE_TIMEOUT_MS` | Idle time before `releasable` |
| `heartbeatMs` | `30000` | — | Interval between snapshot entries |
| `reportSelf` | `true` | `BYCLAW_DSH_IDLE_REPORT_SELF` (`0` disables) | Report this process's own sandbox; off on a shared DSH host, whose user contexts have none |
| `environmentIdleTimeoutMs` | `idleTimeoutMs` | `BYCLAW_TOOL_ENV_IDLE_REPORT_MS` | Idle time before a tool environment is `releasable` |

`byclaw-be` injects `BYAI_WORKER_ID` (`byclaw-dsh-<userCode>`) and `USER_CODE` into every sandbox it launches, so the identity is stable across relaunches of the same user's sandbox; outside ByClaw the identity falls back to the hostname and `userCode` is empty.

Every numeric value must be a positive integer and every string except `userCode` non-empty. An invalid value, or a Redis client that cannot be constructed (for example an invalid `REDIS_MODE`), logs one error and leaves the plugin inert; DSH still starts.

## Tool environments

When `@byclaw/dsh-tool-env` runs the user's commands in separate sandboxes
(`ctx.toolEnvironments`), each started environment gets a reporter of its own.
Its entries carry B's sandbox id (`sandboxId`), `kind: tool-env`, the
environment name and `sandboxType` (the BE spec or image). Busy means: an
Agent bound to that environment runs a turn and is not blocked on the user, or
owns a running job, or the connection has requests or process streams open or
a start under way; the default environment also takes the jobs nobody owns.
The usual idle time applies per environment (`environmentIdleTimeoutMs`). A
released environment (its id gone) stops being reported; a relaunch is a new
identity. The connection's own use is sampled with the heartbeat.

## Stream entries

```text
XADD <streamKey> MAXLEN ~ <maxLen> * \
  sandboxId     <id>
  userCode      owner user code, empty when unknown
  state         busy | releasable
  lastActiveAt  RFC 3339 time the sandbox was last busy
  waitingUser   integer: Agents blocked on approval or ask-user
  agents        integer: Agents doing work (diagnostic)
  jobs          integer: running or stopping jobs (diagnostic)
  pid           integer: DSH process id
  kind          tool-env for a tool environment reported by its DSH host; absent otherwise
  environment   tool environment name (tool-env entries only)
  sandboxType   tool environment spec or image (tool-env entries only)
  at            RFC 3339 time this entry was produced
```

Every entry is a full snapshot. An entry is appended:

- at startup;
- on every state change, including `busy` the moment work starts again after `releasable`;
- every `heartbeatMs`, whatever the state.

At most one append is in flight; while it is pending only the newest snapshot waits behind it. A failed append is logged once per outage and retried by the next heartbeat. Redis being unreachable never stops DSH. On shutdown the plugin stops its timers and appends nothing more.

## Consumer contract

The consumer is `byclaw-be` (consumer group `byclaw_dsh_activity_group`). It keeps the latest entry per `sandboxId` with the time it received it, ignores entries without `userCode`, and for the user's `byclaw-dsh` sandbox:

- releases it when the latest entry is `releasable` **and** the user's page has been idle for the platform idle timeout. An open page counts as work. A window remains between the read and the release in which new work may start; this is accepted because the sandbox has been idle for `idleTimeoutMs` and its sessions survive;
- keeps renewing it while the latest entry is `busy`, even when the page is idle;
- treats a sandbox that has reported before but sent no entry within `4 × heartbeatMs` (120 s by default) as dead and releases it; the next message relaunches it. Silence is the only shutdown signal, so a supervisor restart inside that window is not mistaken for death. Two guards remain on the platform side: a container whose busy heartbeat (`worker:stats:dsh`) still arrives is kept, and a round with too many silent sandboxes is skipped as a whole;
- ignores entries received before the sandbox record was created, so state from a user's previous sandbox never affects a new one. Sandboxes that never report keep the platform's page-only idle rule.

## Verification

```sh
pnpm --dir plugins/dsh-idle-reporter run verify
```

Watch a live stream with `redis-cli XREAD BLOCK 0 STREAMS byclaw:dsh:sandbox:activity '$'`.
