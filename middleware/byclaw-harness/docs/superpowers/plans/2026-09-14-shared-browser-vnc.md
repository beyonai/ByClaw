# Shared Browser VNC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Docker-default `shared-novnc` mode that keeps one headful persistent Chromium, its byCLI extension bridge, and one VNC desktop alive independently of individual DSH browser leases.

**Architecture:** Preserve `none` and the existing per-session `novnc` behavior. In `shared-novnc`, browserd owns one process-lifetime Xvfb/x11vnc/websockify desktop, launches the existing persistent-profile browser on that display during startup, and exposes it through a stable `shared` viewer route; DSH leases continue to own only their pages and policies.

**Tech Stack:** TypeScript, Playwright Core, Node.js networking/processes, Vitest, Docker shell verification

**Spec:** `单实例复用与VNC方案.md` plus the approved in-chat `shared-novnc` compatibility design

## Global Constraints

- Keep `${DSH_HOME}/browser/user-data` as the one global login-state profile.
- Load the byCLI extension into the same browserd-managed Chromium.
- A 15-minute lease expiry closes only that lease's page resources in shared mode.
- Keep the existing per-session `novnc` mode available as an explicit opt-in.
- Do not download another Chromium.
- Port `8081` remains a separate container port; host/Sandbox publication is deployment-owned.

---

### Task 1: Make the shared runtime process-owned

**Files:**
- Modify: `plugins/dsh-browser-use/src/browser-runtime.ts`
- Test: `plugins/dsh-browser-use/tests/browser-runtime.spec.ts`

**Interfaces:**
- Consumes: `BrowserRuntimeOptions.userDataDir`, `BrowserDriver.launch(...)`
- Produces: `BrowserRuntimeOptions.browserEnvironment`, `BrowserRuntimeOptions.keepBrowserAlive`, and `BrowserRuntime.start()`

- [x] **Step 1: Write failing runtime tests**

Add tests proving `start()` launches exactly one browser with the supplied display environment, lease close plus elapsed idle time does not close it when `keepBrowserAlive` is true, later leases reuse it, and `shutdown()` still closes it.

- [x] **Step 2: Run the focused tests and observe failure**

Run: `node_modules/.bin/vitest run plugins/dsh-browser-use/tests/browser-runtime.spec.ts`

Expected: FAIL because the runtime has no eager start/environment/keep-alive contract.

- [x] **Step 3: Implement the minimal runtime contract**

Pass the configured environment through the shared launch path, expose an idempotent `start()`, and suppress idle shutdown only when `keepBrowserAlive` is enabled.

- [x] **Step 4: Run the focused tests and observe success**

Run the same Vitest command and require all runtime tests to pass.

### Task 2: Orchestrate one process-lifetime VNC desktop

**Files:**
- Modify: `plugins/dsh-browser-use/src/browserd.ts`
- Modify: `plugins/dsh-browser-use/src/viewer-gateway.ts` only if the stable route requires gateway support
- Test: `plugins/dsh-browser-use/tests/browserd.e2e.spec.ts`
- Test: `plugins/dsh-browser-use/tests/viewer-gateway.spec.ts`

**Interfaces:**
- Consumes: `SessionDesktopManager.open()`, `BrowserRuntime.start()`, `startViewerGateway()`
- Produces: viewer mode `shared-novnc` and the stable viewer ID `shared`

- [x] **Step 1: Write failing orchestration tests**

Cover acceptance of `shared-novnc` with `userDataDir`, rejection of that combination only for legacy per-session `novnc`, one shared browser across multiple leases, a viewer route that survives lease closure, and complete cleanup on browserd shutdown.

- [x] **Step 2: Run focused tests and observe failure**

Run: `node_modules/.bin/vitest run plugins/dsh-browser-use/tests/browserd.e2e.spec.ts plugins/dsh-browser-use/tests/viewer-gateway.spec.ts`

Expected: FAIL because only `none|novnc` exist and `novnc` binds desktop/browser ownership to each lease.

- [x] **Step 3: Implement shared desktop orchestration**

Create and publish one internal `shared` desktop before accepting browser work, launch the persistent browser headfully on its `DISPLAY`, do not pass a per-lease desktop manager to the runtime, and close gateway/runtime/desktop in bounded reverse ownership order.

- [x] **Step 4: Run focused tests and observe success**

Run the same Vitest command and require all focused tests to pass.

### Task 3: Make shared VNC the Docker default and document deployment

**Files:**
- Modify: `Dockerfile`
- Modify: `Dockerfile.extensions`
- Modify: `scripts/docker-browser-layout-verify.sh`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `plugins/dsh-browser-use/README.md`
- Modify: `plugins/dsh-browser-use/README.zh.md`
- Add: `单实例复用与VNC方案.md`

**Interfaces:**
- Consumes: `BYCLAW_BROWSER_VIEWER`, port `8081`, `BYCLAW_BROWSER_USER_DATA_DIR`
- Produces: Docker default `BYCLAW_BROWSER_VIEWER=shared-novnc`

- [x] **Step 1: Add a failing behavioral Docker verification**

Update the Docker verification to require the shared mode, persistent profile, byCLI extension, and exposed 8081 endpoint together.

- [x] **Step 2: Run it and observe failure**

Run: `bash scripts/docker-browser-layout-verify.sh`

Expected: FAIL while both Dockerfiles still default to `none`.

- [x] **Step 3: Update Docker defaults and operator documentation**

Set both images to `shared-novnc`; document the stable `/?sessionId=shared` URL, lease/process lifecycle, legacy modes, and the requirement to publish `8081` with Docker/platform configuration.

- [x] **Step 4: Run Docker verification and observe success**

Run the same shell verification and require exit 0.

### Task 4: Full verification and delivery

**Files:**
- Modify: `docs/superpowers/plans/2026-09-14-shared-browser-vnc.md`

**Interfaces:**
- Consumes: all changes above
- Produces: verified commit on `2026.9.8`, pushed to `origin/2026.9.8`

- [x] **Step 1: Run the complete verification matrix**

Run package tests, typecheck, build, Supervisor verification, Docker layout verification, desktop verification, entrypoint/FD verification, byCLI skill validation, and `git diff --check`.

- [x] **Step 2: Review the staged scope**

Stage only the approved spec, plan, browser/VNC implementation, tests, Dockerfiles, verification scripts, and docs. Leave `.playwright-cli/`, `output/`, and `plugins/dsh-shortdrama-core/` untouched.

- [x] **Step 3: Commit and push**

Commit with `feat(browser): add shared persistent VNC mode` and push `origin 2026.9.8`.
