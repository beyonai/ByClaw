# ByClaw Authorized Resource Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace global Redis resource scanning and HTTP resource discovery with USER_CODE-scoped authorization loading, then keep projected resources current through authorization-key and resource-channel listeners.

**Architecture:** A focused authorization module resolves the user mapping and parses the DIG_EMPLOYEE authorization Hash. The catalog performs bounded concurrent targeted snapshot reads, including only supplementary members declared by authorized groups. A watcher module owns keyspace/polling authorization detection and debounced resource events, while `index.ts` funnels all signals through the existing serialized atomic generation queue.

**Tech Stack:** TypeScript, Node.js ESM, ioredis-compatible clients from `@byclaw/by-framework`, DSH/Cordis lifecycle effects, package verification scripts, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-27-byclaw-authorized-resource-watch-design.md`

## Global Constraints

- Redis authorization key `USER:RESOURCES:AUTH:${userId}` is the sole resource-discovery authority.
- Resource discovery must not call `discoverMine`, `findDetailsById`, or `SCAN MATCH DIG_EMPLOYEE_*`.
- Expert-group member snapshots not directly authorized may be loaded only by IDs declared by an authorized group.
- Direct routing must remain restricted to `directEmployeeIds` plus authorized groups.
- Cold-start failures fail plugin startup; hot-refresh failures retain the last complete generation.
- Authorization and resource signals share one serialized generation queue.
- Source of truth is `/Users/chenxiaofeng/code/open/byclaw-dsh/plugins/byclaw-integration`; synchronize changed plugin files to `/Users/chenxiaofeng/code/open/deepseek-harness/plugins/byclaw-integration` before DSH E2E.
- Do not stage or modify unrelated existing files in either repository.

---

### Task 1: Parse USER_CODE-scoped authorization and target-load resource snapshots

**Files:**
- Create: `plugins/byclaw-integration/src/resource-authorization.ts`
- Modify: `plugins/byclaw-integration/src/catalog.ts`
- Modify: `plugins/byclaw-integration/scripts/catalog-skill-verify.mjs`

**Interfaces:**
- Produces: `parseByClawAuthorizedResourceIds(hash): string[]`, `resolveByClawAuthorization(redis, userCode): Promise<{ userId: string; authKey: string; resourceIds: string[]; authHeaders: Record<string, string> }>`.
- Produces: `loadAuthorizedByClawResources({ redis, userCode, snapshotConcurrency }): Promise<AuthorizedByClawResources>` using only `get` and `hgetall`; `baseUrl` remains only for downstream HTTP runtime projection.

- [ ] **Step 1: Rewrite the catalog fixture as a failing authorization-scoped test**

  Make `USER:RESOURCES:AUTH:42` contain DIG_EMPLOYEE IDs `1` and `9`, plus unrelated resource types. Record every Redis key read and make any HTTP catalog fetch throw. Assert that the result contains employee `1`, group `9`, and supplementary group member `2`, while `directEmployeeIds` contains only `1`; assert reads are limited to the mapping, login auth, authorization Hash, and `DIG_EMPLOYEE_1/9/2`.

- [ ] **Step 2: Run the focused verification and confirm the old discovery path fails**

  Run `pnpm --dir plugins/byclaw-integration build && node plugins/byclaw-integration/scripts/catalog-skill-verify.mjs`. Expected: failure because the existing loader calls `discoverMine` or lacks the authorization Hash parser.

- [ ] **Step 3: Implement authorization parsing and login-header resolution**

  Parse direct field IDs when the value is `DIG_EMPLOYEE`; parse JSON values whose `resourceBizType` or `resourceType` equals `DIG_EMPLOYEE`, taking the ID from the field or JSON `resourceId`/`id`. Resolve the mapping, auth Hash, login auth headers, and distinguish an existing empty Hash from a missing key when the Redis interface exposes `exists`.

- [ ] **Step 4: Replace HTTP discovery and SCAN with bounded targeted reads**

  Load unique direct IDs with a worker pool of `snapshotConcurrency`; parse each JSON snapshot and classify it. Collect group member IDs outside the direct set and load only those snapshots with the same bounded concurrency. Reject missing, malformed, mismatched-ID, or group-valued supplementary member snapshots.

- [ ] **Step 5: Run the focused verification until it passes**

  Run `pnpm --dir plugins/byclaw-integration build && node plugins/byclaw-integration/scripts/catalog-skill-verify.mjs`. Expected: target-read assertions and all existing Skill/projection assertions pass.

### Task 2: Add authorization polling/keyspace detection and resource-event batching

**Files:**
- Create: `plugins/byclaw-integration/src/resource-watch.ts`
- Create: `plugins/byclaw-integration/scripts/resource-watch-verify.mjs`
- Modify: `plugins/byclaw-integration/package.json`

**Interfaces:**
- Produces: `parseByClawResourceChange(payload): ByClawResourceChange | undefined` and `mergeByClawResourceChanges(current, incoming)`.
- Produces: `ByClawResourceWatch` with `start(initialAuthorization)`, `updateWatchedResources(resources)`, and `close()`; callbacks are `onAuthorizationChange()` and `onResourceChange(batch)`.

- [ ] **Step 1: Add failing pure event/parser assertions**

  Cover CREATED/UPDATED/DELETED/SKILLS_SYNCED, non-DIG_EMPLOYEE rejection, malformed payload rejection, DELETE precedence, largest `changedAt`, and stale-event rejection.

- [ ] **Step 2: Add failing lifecycle assertions with fake Redis clients and timers**

  Assert changed authorization triggers once, unchanged polls do not trigger, confirmed empty authorization triggers removal, temporary missing auth stays last-good during grace, keyspace messages schedule a check, authorized/group-member resource events debounce into one batch, unauthorized updates are ignored, deletion cleanup is accepted, and `close()` removes listeners/timers/subscriptions.

- [ ] **Step 3: Run the new verification and confirm the feature failure**

  Run `pnpm --dir plugins/byclaw-integration build && node plugins/byclaw-integration/scripts/resource-watch-verify.mjs`. Expected: missing exports or behavior assertions fail.

- [ ] **Step 4: Implement the watcher with injected timing hooks**

  Use recursive `setTimeout` polling, optional keyspace pattern subscription based on `CONFIG GET notify-keyspace-events`, a missing-key grace timestamp, a debounced per-ID resource-event map, and processed `changedAt` watermarks. All callbacks await or queue through a single internal promise and catch hot errors through the supplied logger.

- [ ] **Step 5: Add the script to `pnpm verify` and make focused checks pass**

  Build and run `resource-watch-verify.mjs`, then update `scripts.verify` to invoke it after build.

### Task 3: Wire both listeners into the atomic synchronization lifecycle

**Files:**
- Modify: `plugins/byclaw-integration/src/index.ts`
- Modify: `plugins/byclaw-integration/src/catalog.ts`
- Modify: `plugins/byclaw-integration/scripts/resource-watch-verify.mjs`

**Interfaces:**
- Consumes: `ByClawResourceWatch`; Task 1 catalog loader.
- Produces: cold start `load -> project -> watch -> Worker online`; hot signals call the same serialized `synchronize()` and update the watcher’s watched direct/group-member ID set after successful publication.

- [ ] **Step 1: Add a failing refresh-coordination assertion**

  Drive an authorization change and a resource batch while a fake refresh promise is pending. Assert the second operation starts only after the first finishes and that a rejected hot refresh leaves the preceding resource snapshot available.

- [ ] **Step 2: Run the focused script and confirm the old blind subscriber fails**

  Run the built resource-watch verification. Expected: failure because `index.ts` currently uses an unparsed `message` callback and has no authorization listener.

- [ ] **Step 3: Replace the blind subscriber with `ByClawResourceWatch`**

  Resolve authorization during the cold load, atomically project it, construct/start the watcher, and route both callbacks to `synchronizeOrRetain`. After each successful refresh update the watch set from direct IDs, groups, and group members. Keep resource state assignment after successful publication.

- [ ] **Step 4: Complete ordered unload**

  Stop the watcher before waiting for the refresh queue, then close generation admission, Worker, session runtime, watcher clients, and the base Redis client. Aggregate cleanup failures without masking setup failures.

- [ ] **Step 5: Run focused build and verification**

  Run `pnpm --dir plugins/byclaw-integration build`, `node plugins/byclaw-integration/scripts/resource-watch-verify.mjs`, and `node plugins/byclaw-integration/scripts/catalog-skill-verify.mjs`. Expected: all pass.

### Task 4: Document the authorization and hot-refresh behavior

**Files:**
- Modify: `plugins/byclaw-integration/README.md`
- Modify: `plugins/byclaw-integration/README.zh.md`

**Interfaces:**
- Documents: exact Redis mapping/auth/resource keys, absence of global scan and HTTP discovery, keyspace/poll fallback, event channel behavior, last-good hot-refresh semantics, and new tuning fields.

- [ ] **Step 1: Replace obsolete dynamic-resource prose**

  State that Redis authorization and snapshots provide discovery and base content; HTTP remains only for expert-group runtime and Skill artifacts. Remove the claim that every refresh loads `findDetailsById`.

- [ ] **Step 2: Document operator-visible listener and configuration behavior**

  Add the authorization Hash/keyspace/poll path, resource channel event types, startup failure vs hot-retain behavior, and defaults for polling, grace, debounce, and concurrency.

- [ ] **Step 3: Run README synchronization verification if configured**

  Run the repository README/i18n gate named by the root scripts if present; otherwise compare the matching English and Chinese sections manually and run `git diff --check`.

### Task 5: Run complete source-package verification and synchronize the DSH copy

**Files:**
- Modify: only Task 1–4 files if verification requires corrections.
- Synchronize: changed files under `plugins/byclaw-integration/` to `/Users/chenxiaofeng/code/open/deepseek-harness/plugins/byclaw-integration/`.

**Interfaces:**
- Produces: identical source, scripts, package metadata, and README files in the source-of-truth and DSH runtime copy.

- [ ] **Step 1: Run plugin quality gates**

  Run `pnpm --dir plugins/byclaw-integration typecheck` and `pnpm --dir plugins/byclaw-integration verify`. Expected: every existing and new verification script exits zero.

- [ ] **Step 2: Check source repository scope**

  Run `git diff --check` and `git status --short`. Confirm only this spec, plan, and ByClaw Integration files are changed by this task.

- [ ] **Step 3: Synchronize changed plugin files without deleting unrelated files**

  Use `apply_patch` for text files or an existing repository sync command if one is documented. Do not recursively overwrite the dirty deepseek-harness workspace. Confirm source/copy hashes for every synchronized file.

- [ ] **Step 4: Build the synchronized DSH workspace package**

  Run `pnpm --dir /Users/chenxiaofeng/code/open/deepseek-harness --filter @byclaw/dsh-integration build`. Expected: the copied package builds against the DSH workspace.

### Task 6: Run real Redis/PubSub E2E and startup performance acceptance

**Files:**
- No committed source files; temporary logs and test Redis mutations must be restored before exit.

**Interfaces:**
- Validates: current USER_CODE authorization target set, no global scan/discoverMine, ready time, authorization add/revoke reaction, resource update/delete reaction, and last-good failure behavior.

- [ ] **Step 1: Record the live authorization target list and cold-load instrumentation**

  With the launch `.env`, resolve the mapped user, authorization Hash, direct IDs, group members, and exact Redis keys read. Confirm the loader issues no `SCAN` and the catalog fetch path issues no `discoverMine` or `findDetailsById`.

- [ ] **Step 2: Measure source-launched DSH readiness**

  Start `pnpm dsh web` from `/Users/chenxiaofeng/code/open/deepseek-harness`, time from process start to the Worker/Web ready log, then stop it cleanly. Compare with the recorded 28,449 ms baseline; expected improvement is at least 50%.

- [ ] **Step 3: Exercise authorization change without losing production state**

  Snapshot the live authorization Hash, apply a reversible field add/remove or use a disposable test field accepted by the parser, wait for the poll/keyspace listener, assert the routing catalog/templates change once, and restore the exact original Hash in `finally`-style cleanup.

- [ ] **Step 4: Exercise resource update and delete events reversibly**

  Snapshot one authorized resource value and its projected files, publish UPDATED/SKILLS_SYNCED and DELETED events while controlling the underlying snapshot, verify debounced dynamic reload/removal, then restore Redis value and republish UPDATED. Never leave the resource or authorization state changed.

- [ ] **Step 5: Run one real ByClaw inbound smoke and report evidence**

  Send a current authorized digital-employee or main routing request through `scripts/live-e2e.mjs`. Report ready time, authorization count, Redis keys touched, listener reactions, selected template/session, and any environment-specific failure with exact logs.

### Task 7: Bound projection-side startup requests

**Files:**
- Modify: `plugins/byclaw-integration/src/integration.ts`
- Modify: `plugins/byclaw-integration/src/index.ts`
- Modify: `plugins/byclaw-integration/scripts/catalog-skill-verify.mjs`
- Modify: `plugins/byclaw-integration/README.md`
- Modify: `plugins/byclaw-integration/README.zh.md`

**Interfaces:**
- Produces: `projectionConcurrency` config with default `8`; one shared limiter covers Skill synchronization, employee-model resolution, and expert-group runtime requests.

- [ ] **Step 1: Add a failing bounded-concurrency assertion**

  Inject delayed model and group-runtime resolvers into template projection, configure concurrency `2`, and assert the observed maximum is exactly `2`; the sequential implementation must report `1`.

- [ ] **Step 2: Resolve independent projection inputs through one limiter**

  Start Skill, employee-model, and expert-group runtime operations together, cap their combined active count at `projectionConcurrency`, then build and publish templates only after all inputs succeed.

- [ ] **Step 3: Re-run complete verification and startup timing**

  Run both source and synchronized package gates, then measure source-launched Worker ready with a monotonic clock. Confirm the result is at most `14,224ms`, a 50% reduction from the `28,449ms` baseline.
