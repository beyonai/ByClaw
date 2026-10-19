# ByClaw Inbound Direct Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route ByClaw inbound messages carrying `agent_id`/`agent_code` or a textual `@resource` directly to an authorized dynamic digital-employee or expert-team instance, preserving durable follow-up sessions and existing streaming behavior.

**Architecture:** Add a pure authorized-resource resolver that produces a template target and cleaned business text. Reuse the existing template composition path through a runtime service that can create, follow up, or cold-resume a deterministic child session owned by the existing DSH root. The session runtime forwards the selected child’s output directly and leaves messages without a target on the existing main-Agent path.

**Tech Stack:** TypeScript, Node.js ESM, DSH `SubagentRuntime.startContinuable/followup`, `@byclaw/by-framework`, package verification scripts, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-27-byclaw-inbound-direct-routing-design.md`

## Global Constraints

- Preserve existing `dsh_target_session_id`/`dsh_parent_session_id` routing.
- Only directly authorized digital employees and authorized expert groups are routable.
- Expert-group member employees remain inaccessible as standalone targets unless directly authorized.
- Structured `agent_id`/`agent_code` takes precedence over text `@` matching; ambiguous or conflicting targets fail before child creation.
- No user credentials, Redis credentials, model tokens, or full prompts may be added to route metadata or logs.
- Existing no-target inbound behavior must remain main-Agent routing.
- Do not stage or commit unrelated pre-existing worktree changes.

---

### Task 1: Add failing tests and the pure inbound target resolver

**Files:**
- Create: `plugins/byclaw-integration/src/inbound-routing.ts`
- Create: `plugins/byclaw-integration/scripts/inbound-routing-verify.mjs`
- Modify: `plugins/byclaw-integration/package.json: scripts.verify`

**Interfaces:**
- Consumes: `AuthorizedByClawResources`, `ByClawDigitalEmployee`, `ByClawExpertGroup`.
- Produces: `resolveByClawInboundTarget(resources, extraPayload, text)` returning an authorized target `{ templateId, resourceId, kind, name, text }` or `undefined`; throws for unknown, unauthorized, conflicting, or ambiguous targets.

- [ ] **Step 1: Write the failing verification script**

  Add fixtures with two directly authorized employees, one authorized expert group, and one group-only member. Assert that the resolver maps `agent_id`, `agent_code`, `agent_name`, `@Name`, and `@Code` to `byclaw-employee-<id>` or `byclaw-group-<id>`; strips the matched textual mention; returns `undefined` for ordinary text; rejects an unauthorized member, unknown structured target, conflicting fields, and multiple text mentions.

- [ ] **Step 2: Run the verification script and confirm the feature failure**

  Run `node --import tsx/esm scripts/inbound-routing-verify.mjs` from `plugins/byclaw-integration`. Expected result: module/function missing or assertions fail because direct target resolution does not exist.

- [ ] **Step 3: Implement the minimal resolver**

  Normalize string/number structured values, build only directly authorized employees plus all authorized groups as candidates, match structured fields consistently, and parse the longest non-numeric `@name`/`@code` alias case-insensitively. Preserve business text after removing the selected mention and trimming whitespace.

- [ ] **Step 4: Run the verification script and confirm it passes**

  Run `node --import tsx/esm scripts/inbound-routing-verify.mjs`. Expected result: all resolver assertions pass.

- [ ] **Step 5: Add the verification script to the package gate**

  Update `scripts.verify` so `pnpm verify` runs `node --import tsx/esm scripts/inbound-routing-verify.mjs` after the package build.

### Task 2: Reuse template composition for direct durable child sessions

**Files:**
- Modify: `plugins/byclaw-integration/src/template-runtime.ts`
- Modify: `plugins/byclaw-integration/src/session-runtime.ts`
- Modify: `plugins/byclaw-integration/src/index.ts`
- Modify: `plugins/byclaw-integration/scripts/worker-verify.mjs`

**Interfaces:**
- Consumes: Task 1’s `ByClawInboundTarget`; existing template catalog and model resolver.
- Produces: a template-runtime method that starts or follows a template instance under a supplied parent and deterministic child ID; session runtime direct delivery with `responseSessionId` set to that child.

- [ ] **Step 1: Extend verification assertions before implementation**

  Add assertions to `worker-verify.mjs` for deterministic direct child identity, target-vs-root delivery selection, and direct route precedence while retaining ordinary root delivery. Use a fake template-runtime callback and fake Agent objects so the test observes the selected session and never invokes the root follow-up for direct routes.

- [ ] **Step 2: Run the focused verification and confirm it fails**

  Run `pnpm --dir plugins/byclaw-integration build && node plugins/byclaw-integration/scripts/worker-verify.mjs`. Expected result: new direct-routing assertions fail because the session runtime has no direct target path.

- [ ] **Step 3: Extract a reusable template start/follow-up operation**

  Refactor the existing `byclaw_instantiate_template` execution path so both the model-facing tool and inbound routing use the same authorization check, model resolution, `persona`, Skill setup, `maxDepth`, and `startContinuable` request. Accept an optional caller-supplied child ID and avoid concluding the parent turn for inbound direct delivery.

- [ ] **Step 4: Add deterministic direct child delivery**

  Hash `userCode`, external root session ID, and template ID into a stable DSH child session ID. For a live child, follow it up; for a persisted but cold child, use `subagents.followup` with the exact root parent; otherwise start the template with the deterministic child ID. Set the active turn’s response session to the child so answer deltas, reasoning, lifecycle events, expert-team snapshots, and errors are attributed directly to the selected instance.

- [ ] **Step 5: Wire authorized resource resolution into the session runtime**

  Pass a resolver closure from `index.ts` using the current synchronized resources. Keep `dsh_target_session_id` handling first, then structured/text resource selection, then the existing root fallback. Fail before creating a child when the target is invalid or unauthorized.

- [ ] **Step 6: Run focused verification and confirm it passes**

  Run `pnpm --dir plugins/byclaw-integration build && node plugins/byclaw-integration/scripts/worker-verify.mjs`. Expected result: existing worker/session assertions and new direct-delivery assertions pass.

### Task 3: Make the live inbound test script emit compatible target metadata

**Files:**
- Modify: `plugins/byclaw-integration/scripts/live-e2e.mjs`
- Modify: `plugins/byclaw-integration/README.zh.md`
- Modify: `plugins/byclaw-integration/README.md`

**Interfaces:**
- Consumes: CLI options `--agent-id`, `--agent-code`, optional `--agent-name`, `E2E_CWD`, `USER_CODE`, and the external `.env` file.
- Produces: `GatewayClient.sendMessage.extraPayload` fields `agent_id`, `agent_code`, and `agent_name` compatible with `byai-channel`.

- [ ] **Step 1: Add a failing script-level assertion**

  Extend the verification script or a small pure argument helper test to assert that `--agent-id 1001 --agent-code EMP_1001` results in the exact `extraPayload` keys expected by `byai-channel`, while `--main` clears target fields.

- [ ] **Step 2: Run the focused assertion and confirm it fails**

  Run the focused script test. Expected result: the current `live-e2e.mjs` treats all CLI arguments as prompts and emits no target metadata.

- [ ] **Step 3: Implement compatible CLI parsing and payload construction**

  Preserve positional prompts, add `--agent-id`, `--agent-code`, `--agent-name`, and `--main`, and merge them into `extraPayload` alongside `cwd`. Keep `E2E_CWD` as the authoritative ByClaw workspace payload.

- [ ] **Step 4: Document direct-routing examples**

  Add examples showing structured direct routing and textual `@` routing, explicitly noting that the selected child receives the task directly and that no-target messages still use the main Agent.

- [ ] **Step 5: Run the script-level check**

  Run the focused argument/payload verification and confirm it passes without contacting Redis.

### Task 4: Build and run the complete local verification gate

**Files:**
- Modify: only files from Tasks 1–3 if fixes are required.

- [ ] **Step 1: Build both local plugin packages**

  Run `pnpm --dir plugins/agent-teams build` and then `pnpm --dir plugins/byclaw-integration build`.

- [ ] **Step 2: Run the complete integration verification**

  Run `pnpm --dir plugins/byclaw-integration verify`. Expected result: every existing and new verification script exits zero.

- [ ] **Step 3: Check the diff and repository scope**

  Run `git diff --check` and `git diff --stat -- plugins/byclaw-integration docs/superpowers`. Confirm no unrelated files are staged or modified by this implementation.

### Task 5: Start DSH Web and run two real ByClaw inbound end-to-end checks

**Files:**
- No source changes; runtime logs and temporary process state only.

- [ ] **Step 1: Start the DSH Web process with the requested environment file**

  From `/Users/chenxiaofeng/code/open/deepseek-harness`, run `node --env-file=/Users/chenxiaofeng/code/open/deepseek-harness/.env --import tsx/esm apps/cli/src/bin.ts web` (or the repository’s equivalent `pnpm dsh web` launcher with the same environment). Confirm the ByClaw Worker reports online.

- [ ] **Step 2: Discover current authorized resource IDs/names**

  Use the synchronized resource catalog or a safe list-resources inbound to identify one directly authorized digital employee and one authorized expert group. Do not assume verification-fixture IDs are present in the live environment.

- [ ] **Step 3: Send the digital-employee direct message**

  Run `E2E_CWD=/Users/chenxiaofeng/code/project/20014944 node --env-file=/Users/chenxiaofeng/code/open/deepseek-harness/.env plugins/byclaw-integration/scripts/live-e2e.mjs --agent-id <employee-id> '做自我介绍'` from the integration package directory. Confirm logs show template child creation/selection and the answer is emitted from the child session without a main-Agent tool dispatch.

- [ ] **Step 4: Send the expert-group direct message**

  Run the same command with `--agent-id <group-id> '做自我介绍'`. Confirm logs show the expert-group leader child and its AgentTeams activity, with no main-Agent dispatch.

- [ ] **Step 5: Report exact evidence and any live-environment blocker**

  Capture the two command results, selected template/session IDs, and whether each path reached the direct child. If Redis, ByClaw authorization, model, or Worker availability blocks a live check, report the exact error instead of claiming end-to-end success.
