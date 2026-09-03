# Weixin Login-Gate Rerun Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permit up to ten user-confirmed reruns for the same Weixin human-verification gate before making the operation terminal.

**Architecture:** Persist a numeric confirmed-rerun counter in the existing fingerprint state file and increment it before each rerun. Human-gate outcomes return to `waiting-confirmation` while the count is below ten; the tenth such outcome becomes terminal. The browser runner continues to bypass capability and bridge preflight for every confirmed rerun.

**Tech Stack:** Node.js ESM, `node:test`, Markdown reference documentation.

---

### Task 1: Specify the ten-rerun state machine with failing tests

**Files:**
- Modify: `middleware/openclaw/skills/bycli/scripts/weixin-login-gate.test.mjs`
- Modify: `middleware/openclaw/skills/bycli/scripts/weixin-browser-runner.test.mjs`
- Modify: `middleware/openclaw/tests/test_knowledge_collection_skill.py`

- [x] **Step 1: Replace the one-rerun test with a ten-rerun boundary test**

Create a test that performs an initial `AUTH_REQUIRED`, verifies a plain retry is blocked, confirms reruns 1 through 9 return `waiting-confirmation`, and confirms rerun 10 returns `terminal`. Assert exactly eleven command executions: one initial plus ten confirmed reruns.

- [x] **Step 2: Add persistence and compatibility assertions**

Assert `confirmedRerunCount` is written before each confirmed callback. Add legacy-state coverage showing `rerunConsumed: true` without a numeric counter maps to one consumed rerun, while an existing `terminal` state remains terminal.

- [x] **Step 3: Extend the browser-runner test**

Run two confirmed reruns that both return `AUTH_REQUIRED` and assert each rerun produces only a `command` event, with no capability-help or bridge event.

- [x] **Step 4: Update the cross-cutting contract assertions**

Replace the old one-shot wording assertions with `The tenth post-confirmation login-gate rerun` and `fewer than ten confirmed reruns have been consumed`, retaining the priority-order check.

- [x] **Step 5: Run the focused tests and verify RED**

Run:

```bash
node --test middleware/openclaw/skills/bycli/scripts/weixin-login-gate.test.mjs middleware/openclaw/skills/bycli/scripts/weixin-browser-runner.test.mjs
```

Expected: failures where current behavior becomes terminal after the first confirmed rerun and does not persist `confirmedRerunCount`.

### Task 2: Implement the persisted ten-rerun budget

**Files:**
- Modify: `middleware/openclaw/skills/bycli/scripts/weixin-login-gate.mjs`

- [x] **Step 1: Add the budget and normalized count**

Define `MAX_CONFIRMED_RERUNS = 10`. Normalize state with logic equivalent to:

```js
function confirmedRerunCount(state) {
  if (Number.isInteger(state?.confirmedRerunCount)) {
    return Math.max(0, Math.min(MAX_CONFIRMED_RERUNS, state.confirmedRerunCount));
  }
  return state?.rerunConsumed === true ? 1 : 0;
}
```

- [x] **Step 2: Persist the count before a confirmed rerun**

When phase is `waiting-confirmation`, increment the normalized count and write a transient in-progress state before calling `execute`. Pass `{ attemptKind: 'confirmed-rerun' }` exactly as before.

- [x] **Step 3: Classify repeated human gates**

After execution, use:

```js
if (humanGate) {
  phase = isConfirmedRerun && nextConfirmedRerunCount >= MAX_CONFIRMED_RERUNS
    ? 'terminal'
    : 'waiting-confirmation';
}
```

Persist the numeric count in the final state. A success completes immediately and a nonzero non-human-gate error remains terminal.

- [x] **Step 4: Preserve interruption safety and legacy terminal behavior**

An interrupted in-progress rerun must retain its already-incremented count. On the next invocation, convert it into a safe state without re-executing that same confirmation; allow a later explicit confirmation only when the count remains below ten. Existing `terminal` files must remain terminal.

- [x] **Step 5: Run focused tests and verify GREEN**

Run the same two-file `node --test` command and expect all tests to pass.

### Task 3: Synchronize the Weixin execution contract

**Files:**
- Modify: `middleware/openclaw/skills/bycli/references/weixin.md`
- Modify: `docs/superpowers/specs/2026-09-01-weixin-login-gate-rerun-budget-design.md`
- Create: `docs/superpowers/plans/2026-09-01-weixin-login-gate-rerun-budget.md`

- [x] **Step 1: Update terminal-state precedence**

Change priority 3 so it applies only after the tenth confirmed rerun returns authentication, login timeout, login page, CAPTCHA, or environment verification. Priority 4 must cover the same human-gate outcomes while fewer than ten confirmed reruns have been consumed.

- [x] **Step 2: Update browser-session and login-gate wording**

Replace “single rerun” language with the ten-rerun loop: explicit confirmation is required for every rerun, each rerun skips preflight, reruns 1–9 may return to waiting, and rerun 10 becomes terminal if the human gate persists.

- [x] **Step 3: Check for stale one-shot language**

Run:

```bash
rg -n "single (post-confirmation|confirmed|login-gate)? ?rerun|single rerun|rerunConsumed|rerun-consumed" middleware/openclaw/skills/bycli/references/weixin.md middleware/openclaw/skills/bycli/scripts/weixin-login-gate.mjs middleware/openclaw/skills/bycli/scripts/weixin-login-gate.test.mjs
```

Expected: no stale one-rerun contract remains; any compatibility occurrence is explicitly described as legacy.

### Task 4: Verify and commit the complete change

**Files:**
- Verify all files listed above.

- [x] **Step 1: Run focused tests**

```bash
node --test middleware/openclaw/skills/bycli/scripts/weixin-login-gate.test.mjs middleware/openclaw/skills/bycli/scripts/weixin-browser-runner.test.mjs
```

Expected: zero failures.

- [x] **Step 2: Run repository-level byCLI skill tests**

```bash
python3 -m pytest middleware/openclaw/tests/test_bycli_skill.py -q
```

Expected: zero failures.

- [x] **Step 3: Run the knowledge-collection contract tests**

```bash
python3 -m unittest middleware.openclaw.tests.test_knowledge_collection_skill -q
```

Expected: 43 tests and zero failures.

- [x] **Step 4: Review scope and whitespace**

Run `git diff --check`, inspect the complete diff, and ensure the unrelated untracked `performance-validation.md` file is not staged.

- [x] **Step 5: Commit only the requested files**

Stage the gate implementation, focused tests, Weixin reference, design, and plan explicitly, then commit:

```bash
git commit -m "fix(bycli): allow ten Weixin verification reruns"
```
