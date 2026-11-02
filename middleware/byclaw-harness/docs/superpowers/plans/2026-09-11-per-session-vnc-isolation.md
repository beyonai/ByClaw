# Per-session VNC Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every active DSH browser session a fully independent Chromium/X11/VNC desktop. An explicit noVNC URL `sessionId` selects that exact desktop; omitting it remains supported and resolves to the newest live session.

**Architecture:** Browserd owns a `SessionDesktopManager` that starts one Xvfb, x11vnc, loopback websockify, and headed Chromium process per browser lease. A single HTTP/WebSocket gateway on port 8081 serves noVNC and routes upgrades by trusted session registration; viewer authentication defaults to disabled while raw RFB stays loopback-only.

**Tech Stack:** TypeScript 5.9, Node.js HTTP/net/process APIs, Playwright 1.62, Xvfb, x11vnc, websockify, Vitest, Bash, Python supervisor.

**Spec:** `docs/superpowers/specs/2026-09-11-per-session-vnc-isolation-design.md`

## Global Constraints

- Public browser tool input never accepts `sessionId`; only trusted DSH Agent context supplies it.
- One active session owns exactly one lease, Chromium process, browser context, page, X display, and VNC target.
- Viewer authentication defaults to `none`; 8081 is trusted-network-only or protected by an external proxy.
- `sessionId` is optional for viewers: an explicit value routes exactly, an omitted value selects the newest live session, and an empty system still serves the viewer in a disconnected state.
- Raw RFB and per-session websockify listeners bind to `127.0.0.1` and are not exposed by Docker.
- All processes and artifacts use the `byclaw` UID/GID/HOME; private session directories use mode `0700`.
- Existing policy, observation, artifact, cancellation, ownership, and structured-error behavior remains intact.
- Every behavior change starts with a failing test and is verified green before continuing.

---

### Task 1: Propagate trusted session identity through the private broker protocol

**Files:**
- Modify: `plugins/dsh-browser-use/src/protocol.ts`
- Modify: `plugins/dsh-browser-use/src/broker-client.ts`
- Modify: `plugins/dsh-browser-use/src/browser-session-controller.ts`
- Modify: `plugins/dsh-browser-use/src/browser-runtime.ts`
- Test: `plugins/dsh-browser-use/tests/tool.spec.ts`
- Test: `plugins/dsh-browser-use/tests/broker-client.spec.ts`
- Test: `plugins/dsh-browser-use/tests/browser-runtime.spec.ts`

**Interfaces:**
- Produces: private `BrowserOpenOptions.viewerSessionId: string`, set from `record.owner.sessionId`.
- Preserves: public `BrowserToolInput` has no `sessionId` or `viewerSessionId` property.

- [ ] **Step 1: Write failing tests** proving broker open receives `viewerSessionId: 'session-a'`, private request validation rejects missing/invalid IDs, duplicate live IDs fail closed, and the public schema still rejects both identity fields.
- [ ] **Step 2: Run red:** `pnpm vitest run tests/tool.spec.ts tests/broker-client.spec.ts tests/browser-runtime.spec.ts -t "viewer session|trusted session"`; expect failure because the field is absent.
- [ ] **Step 3: Implement** the bounded private field in protocol, client, controller, and runtime registration. Do not add it to the tool schema or output.
- [ ] **Step 4: Run the same focused command green.**
- [ ] **Step 5: Commit:** `git commit -m "feat(browser): propagate trusted viewer session identity"` with only Task 1 files.

### Task 2: Add a testable per-session desktop process manager

**Files:**
- Create: `plugins/dsh-browser-use/src/session-desktop-manager.ts`
- Create: `plugins/dsh-browser-use/tests/session-desktop-manager.spec.ts`
- Modify: `plugins/dsh-browser-use/src/browserd.ts`

**Interfaces:**
- Produces: `SessionDesktopManager.open(sessionId, leaseId, signal): Promise<SessionDesktop>`.
- Produces: `SessionDesktop` fields `display`, `rfbPort`, `websockifyPort`, `environment`, and idempotent `close()`.
- Produces: `targetFor(sessionId): { host: '127.0.0.1'; port: number } | undefined`.
- Consumes injected process spawning, readiness probing, allocator ranges, runtime root, and environment for Linux-free unit tests.

- [ ] **Step 1: Write failing tests** for distinct display/ports, duplicate session/lease rejection, bounded exhaustion, abort, reverse-order partial-start rollback, unexpected child exit, mode `0700`, route removal, and idempotent cleanup.
- [ ] **Step 2: Run red:** `pnpm vitest run tests/session-desktop-manager.spec.ts`; expect module-not-found or missing API failure.
- [ ] **Step 3: Implement** a serialized allocator and explicit argument-array child spawning for Xvfb, x11vnc, and websockify. Publish the route only after readiness; bind RFB/websockify to loopback; unwind failures in reverse order.
- [ ] **Step 4: Run manager tests green** with no surviving fake children or routes.
- [ ] **Step 5: Commit:** `git commit -m "feat(browser): manage an isolated desktop per session"` with Task 2 files.

### Task 3: Launch and clean one Chromium process per lease

**Files:**
- Modify: `plugins/dsh-browser-use/src/browser-runtime.ts`
- Modify: `plugins/dsh-browser-use/src/browserd.ts`
- Test: `plugins/dsh-browser-use/tests/browser-runtime.spec.ts`
- Test: `plugins/dsh-browser-use/tests/browserd.e2e.spec.ts`

**Interfaces:**
- Consumes `SessionDesktopManager.open()` and its session-specific `DISPLAY`.
- Changes `BrowserDriver.launch(options)` to accept `environment?: Readonly<Record<string, string>>`.
- Makes each `LeaseRuntime` own its `BrowserDriverInstance` and `SessionDesktop`; removes shared `#browser` ownership.

- [ ] **Step 1: Write failing tests** proving two leases launch different browser instances/displays/PIDs and disconnecting one lease does not break the other.
- [ ] **Step 2: Run red:** `pnpm vitest run tests/browser-runtime.spec.ts tests/browserd.e2e.spec.ts -t "different browser processes|failed lease"`; expect the shared-browser assertions to fail.
- [ ] **Step 3: Refactor** browser ownership into each lease. Start desktop before Chromium, pass `DISPLAY`, close browser before desktop, keep status aggregate-only, and scope disconnect tombstones to one lease.
- [ ] **Step 4: Run all runtime and browserd E2E tests green.**
- [ ] **Step 5: Commit:** `git commit -m "refactor(browser): isolate Chromium processes by lease"` with Task 3 files.

### Task 4: Route noVNC HTTP and WebSocket connections by session ID

**Files:**
- Create: `plugins/dsh-browser-use/src/viewer-gateway.ts`
- Create: `plugins/dsh-browser-use/tests/viewer-gateway.spec.ts`
- Modify: `plugins/dsh-browser-use/src/browserd.ts`
- Modify: `browser/novnc-index.html`
- Modify: `browser/novnc-index.test.mjs`

**Interfaces:**
- Produces: `startViewerGateway(options): Promise<ViewerGateway>` with `close(): Promise<void>`.
- Consumes `targetFor(sessionId)` from `SessionDesktopManager`.
- Routes static assets over HTTP and `<proxy-prefix>/websockify?sessionId=...` upgrades to that session's loopback websockify target.

- [ ] **Step 1: Write failing tests** for two concurrent IDs reaching different fake targets, bidirectional byte isolation, omitted-ID newest-session fallback, no-active-session disconnected loading, malformed/unknown/stale IDs, proxy prefixes, traversal, request limits, no-auth default, optional token preservation, timeout, and route removal.
- [ ] **Step 2: Run red:** `pnpm vitest run tests/viewer-gateway.spec.ts && node --test ../../browser/novnc-index.test.mjs`; expect missing gateway and missing WebSocket `sessionId` propagation.
- [ ] **Step 3: Implement** Node HTTP static serving plus transparent TCP proxying on `upgrade`. Validate one bounded decoded explicit session ID, otherwise choose the newest live registered session, preserve proxy path/query, enforce timeouts/backpressure, and close connections when their route disappears.
- [ ] **Step 4: Update noVNC** to copy an optional `sessionId` into the WebSocket URL, retain optional `token`/`hideHeader`, and show explicit connection errors. When no session is active, serve the viewer and let its WebSocket remain disconnected.
- [ ] **Step 5: Run gateway and noVNC tests green.**
- [ ] **Step 6: Commit:** `git commit -m "feat(browser): route noVNC by session id"` with Task 4 files.

### Task 5: Replace the global desktop startup with browserd-owned desktops

**Files:**
- Modify: `scripts/byclaw-browser-supervisor.py`
- Modify: `scripts/byclaw-browser-desktop.sh`
- Modify: `docker-entrypoint.sh`
- Modify: `Dockerfile`
- Modify: `Dockerfile.extensions`
- Modify: `scripts/browser-supervisor-verify.py`
- Modify: `scripts/browser-desktop-verify.sh`
- Modify: `scripts/docker-browser-layout-verify.sh`
- Test: `scripts/docker-entrypoint-fd-verify.py`

**Interfaces:**
- Browserd receives viewer mode, noVNC root, gateway address/port, display range, RFB range, and internal websockify range via validated config.
- Root supervisor starts browserd and DSH only; browserd starts all per-session children as `byclaw`.

- [ ] **Step 1: Change static tests first** to require no global `:99` desktop, browserd viewer configuration, only port 8081 exposed, loopback internal ranges, same UID, and subreaper cleanup.
- [ ] **Step 2: Run red:** `python3 scripts/browser-supervisor-verify.py && bash scripts/browser-desktop-verify.sh && bash scripts/docker-browser-layout-verify.sh`; expect current global desktop expectations to fail.
- [ ] **Step 3: Update startup** so browserd owns per-session viewers, the Python supervisor remains the final subreaper, secret FD delivery remains private, and viewer mode `none` opens no viewer listeners.
- [ ] **Step 4: Run green:** the three commands above plus `python3 scripts/docker-entrypoint-fd-verify.py`.
- [ ] **Step 5: Commit:** `git commit -m "feat(browser): start isolated VNC desktops per session"` with Task 5 files.

### Task 6: Documentation and complete verification

**Files:**
- Modify: `plugins/dsh-browser-use/README.md`
- Modify: `plugins/dsh-browser-use/README.zh.md`
- Modify: `docs/superpowers/specs/2026-09-11-browser-tool-optimization-design.md`
- Test: all plugin and root verification files

**Interfaces:**
- Documents both `/?hideHeader=true&sessionId=<encoded>` for exact routing and `/?hideHeader=true` for newest-live-session routing as no-auth URLs.
- Documents optional external proxy token, trusted-network warning, resource cost, limits, lifecycle, and troubleshooting.

- [ ] **Step 1: Update docs** with two simultaneous session examples, percent encoding, omitted-ID newest-session behavior, expired/unknown explicit-ID behavior, no-active-session disconnected behavior, optional proxy token, and compatibility-only `focus`.
- [ ] **Step 2: Run plugin verification:** `cd plugins/dsh-browser-use && pnpm verify`; require all tests, typecheck, and build to exit 0.
- [ ] **Step 3: Run root verification:** `bash scripts/docker-browser-layout-verify.sh`, `python3 scripts/browser-supervisor-verify.py`, `bash scripts/browser-desktop-verify.sh`, `python3 scripts/docker-entrypoint-fd-verify.py`, `node --test browser/novnc-index.test.mjs`, and `git diff --check`; require every command to exit 0.
- [ ] **Step 4: Run Docker integration when available:** build base/business images, open two sessions, connect two noVNC clients by encoded IDs, enter distinct values, and verify independent screens. If Docker is unavailable, report the gap explicitly.
- [ ] **Step 5: Review scope:** `git status --short && git diff --stat && git diff --check`; preserve pre-existing staged and untracked user files.
- [ ] **Step 6: Commit docs:** `git commit -m "docs(browser): describe per-session VNC isolation"` with only Task 6 documentation files.
