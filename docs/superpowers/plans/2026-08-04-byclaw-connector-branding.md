# ByClaw Connector Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure connector authorization guidance consistently names the ByClaw platform.

**Architecture:** Keep the existing connector authorization and skill-filter flow unchanged. Update only user-facing prompt copy, its behavioral assertions, and the existing design/implementation documentation.

**Tech Stack:** TypeScript, Vitest, esbuild, Markdown

## Global Constraints

- Preserve all connector authorization and fail-closed behavior.
- Use `ByClaw` in both Chinese and English user-facing guidance.
- Keep the historical non-user-facing ignore rule unchanged.

---

### Task 1: Update connector guidance branding

**Files:**
- Modify: `byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/connector-authorization.ts`
- Modify: `docs/superpowers/specs/2026-08-04-session-connector-skill-authorization-design.md`
- Modify: `docs/superpowers/plans/2026-08-04-session-connector-skill-authorization.md`

**Interfaces:**
- Consumes: `buildDisabledConnectorPrompt(language, authorization)`
- Produces: unchanged prompt-builder API with ByClaw-branded output

- [ ] **Step 1: Add failing assertions**

Assert that normal and overflow connector guidance contains the literal `ByClaw` platform name.

- [ ] **Step 2: Verify the test fails**

Run: `npx vitest run src/connector-authorization.test.ts`

Expected: FAIL because current prompt output does not contain `ByClaw`.

- [ ] **Step 3: Apply the minimal copy change**

Replace the legacy platform name with `ByClaw` in the four prompt strings and the two existing feature documents.

- [ ] **Step 4: Verify tests and build**

Run: `npx vitest run src/connector-authorization.test.ts src/prompt-injection-snapshot.test.ts && npm run build`

Expected: all selected tests pass and the build exits successfully.

- [ ] **Step 5: Update the installed plugin and verify repository text**

Synchronize `byai-channel/dist/` to the installed extension, then confirm tracked user-facing source and documentation contain no legacy platform branding.

- [ ] **Step 6: Commit and push**

Commit only the branding change and push `D0.3.1` to its configured remote.
