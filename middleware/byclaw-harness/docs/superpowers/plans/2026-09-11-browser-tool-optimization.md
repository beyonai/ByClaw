# Browser Tool Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close BRW-01 through BRW-12, add status/focus/waitFor/batched act, enforce one claimed context per session, and run Chromium under the same Unix account as DSH.

**Architecture:** Promote browser ownership from turn to Agent session, carry structured errors and explicit session state across the broker, and keep artifacts on the browserd filesystem instead of in broker frames. Extend the existing driver/runtime/controller layers without weakening policy gates.

**Tech Stack:** TypeScript 5.9, Node.js, Playwright Core 1.62, Vitest 4, Python 3 supervisor checks, Docker.

**Spec:** `docs/superpowers/specs/2026-09-11-browser-tool-optimization-design.md`

## Global Constraints

- Preserve domain allowlisting, all three submit gates, popup rejection, per-Agent Context isolation, bounded queues, and private broker credentials.
- Default session idle TTL is exactly `900000` milliseconds.
- All runtime processes use Unix account `byclaw`; broker and artifacts remain private to that account.
- Do not add network logs, tab management, cookie persistence, evaluate, recipes, or upload operations.
- Key claims and lanes by `sessionId`; only the claiming Agent may operate the session context.
- noVNC selection resolves the caller's session internally and never accepts model-provided session/lease credentials.

---

### Task 1: Session identity, lifecycle, and status

**Files:**
- Modify: `plugins/dsh-browser-use/src/turn-identity.ts`
- Modify: `plugins/dsh-browser-use/src/lease-manager.ts`
- Modify: `plugins/dsh-browser-use/src/browser-session-controller.ts`
- Modify: `plugins/dsh-browser-use/src/index.ts`
- Modify: `plugins/dsh-browser-use/src/protocol.ts`
- Test: `plugins/dsh-browser-use/tests/turn-identity.spec.ts`
- Test: `plugins/dsh-browser-use/tests/lease-manager.spec.ts`
- Test: `plugins/dsh-browser-use/tests/tool.spec.ts`

**Interfaces:**
- Produces: session owner identity `(agentId, sessionId)`, session status payload, terminal reason, `status` operation.
- Consumes: existing DSH Agent/session lifecycle events and lease cleanup callback.

- [ ] Add failing tests proving a later turn reuses the same lease, turn events do not close it, status reports remaining TTL/current page, and idle expiry returns `browser-session-expired` with `idle-timeout`.
- [ ] Run `pnpm vitest run tests/turn-identity.spec.ts tests/lease-manager.spec.ts tests/tool.spec.ts` and confirm the new assertions fail for turn-keyed ownership/current cleanup.
- [ ] Implement session-keyed ownership, terminal-state bookkeeping, default 15-minute TTL, and status serialization; retain explicit/Agent/session/disconnect/dispose cleanup.
- [ ] Re-run the focused tests and keep existing isolation/queue/cleanup tests green.

### Task 2: Structured error isolation

**Files:**
- Modify: `plugins/dsh-browser-use/src/protocol.ts`
- Modify: `plugins/dsh-browser-use/src/broker-client.ts`
- Modify: `plugins/dsh-browser-use/src/browser-runtime.ts`
- Modify: `plugins/dsh-browser-use/src/browserd.ts`
- Modify: `plugins/dsh-browser-use/src/browser-session-controller.ts`
- Test: `plugins/dsh-browser-use/tests/broker-client.spec.ts`
- Test: `plugins/dsh-browser-use/tests/browser-runtime.spec.ts`
- Test: `plugins/dsh-browser-use/tests/browserd.e2e.spec.ts`
- Test: `plugins/dsh-browser-use/tests/tool.spec.ts`

**Interfaces:**
- Produces: bounded broker error metadata `{code, detail?, fatal?, recoverable?}` and controller-visible session survival.
- Consumes: Playwright errors and existing `BrowserRuntimeError` codes.

- [ ] Add failing tests showing element-not-found/disabled/visibility/timeout/local-submit errors preserve a session while broker disconnect, runtime disposal, and fatal policy violations close it.
- [ ] Run the four focused test files and confirm failures expose current blanket cleanup and coarse broker mapping.
- [ ] Add one error classifier, sanitized detail mapping, broker transport preservation, and controller release rules based on fatality instead of any exception.
- [ ] Re-run focused tests and mutation-check wrong classifications by confirming at least one survival/closure assertion fails when each branch is inverted.

### Task 3: Observations, readiness, stale indexes, and real change detection

**Files:**
- Modify: `plugins/dsh-browser-use/src/protocol.ts`
- Modify: `plugins/dsh-browser-use/src/browser-runtime.ts`
- Modify: `plugins/dsh-browser-use/src/browserd.ts`
- Modify: `plugins/dsh-browser-use/src/browser-session-controller.ts`
- Modify: `plugins/dsh-browser-use/src/index.ts`
- Test: `plugins/dsh-browser-use/tests/browser-runtime.spec.ts`
- Test: `plugins/dsh-browser-use/tests/browserd.e2e.spec.ts`
- Test: `plugins/dsh-browser-use/tests/tool.spec.ts`

**Interfaces:**
- Produces: `ready`, `elementCount`, `observationId`, extended element state, optional action observation guard, accurate `changed`.
- Consumes: driver readiness wait and page-state fingerprint.

- [ ] Add failing tests for textarea accessible names, checkbox/radio/mixed state, select value, readonly/required/multiple/accept/expanded state, stable observation IDs, stale rejection, SPA readiness, and unchanged clicks.
- [ ] Run the three focused files and verify failures correspond to absent fields/current innerText fallback/current `changed: true` shortcut.
- [ ] Implement accessible-name precedence, control-state extraction, bounded readiness/fingerprint driver methods, observation versioning, and stale checks.
- [ ] Re-run focused tests and verify existing element-index and policy tests remain green.

### Task 4: Declarative waiting and batched actions

**Files:**
- Modify: `plugins/dsh-browser-use/src/protocol.ts`
- Modify: `plugins/dsh-browser-use/src/browser-runtime.ts`
- Modify: `plugins/dsh-browser-use/src/browserd.ts`
- Modify: `plugins/dsh-browser-use/src/browser-session-controller.ts`
- Modify: `plugins/dsh-browser-use/src/index.ts`
- Test: `plugins/dsh-browser-use/tests/browser-runtime.spec.ts`
- Test: `plugins/dsh-browser-use/tests/browserd.e2e.spec.ts`
- Test: `plugins/dsh-browser-use/tests/tool.spec.ts`

**Interfaces:**
- Produces: `waitFor` action and top-level operation; `act` operation with a bounded `actions` array, per-step results, and final observation.
- Consumes: existing single-action executor and policy enforcement.

- [ ] Add failing tests for each wait condition, timeout classification, strict input rejection, ordered batch results, stop-on-first-error, and unchanged submit/network gates inside a batch.
- [ ] Run the three focused files and confirm the new operations fail because they are absent.
- [ ] Implement shared action validation/execution, bounded batch size, per-step output, final inspection, and declarative driver waits.
- [ ] Re-run focused tests and ensure ten legacy operations still behave identically.

### Task 5: Screenshot artifact delivery

**Files:**
- Modify: `plugins/dsh-browser-use/src/protocol.ts`
- Modify: `plugins/dsh-browser-use/src/browser-runtime.ts`
- Modify: `plugins/dsh-browser-use/src/browserd.ts`
- Modify: `plugins/dsh-browser-use/src/browser-session-controller.ts`
- Modify: `plugins/dsh-browser-use/src/index.ts`
- Test: `plugins/dsh-browser-use/tests/browser-runtime.spec.ts`
- Test: `plugins/dsh-browser-use/tests/browserd.e2e.spec.ts`
- Test: `plugins/dsh-browser-use/tests/tool.spec.ts`

**Interfaces:**
- Produces: screenshot metadata `{mimeType,width,height,size,sha256,path}` with full-page/element/clip/JPEG options.
- Consumes: `BYCLAW_BROWSER_SCREENSHOT_ROOT` and Playwright screenshot bytes/files.

- [ ] Add failing tests proving valid artifact bytes/hash/path, PNG IHDR dimensions differing from viewport, large files bypass broker limits, and invalid screenshot arguments fail closed.
- [ ] Run the three focused files and confirm failures reflect discarded bytes/viewport sizing/700 KiB rejection.
- [ ] Write screenshots under a lease-scoped directory, parse actual dimensions, return bounded metadata only, preserve returned paths after session close, and clean files when the broker runtime shuts down.
- [ ] Re-run focused tests and confirm raw image bytes and broker secrets never appear in model output.

### Task 6: Same-user container runtime

**Files:**
- Modify: `Dockerfile`
- Modify: `Dockerfile.extensions`
- Modify: `docker-entrypoint.sh`
- Modify: `scripts/byclaw-browser-supervisor.py`
- Modify: `scripts/browser-supervisor-verify.py`
- Modify: `scripts/browser-download-permissions-verify.py`
- Modify: `scripts/docker-browser-layout-verify.sh`
- Modify: `plugins/dsh-browser-use/README.md`
- Modify: `plugins/dsh-browser-use/README.zh.md`

**Interfaces:**
- Produces: browserd, Chromium, desktop viewer, and DSH processes owned by `byclaw`; private same-user runtime directories.
- Consumes: base image account `byclaw` from `Dockerfile.base`.

- [ ] Change verification fixtures first so they require identical UID/GID/HOME for browserd and DSH and same-user readability of downloads/screenshots; run them and observe failure against the current split-user layout.
- [ ] Update supervisor defaults/entrypoint/runtime image users and directories; retain root-only orchestration, signal forwarding, subreaper behavior, and independent secret FDs.
- [ ] Run `python3 scripts/browser-supervisor-verify.py`, `python3 scripts/browser-download-permissions-verify.py`, `bash scripts/browser-desktop-verify.sh`, `python3 scripts/docker-entrypoint-fd-verify.py`, and `bash scripts/docker-browser-layout-verify.sh`.
- [ ] Update both READMEs and deployment environment tables for session scope, TTL, screenshot root, and same-user behavior.

### Task 6.5: Exclusive session claim and noVNC focus

**Files:**
- Modify: `plugins/dsh-browser-use/src/lease-manager.ts`
- Modify: `plugins/dsh-browser-use/src/browser-session-controller.ts`
- Modify: `plugins/dsh-browser-use/src/browser-runtime.ts`
- Modify: `plugins/dsh-browser-use/src/browserd.ts`
- Modify: `plugins/dsh-browser-use/src/index.ts`
- Test: `plugins/dsh-browser-use/tests/lease-manager.spec.ts`
- Test: `plugins/dsh-browser-use/tests/tool.spec.ts`
- Test: `plugins/dsh-browser-use/tests/browser-runtime.spec.ts`
- Test: `plugins/dsh-browser-use/tests/browserd.e2e.spec.ts`

**Interfaces:**
- Produces: one claiming Agent and one Context per `sessionId`; session-bound `focus` operation for the noVNC desktop.
- Consumes: trusted execution-context session identity and internal lease credentials.

- [ ] Add failing tests proving a second Agent in one session cannot queue/open/operate a second context while the claimant remains functional.
- [ ] Key controller claims/lanes by session, enforce the invariant again in the lease manager, and release claims only through explicit lifecycle paths.
- [ ] Add `focus` without a session-id argument; resolve the caller's session internally and call `page.bringToFront()` only for that lease.
- [ ] Add controller-to-real-Chromium regression coverage and document noVNC focus arbitration.

### Task 7: Full verification

**Files:**
- Verify all files above; do not add unrelated changes.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a clean, evidence-backed release candidate.

- [ ] Run `pnpm verify` in `plugins/dsh-browser-use`.
- [ ] Run all browser supervisor, desktop, entrypoint, permission, and Docker-layout checks from the repository root.
- [ ] Inspect `git diff --check`, `git status --short`, and the scoped diff; confirm unrelated user files remain untouched.
- [ ] If `docker info` succeeds, build the relevant runtime stage; otherwise report Docker build as unavailable rather than claiming it passed.
