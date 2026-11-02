# Browser Window Bridge Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every extension-enabled Playwright Chromium fallback starts with a real browser window so byCLI never fails with `No current window`, while preserving the global persistent profile path.

**Architecture:** Keep `launchPersistentContext` as the default Docker path and harden the non-persistent fallback used by alternate viewer modes. Build the Playwright ignore list from validated extension configuration so both launch paths remove the extension-disabling switch and the window-suppressing switch.

**Tech Stack:** TypeScript, Playwright Core 1.62.1, Vitest, Dockerfile shell verification

**Spec:** `DSH浏览器桥接故障-维护者处理单.md`

## Global Constraints

- All default Docker browser sessions share `${DSH_HOME}/browser/user-data`.
- Only validated unpacked extensions may be passed to Chromium.
- The fix must not start a second Chromium or bypass the DSH Supervisor.
- Unrelated untracked workspace content must remain untouched.

---

### Task 1: Reproduce the suppressed-window fallback

**Files:**
- Modify: `plugins/dsh-browser-use/tests/browser-launch-config.spec.ts`

**Interfaces:**
- Consumes: `resolveBrowserLaunchConfiguration(environment)` and `PlaywrightBrowserDriver.launch(options)`
- Produces: A regression test that observes the actual arguments Playwright passes to a child executable

- [x] **Step 1: Write the failing test**

Add a temporary executable that records every received argument, call `PlaywrightBrowserDriver.launch()` without `userDataDir`, and assert that extension-enabled launch arguments do not contain `--no-startup-window`.

- [x] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run plugins/dsh-browser-use/tests/browser-launch-config.spec.ts`

Expected: FAIL because Playwright currently adds `--no-startup-window` to the fallback launch.

### Task 2: Remove the window-suppressing default argument

**Files:**
- Modify: `plugins/dsh-browser-use/src/browserd.ts`
- Modify: `plugins/dsh-browser-use/tests/browser-launch-config.spec.ts`

**Interfaces:**
- Consumes: Valid extension paths from `resolveBrowserLaunchConfiguration()`
- Produces: `ignoreDefaultArgs` containing both `--disable-extensions` and `--no-startup-window`

- [x] **Step 1: Implement the minimal fix**

Return the literal ignore list `['--disable-extensions', '--no-startup-window']` whenever at least one extension path is valid.

- [x] **Step 2: Run test to verify it passes**

Run: `node_modules/.bin/vitest run plugins/dsh-browser-use/tests/browser-launch-config.spec.ts`

Expected: PASS, with the recorded child arguments containing neither suppressed switch.

### Task 3: Verify packaging and regressions

**Files:**
- Modify: `scripts/docker-browser-layout-verify.sh`
- Add: `DSH浏览器桥接故障-维护者处理单.md`

**Interfaces:**
- Consumes: The built `@byclaw/dsh-browser-use` package and Docker environment
- Produces: Repository checks that retain the global profile and startup-window guarantees

- [x] **Step 1: Add the Docker layout assertion**

Assert the browser source contains the window-suppression ignore value and that both Dockerfiles still define `BYCLAW_BROWSER_VIEWER=none` plus `/home/byclaw/.dsh/browser/user-data`.

- [x] **Step 2: Run focused and full verification**

Run the browser Vitest suite, TypeScript typecheck/build, Supervisor verification, Docker browser layout verification, desktop verification, entrypoint verification, and `git diff --check`.

- [x] **Step 3: Commit and push**

Stage only the handling document, plan, browser source/tests, and Docker layout verification; commit on `2026.9.8` and push to `origin/2026.9.8`.

### Task 4: Remove Supervisor verification readiness races

**Files:**
- Modify: `scripts/browser-supervisor-verify.py`

**Interfaces:**
- Consumes: Fake child readiness record files used by signal-forwarding tests
- Produces: Readiness markers that are written only after SIGTERM/SIGINT handlers are installed

- [x] **Step 1: Reproduce the race**

Run Supervisor verification repeatedly and observe either `Operation not permitted` during double signaling or a missing `prepare.signal` when the readiness marker wins the race with handler installation.

- [x] **Step 2: Publish readiness after handler installation**

Install fake DSH and prepare-process signal handlers before writing their record files, so the existing record wait is a valid readiness barrier.

- [x] **Step 3: Verify stability**

Run `python3 scripts/browser-supervisor-verify.py` three consecutive times and require all three invocations to pass.

### Task 5: Recover safe observation churn and align byCLI idle expiry

- [x] Add failing coverage for safe retry of stale and legacy observation-state errors.
- [x] Retry only when a refreshed observation still identifies the same indexed element.
- [x] Set byCLI browser-session idle timeout to the browser plugin's 15-minute lease timeout.
- [x] Re-run the complete verification matrix.
- [x] Commit and push.

### Task 6: Resolve BRW-SUM-002 business feedback

- [x] Split structural observation validity from free-text drift reporting (BRW-13).
- [x] Expose blocking layers and element visibility/coverage (BRW-14).
- [x] Publish the complete `act.actions` schema and usage description (BRW-15).
- [x] Preserve sessions after passive allowlist redirects and retain fatal close reasons (BRW-16).
- [x] Diagnose bootstrap-only navigation instead of returning an opaque denial (BRW-17).
- [x] Return field-level validation diagnostics (BRW-18).
- [x] Run focused and full verification against AC-27 through AC-44.
