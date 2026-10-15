# ByClaw Session Cold-Resume Repair Design

## Status

Approved for implementation on 2026-09-01.

## Problem

`@byclaw/dsh-integration` appends `byclaw/session-workspace` and `byclaw/root-binding` events to DSH sessions. These out-of-repository event names are absent from the DSH-generated `KNOWN_SESSION_EVENT_TYPES`, while `Session.append()` on DSH `master` cannot set the `SessionEvent.ignorable` envelope marker. A persisted session containing either event can therefore be rejected by `PersistenceCoordinator.assertEventsSupported()` during cold load, which makes continuable AgentTeams members unavailable to `subagents.followup()`.

The current runtime mutation of `KNOWN_SESSION_EVENT_TYPES` is unsupported. DSH explicitly rejects event-name registration as a compatibility mechanism because it cannot classify omission safety and makes reads depend on the mounted composition.

## Goals

- Stop writing out-of-repository ByClaw events into DSH session logs.
- Keep root Agent identity binding durable across process restarts.
- Preserve the authoritative workspace and external-session context for roots and descendants.
- Recover already-written JSONL+zstd session logs without deleting events or breaking sequence continuity.
- Preserve the concrete cold-resume failure on AgentTeams tasks instead of replacing it with only an attempt count.
- Verify the real append, persistence, restart, and cold-followup path.

## Non-goals

- Do not modify the upstream `deepseek-harness` repository.
- Do not add a downstream event-name registration mechanism.
- Do not bypass `Session.append()` or write directly through `sessionPersistence.append()` for live sessions.
- Do not mark arbitrary `byclaw/*` events ignorable.
- Do not parse model-visible message text as the authoritative root identity binding.

## Architecture

### Durable root metadata sidecar

Add a `byclaw_sessions` DSH storage domain with `per-record` layout. The shipped DSH `master` base composition already mounts the JSON storage backend and `storage-domain` facility.

Each root-session record is keyed by the DSH `SessionId` and contains:

```ts
interface ByClawRootSessionRecord {
  readonly identity: {
    readonly createdAt: number
    readonly cwd?: string
  }
  readonly externalSessionId: string
  readonly binding: ByClawRootBinding
}
```

`identity` prevents a stale sidecar row from being applied to a newly-created lifecycle that reused the same session id. A create operation replaces a stale row only for a confirmed new DSH session. Reuse and resume require an identity match and reject a different binding.

The integration plugin adds `storageDomain` to its required injections, opens the domain during activation, and closes it through a Cordis effect. Domain-open failure disables the ByClaw integration through the existing startup failure path; it must not silently fall back to unsafe session events.

### Workspace resolution

`SessionHeader.cwd` is the authoritative project directory. Root DSH session ids already equal ByClaw external root session ids, so a root workspace is derived from `session.id` and `session.header.cwd`.

A continuable child inherits the resolved workspace from its live parent during synchronous `registerContinuableSetup()`. Cold followup already requires the exact live parent Agent, so the parent workspace is available when the child is materialized. Nested descendants repeat the same inheritance. A process-local map associates each live Agent/session with its resolved ByClaw workspace; it is reconstructed from the durable root record and parent lineage on every process start.

The existing plugin-sourced `user/message` remains a model-visible projection of the resolved workspace. Its marker prevents duplicate projection, but no runtime security or routing decision parses that text.

### Legacy compatibility

The plugin retains read-only folds for the two legacy events during the migration window. After a repaired legacy root can be loaded, an absent sidecar record may be bootstrapped from the exact legacy workspace and root-binding events, then all later reads use the sidecar.

Legacy event folds must never authorize a binding transition: conflicting or incomplete legacy state fails loud.

## Stored-log repair

Provide an idempotent migration CLI for DSH JSONL+zstd artifacts. It performs these operations:

1. Decode every zstd frame and validate the complete JSONL stream.
2. Add `ignorable: true` only to `byclaw/session-workspace` and `byclaw/root-binding` events that do not already carry it.
3. Preserve every event, payload, sequence number, timestamp, and header byte-equivalent JSON value.
4. Write a sibling temporary artifact as two valid zstd frames: header line, then event lines.
5. Re-read and validate the temporary artifact.
6. Preserve a recoverable backup and atomically replace the original artifact.
7. Report scanned, changed, skipped, and failed artifact counts; a second run makes no changes.

The Docker/runtime rollout runs this migration against the configured persistent DSH home before the updated plugin attempts to resume affected sessions. A dry-run mode is mandatory.

## AgentTeams failure propagation

Replace the boolean-only delivery result with a discriminated result:

```ts
type MemberDeliveryResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: TaskFailure }
```

Generalize `TaskFailure` with `phase: 'dispatch' | 'model'`, make provider/status conditional on model failures, and retain a bounded, sanitized message. The scheduler records the latest dispatch failure before rolling back its exact attempt. When `maxTaskAttempts` is reached, the terminal task output contains both the attempt count and the last failure code/message.

Mailbox fallback behavior remains unchanged. The message tool may still report mailbox delivery after a followup failure, while task dispatch persists the failure for automatic recovery diagnostics.

## Test Strategy

### Integration plugin

- Root metadata create, same-binding reuse, same-binding resume, conflicting binding rejection, and stale lifecycle replacement.
- Root workspace derives from `SessionHeader`; child and nested child inherit from their live parents.
- Model-visible context is emitted once and is not parsed as authoritative state.
- No new `byclaw/session-workspace` or `byclaw/root-binding` event is appended.
- A repaired legacy log bootstraps the sidecar exactly once.
- A real DSH JSONL persistence test performs create, flush, context disposal, fresh-context prepare/resume, and verifies cold load succeeds.

### Migration CLI

- Unknown unrelated `byclaw/*` events remain untouched.
- Only the two audited event names receive `ignorable: true`.
- Sequence numbers and payloads remain identical.
- Dry-run performs no write.
- Re-running is a no-op.
- Corrupt input leaves the original untouched and reports failure.

### AgentTeams

- Injected `NOT_RESUMABLE` delivery failures are retained through retry rollback.
- The third failed attempt produces a terminal task with the concrete last error.
- Successful retry clears stale failure state.
- Existing mailbox fallback, model-failure, controlled workflow, lifecycle, and stress verification remain green.

## Rollout

1. Ship the migration CLI and updated integration/AgentTeams packages together.
2. Stop the running DSH process so no session log can be appended during migration.
3. Run migration dry-run, review counts, then run apply mode with backups.
4. Start the updated DSH master image and plugin packages.
5. Verify one repaired member with `prepare()`, then cold-followup and task completion.
6. Create a new team and verify a fresh member survives a process restart.
7. Retain backups until the new-image verification window completes.

## Acceptance Criteria

- A newly-created ByClaw root or AgentTeams member writes no out-of-repository ByClaw session events.
- Root binding remains immutable across DSH process restarts.
- Workspace context remains correct for root, child, and nested child Agents.
- Repaired legacy sessions load on current `origin/master` without runtime mutation of `KNOWN_SESSION_EVENT_TYPES`.
- An unavailable member leaves an actionable failure on its task after bounded retries.
- Focused plugin tests, package typechecks/builds, and existing verification scripts pass.
