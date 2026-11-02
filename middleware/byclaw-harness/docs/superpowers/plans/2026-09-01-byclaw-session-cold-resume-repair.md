# ByClaw Session Cold-Resume Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task.

**Goal:** Remove ByClaw's unsupported custom DSH session events, persist root-session identity in a dedicated storage domain, provide a safe legacy-log repair path, and surface concrete Agent Teams dispatch/model failures.

**Architecture:** DSH session logs remain exclusively DSH-owned. ByClaw root identity and workspace metadata live in a `byclaw_sessions` storage-domain record keyed by root session ID. Live child agents inherit workspace identity synchronously from their live parent through a process-local registry. Legacy logs are repaired only by adding `ignorable: true` to the two historical ByClaw event records in validated JSONL Zstandard frames. Agent Teams delivery returns a structured result so the scheduler can distinguish dispatch failures from model failures.

**Tech Stack:** TypeScript, Cordis, DeepSeek Harness session/storage APIs, Zod, Node.js, JSONL/Zstandard, pnpm, Vitest-style verification scripts.

**Spec:** `docs/superpowers/specs/2026-09-01-byclaw-session-cold-resume-repair-design.md`

## Global Constraints

- Work against current DSH `master` semantics; never mutate `KNOWN_SESSION_EVENT_TYPES`.
- Do not append non-DSH records to `Session.events`.
- Treat `user/message` context as model projection only, never as persistence.
- Fail activation loudly when the required storage domain is unavailable.
- Preserve unrelated user changes in the dirty checkout.
- Every production change starts with a focused failing test and ends with focused plus package-level verification.

---

## Task 1: Add a typed ByClaw root-session metadata store

**Files:**

- Create: `plugins/byclaw-integration/src/session-metadata.ts`
- Create: `plugins/byclaw-integration/scripts/session-metadata-verify.mjs`
- Modify: `plugins/byclaw-integration/src/index.ts`
- Modify: `plugins/byclaw-integration/package.json`

### Steps

- [x] Add a verification script that imports the compiled module, persists a root record, reloads it, verifies `externalSessionId`, `binding`, `createdAt`, and `cwd`, and verifies that duplicate initialization is idempotent.
- [x] Run the script and confirm it fails because the metadata store does not exist.
- [x] Define the `byclaw_sessions` per-record domain with a Zod schema and a typed immutable repository API.
- [x] Add `storageDomain` as a required plugin injection and wire the store into activation/runtime construction.
- [x] Add the storage-domain and Zod package dependencies, then build and rerun the focused verification script.

## Task 2: Replace custom session events with sidecar metadata and live inheritance

**Files:**

- Modify: `plugins/byclaw-integration/src/session-workspace.ts`
- Modify: `plugins/byclaw-integration/src/session-runtime.ts`
- Modify: `plugins/byclaw-integration/src/template-runtime.ts`
- Modify: `plugins/byclaw-integration/src/index.ts`
- Modify: `plugins/byclaw-integration/scripts/session-context-verify.mjs`
- Modify: `plugins/byclaw-integration/README.md`
- Modify: `plugins/byclaw-integration/README.zh.md`

### Steps

- [x] Rewrite the workspace verification expectations first: no custom event registration or append; root workspace comes from `SessionHeader.cwd`; child workspace comes from a live parent registry; model context projection remains available.
- [x] Run the focused verification and confirm the old implementation fails the new assertions.
- [x] Introduce a process-local session workspace registry with explicit root registration, child inheritance, lookup, and teardown.
- [x] Make root-session open/create persist or load the sidecar record and register its workspace without appending events.
- [x] Make continuable child setup synchronously inherit from the live parent registry; fail with a precise error when no root identity is available.
- [x] Retain read-only folding of the two legacy event types only as a migration/bootstrap compatibility input, never as a writer path.
- [x] Remove the known-event-set mutation and all custom `session.append` calls; update docs and run focused verification plus plugin `verify`.

## Task 3: Add an idempotent legacy session-log repair CLI

**Files:**

- Create: `plugins/byclaw-integration/src/repair-legacy-session.ts`
- Create: `plugins/byclaw-integration/scripts/repair-legacy-session.mjs`
- Create: `plugins/byclaw-integration/scripts/repair-legacy-session-verify.mjs`
- Modify: `plugins/byclaw-integration/package.json`
- Modify: `plugins/byclaw-integration/README.md`
- Modify: `plugins/byclaw-integration/README.zh.md`

### Steps

- [x] Add fixture-driven tests for dry-run, exact marking of only `byclaw/session-workspace` and `byclaw/root-binding` as ignorable, preservation of all records and order, malformed input rejection, backup creation, and second-run idempotency.
- [x] Run the focused test and confirm the repair API/CLI is missing.
- [x] Implement record classification and JSONL transformation as pure functions.
- [x] Implement filesystem repair using non-shell Zstandard encode/decode, a sibling temporary file, validation before replacement, timestamped backup, and atomic rename.
- [x] Expose `--dry-run` by default and require `--apply` for mutation; print the exact file and changed-event counts.
- [x] Rerun focused verification and a real temporary compressed fixture round-trip.

## Task 4: Preserve concrete Agent Teams failure causes

**Files:**

- Modify: `plugins/agent-teams/src/types.ts`
- Modify: `plugins/agent-teams/src/members.ts`
- Modify: `plugins/agent-teams/src/scheduler.ts`
- Modify: `plugins/agent-teams/scripts/stress-verify.mjs`
- Modify: `plugins/agent-teams/scripts/verify.mjs`

### Steps

- [x] Add failing verification cases for a thrown follow-up/dispatch error and a model terminal error, asserting distinct phases and sanitized concrete messages.
- [x] Run the focused scripts and confirm the generic delivery result fails those assertions.
- [x] Change member delivery to return a discriminated success/failure result carrying a normalized error.
- [x] Extend `TaskFailure` with `phase: 'dispatch' | 'model'` and record provider/status/code/message without leaking stack traces or secrets.
- [x] Update scheduler rollback/retry/exhaustion behavior so dispatch failure is stored and returned, while successful attempts clear stale failure through the existing attempt transition.
- [ ] Run Agent Teams build, focused stress verification, and package verification.

## Task 5: Final regression and artifact review

**Files:**

- Review all modified files under `plugins/byclaw-integration/`, `plugins/agent-teams/`, and `docs/superpowers/`.

### Steps

- [ ] Build both plugins and run their full verification scripts.
- [ ] Run the DSH unknown-event persistence regression test against the updated local `master` checkout.
- [ ] Confirm no production path references `KNOWN_SESSION_EVENT_TYPES`, appends either legacy event type, or writes direct persistence records behind `Session`.
- [ ] Inspect `git diff --check`, `git status`, and the focused diff without altering unrelated user changes.
- [ ] Report changed files, verification evidence, migration usage, and any residual operational caveats to the user.
