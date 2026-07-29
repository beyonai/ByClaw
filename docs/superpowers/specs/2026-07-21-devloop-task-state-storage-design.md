# Devloop Task State Storage Design

## Goal

Replace the session-scoped task-state layout and the message-derived Devloop phase cache with one globally addressable JSON task-state store. The Devloop task list must support inclusive creation-time filtering and server-side pagination, while both task APIs read lifecycle state produced by `self-developed-rules`.

## Scope

This is a clean v2 implementation. It does not read, migrate, or write any of the following legacy sources:

- `/by/.session/{sessionId}/.acp-runs/`
- `byai_session_ext.task_status`
- `byai_session_ext.task_phase`
- `[PHASE]` markers in chat messages
- LLM-derived phase snapshots

The relational `byai_session` record remains the source for task identity, project membership, ownership, title, and creation time. JSON task state is the only source for lifecycle status, stage progress, current activity, LOOP counts, pause information, and verification state.

## Storage Architecture

All new task state uses this logical shared-space root:

```text
/by/.acp-runs/
├── runs/
│   └── {traceId}/
│       ├── state.json
│       ├── artifacts/
│       └── evidence/
├── sessions/
│   └── {sessionId}.json
└── board/
    ├── pending/{traceId}.json
    ├── in_progress/{traceId}.json
    ├── paused/{traceId}.json
    └── completed/{traceId}.json
```

### Authoritative state

`runs/{traceId}/state.json` is the only authoritative lifecycle document. A trace owns its artifacts and evidence under the same run directory. Lifecycle transitions continue to use `pending`, `in_progress`, `paused`, and `completed`; `completed` remains terminal.

### Session projection

`sessions/{sessionId}.json` is the direct lookup projection for the newest trace belonging to a session. It contains the complete read model needed by the two Devloop APIs: identity, revision, localized status, current stage, overall progress, LOOP counts, all stages, timestamps, and the authoritative state path.

When a completed session receives a new task lifecycle, initialization creates a new trace and replaces the session projection. An older trace may continue to preserve its own authoritative state, but it must not overwrite a session projection whose `created_at` is newer.

### Board projection

Each trace has exactly one compact board card under `board/{status}`. A lifecycle transition atomically writes the target card and removes cards for the same trace from the other status directories.

### Write and validation order

Every initialization, checkpoint, transition, repair, or reconcile operation performs these actions:

1. Validate the candidate authoritative state.
2. Atomically write `runs/{traceId}/state.json` using a temporary file, `fsync`, and rename.
3. Atomically update `sessions/{sessionId}.json` when the trace is the session's newest lifecycle.
4. Atomically write the current board card and remove stale status cards.
5. Validate that state, session projection, and board card agree on `schema_version`, `session_id`, `trace_id`, `revision`, and lifecycle status.

The schema version becomes `2.0.0`. The state helper must never create the legacy `state/`, top-level status, `artifacts/`, or `evidence/` directories.

## Skill Contract Changes

`self-developed-rules` will require the logical root `/by/.acp-runs/`. Initialization still requires a real runtime `session_id`, one stable `trace_id`, localized task metadata, an owner, a workflow, and ordered stages.

References, schemas, helper commands, and tests will be updated together. Artifact and evidence paths become trace-relative paths under:

```text
runs/{traceId}/artifacts/
runs/{traceId}/evidence/
```

The worker-loop and lifecycle semantics do not change. Only persistence paths and query projections change.

## Backend Design

### State reader

A focused `DevloopTaskStateReader` will load `/by/.acp-runs/sessions/{sessionId}.json` through `UserFS` in the task creator's user context. It will validate:

- the JSON schema version is `2.0.0`;
- the projected `session_id` equals the requested session;
- required lifecycle and stage fields exist;
- revisions and numeric progress values are valid.

Missing state returns a typed “task state not initialized” result. Invalid JSON, identity mismatches, or storage failures return explicit errors and are logged. There is no legacy fallback.

### Task phases endpoint

`POST /byaiService/devloop/task/phases` keeps `sessionId` as its request key but returns a new `DevloopTaskStateDto` rather than the fixed seven-phase `PhaseSnapshot`.

The response includes:

- `sessionId`, `traceId`, and `revision`;
- `status` and localized `statusLabel`;
- `currentStage` and overall `progress`;
- `loopCount` and `stageLoopCount`;
- ordered `stages`;
- transitions and pause details;
- creation and update timestamps.

The endpoint verifies that the database session exists before resolving its owner and reading the projection.

### Task list endpoint

`POST /byaiService/devloop/task/list` accepts a typed request:

```json
{
  "projectId": 1001,
  "createTimeStart": "2026-07-01 00:00:00",
  "createTimeEnd": "2026-07-31 23:59:59",
  "pageNum": 1,
  "pageSize": 20
}
```

Rules:

- `projectId` is required.
- `pageNum` defaults to `1`.
- `pageSize` defaults to `20` and is limited to `100`.
- Both time boundaries are inclusive.
- Results use stable `createTime DESC, sessionId DESC` ordering.

The database performs project filtering, creation-time filtering, counting, ordering, and pagination. The service then reads state projections only for sessions on the selected page. This bounds filesystem work to at most `pageSize` projections.

The response is `PageInfo<DevloopTaskViewDto>`. Each item includes database task metadata plus `stateAvailable`, `traceId`, lifecycle status, current stage, progress, and LOOP counts. A task whose projection has not yet been initialized returns `stateAvailable=false` and null lifecycle fields; it is not presented as `pending`.

## Frontend Design

The Devloop service layer will define request, page, task view, and task-state types. `listTasks` will accept the complete query object, while `getTaskPhases` will return the generic state-machine response.

The task tab will add an Ant Design creation-time range filter and controlled server pagination. Changing the time range resets the page to one. The header uses the response `total`, not the current page length. The task view and detail drawer operate on the current filtered page.

The detail drawer will render ordered dynamic stages and show stage name, lifecycle status, stage progress, LOOP count, current activity, and result summary. UI status handling is standardized on `pending`, `in_progress`, `paused`, and `completed`. When `stateAvailable=false`, the UI displays “任务状态尚未初始化”.

## Removed Runtime Paths

The Devloop API flow will stop using `DevloopPhaseService`, `loadTaskPhaseMap`, `persistPhaseSnapshot`, and `TASK_PHASE_EXT_CODE`. The task-start prompt will no longer request `[PHASE]` markers because those markers are not part of the new state source.

Code that becomes unreferenced will be removed only after reference checks confirm it has no other callers.

## Error Handling

- Invalid request values return a failed response with a localized validation message.
- `createTimeStart > createTimeEnd` is rejected.
- A missing database session fails the detail request.
- A missing state projection produces the explicit uninitialized state described above.
- Corrupt or mismatched state fails the detail request and marks the corresponding list row unavailable without failing unrelated rows.
- One user's storage failure cannot prevent other rows on the page from being returned.

## Verification

### Skill

- New root and directory contract tests.
- Initialization creates authoritative, session, and board documents.
- Checkpoint and transition keep all projections at the same revision.
- Older traces cannot replace newer session projections.
- Reconcile repairs missing or duplicate board projections.
- Validation rejects untracked artifacts, identity mismatches, and projection drift.
- Tests assert that new writes do not create the legacy layout.

### Backend

- State projection parsing and identity validation.
- Missing and malformed state behavior.
- Inclusive time boundaries.
- page defaults, maximum page size, totals, and stable ordering.
- Only current-page sessions trigger state reads.
- A failed row-level state read does not fail the full page.

### Frontend

- Service request and response contracts.
- Range changes reset pagination.
- Page changes preserve the active range.
- Dynamic stages and LOOP counts render correctly.
- Uninitialized state is displayed explicitly.

### Commands

Run the skill unit and contract tests, backend Maven verification for the changed module, and frontend unit tests plus the repository's non-mutating lint checks and build.

## Acceptance Criteria

- New traces write only under `/by/.acp-runs/`.
- A session state is retrievable directly from `sessions/{sessionId}.json`.
- Both Devloop task APIs use the v2 state projection as their only lifecycle source.
- Task list creation-time filtering and server pagination are correct and stable.
- The frontend renders dynamic state-machine stages without fixed seven-phase assumptions.
- Skill, backend, and frontend verification passes.
