# DSH Browser Use

[中文](README.zh.md) | English

`@byclaw/dsh-browser-use` gives the current DSH Agent a bounded, stateful `browser` tool. The Agent remains the only planner: the plugin does not call another model and does not expose Playwright, Chromium, CDP endpoints, browser-process handles, leases, or capabilities to model context.

The container owns one private `browserd` service and at most one Chromium process. Every DSH session can hold at most one leased page, claimed by one Agent; another Agent in that session cannot open or operate a competing window. The Docker default launches persistent Chromium with `${DSH_HOME}/browser/user-data`, so sessions share cookies, localStorage, and extension state while pages, access policies, downloads, and element indexes remain lease-scoped. `browserd`, Chromium, the byCLI daemon, and DSH all run as the runtime account `byclaw`.

## How to use it

A user can ask in natural language:

> Open the release page, inspect the visible releases, and tell me the newest version. Do not submit anything.

The DSH Agent translates that request into calls to the single stateful tool. A typical form workflow is:

```json
{"operation":"open","startUrl":"https://example.test/form","allowedDomains":["example.test"],"allowSubmit":true}
{"operation":"inspect"}
{"operation":"fill","element":3,"value":"Ada"}
{"operation":"click","element":7}
{"operation":"inspect"}
{"operation":"close"}
```

The numeric element indexes come from the latest `open` or `inspect` observation. They are scoped to that private page and are invalidated when the page changes. The model never supplies a lease ID or capability token.

When the next decision needs the resulting page state, prefer `act` with a single action. It returns both the action result and a fresh observation in one tool call, avoiding a separate `inspect`. Choose subsequent dynamic-page targets from that observation, for example `{"operation":"act","actions":[{"kind":"fill","element":3,"value":"Ada","observationId":"latest-observation-id"}]}`.

The Playwright driver reads bounded text, controls, blocking layers, and fingerprints synchronously in one atomic DOM snapshot. A WeakMap in a private JSHandle owns stable node identities; no window properties or DOM attributes publish the registry. ElementHandles are acquired only for action targets. Reordering preserves indexes; replacement and navigation never reuse old indexes. Open shadow-root controls remain discoverable, and custom drivers retain the legacy observation fallback. The private reference is not a separate JavaScript security sandbox.

## Tool contract

The tool name is `browser`. It accepts one operation per call; `act` is the bounded multi-action operation.

| Operation | Fields | Behavior |
| --- | --- | --- |
| `open` | `startUrl?`, `allowedDomains?`, `allowSubmit?` | Acquires the current Agent-session Context, waits briefly for SPA readiness, and returns the first versioned DOM observation. |
| `status` | none | Reports whether the session is open, last URL/title/observation, active policy, remaining idle time, or expiry reason. |
| `focus` | none | Compatibility operation that confirms the caller's independent session desktop is available; noVNC no longer uses it to switch windows. |
| `inspect` | `detail?` (`compact` / `full`) | Defaults to viewport elements/text. `full` expands bounded diagnostics, including hidden/offscreen elements. |
| `scroll` | `deltaY`, `deltaX?`, `element?`, `observationId?` | Scrolls the document, or the nearest scroll container of an observed element. Reports measured displacement; deltas must be finite and within ±10,000 CSS pixels. |
| `navigate` | `url` | Navigates within the allowlist. |
| `click` | `element` | Clicks a current indexed element; direct submit controls require `allowSubmit: true`. |
| `fill` | `element`, `value` | Fills an indexed form control. |
| `select` | `element`, `value` | Selects a value in an indexed select control. |
| `press` | `key` | Sends one safe key. Modifier chords are rejected; Enter and submit-like Space actions require `allowSubmit: true`. |
| `wait` | `milliseconds` | Waits from 0 through 10,000 ms. |
| `waitFor` | one of `selector`, `role`, `text`, `url`, `networkIdle`; `timeout?` | Waits for one declared condition. |
| `act` | `actions` | Executes up to 32 validated actions in order and returns each result plus a final observation. Every item uses `kind` (for example `{"kind":"click","element":7}`), not `operation` or `type`. |
| `screenshot` | `type?`, `fullPage?`, `element?`, `clip?`, `quality?` | Writes PNG/JPEG and returns real pixel dimensions, byte size, SHA-256, and absolute `path`. |
| `close` | none | Immediately closes the Context and releases the private lease. It is safe when no session is open. |

`open` defaults `allowedDomains` to the hostname of `startUrl`. A listed DNS domain also permits its subdomains; an IP entry matches only that exact IP. If both `startUrl` and `allowedDomains` are omitted, the Context opens at `about:blank`; `navigate` returns `browser-navigation-denied` with an explicit instruction to close and reopen with `startUrl` or `allowedDomains`. HTTP(S) only is accepted and embedded credentials are rejected. Explicit navigation, popups, and proxied traffic are allowlist-enforced. If the page passively redirects outside the allowlist, the operation returns a recoverable policy error while retaining the session so the caller can navigate back.

`allowSubmit` defaults to `false`. Set it to `true` only when the user requested the external side effect. Without it, submit buttons, Enter, and focused submit-like Space actions fail closed with `browser-submit-denied`.

Successful results are structured:

```json
{
  "status": "opened",
  "observation": {
    "url": "https://example.test/form",
    "title": "Example form",
    "text": "Name\nSave",
    "elements": [
      {"index": 3, "tag": "input", "name": "Name", "type": "text", "value": "", "disabled": false},
      {"index": 7, "tag": "button", "name": "Save", "type": "submit", "disabled": false}
    ]
  }
}
```

Observations also contain `ready`, `elementCount`, `observationId`, and `blockingLayers`. Elements expose `visible`, `inViewport`, and `covered`, plus checked/selected/read-only/required/multiple/accept/expanded state when applicable. The observation guard fingerprints URL, title, interactive structure/state, visibility, and blocking layers, but deliberately excludes free body-text churn. Action results use `action: { dispatched, changed, textDrift, url?, downloads? }`, where `textDrift` reports body-text changes since inspection without making a valid element index permanently stale.

### Compact observations and scrolling

`open`, `act`, and default `inspect` return at most 200 viewport elements and 6,000 characters of viewport text. Filtering precedes the element cap. Ancestor opacity and overflow clipping, including text ranges in long paragraphs, are considered; this is geometric visibility, not OCR or a guarantee that no overlay covers the text. `omittedElements` counts hidden, offscreen, and capped candidates. Visible scroll containers are indexed with `scrollable: true`, even without a button inside. `inspect` with `detail: "full"` restores up to 200 unfiltered candidates and 16,000 body-text characters for diagnostics; the next default observation is compact again. Custom drivers without atomic snapshots retain their legacy fallback.

Scroll uses bounded native `Element.scrollBy` with instant behavior, not a model-supplied script or synthetic wheel event. An `element` must be observed and currently in the viewport; omitted `element` means the document. `action.scroll` (or `steps[i].action.scroll`) contains `beforeX`, `beforeY`, `afterX`, `afterY`, `deltaX`, and `deltaY`, measured immediately in CSS pixels. Scroll positions participate in the observation guard. Invalid/hidden targets preserve the session and never silently fall back to a different indexed target. Wheel-only custom widgets, canvas, and iframe contents are not covered by this DOM operation.

For capture workflows: take a screenshot, use `act` with one scroll, inspect the returned measured displacement/new observation, then take the next screenshot separately. Zero displacement signals a boundary or an unscrollable target. CSS scroll snap, sticky content, lazy rendering, and device scale can still require image alignment; measured offsets are not a stitched-image guarantee.

### Fewer round trips without a second planner

- Batch only known, already observed targets (maximum 32 actions); use `waitFor` with exactly one condition and `timeout` from 1 to 10,000 ms. Prefer conditions over fixed sleeps.
- `act` already returns an observation. Do not add a redundant `inspect`; new modal/navigation targets must come from a fresh observation, not guessed indexes.
- `observationId` is a per-action guard, not a batch token. Do not reuse an old version after a state-changing step. Split guarded steps into successive `act` calls when the state can change. Never blindly retry a partially executed batch: earlier actions may already have submitted data.
- Example wait batch: `{"operation":"act","actions":[{"kind":"waitFor","text":"Ready","timeout":10000}]}`. Example container scroll (replace 7 with the observed container index): `{"operation":"act","actions":[{"kind":"scroll","element":7,"deltaY":560}]}`. Screenshot is not a batch action.
- Login/send-message templates: observe the current form, resolve current field/button indexes, fill known fields, then click only an authorized submit control and wait for a success condition. Split at dynamic DOM boundaries; do not store credentials or persist indexes as a replay macro.

No JEV dependency or nested model planner is introduced. Existing domain, submit, ownership, and lease checks remain in force. Synthetic observation measurements are in [snapshot-performance.md](docs/snapshot-performance.md); they do not establish end-to-end task/token savings.

Recoverable element/query/input and passive-redirect errors preserve the session. Fatal policy, transport, and runtime failures close it, and `status` retains the close reason. Validation errors identify the invalid field or batch-action index; stable runtime details are bounded and sanitized. Intercepted-click diagnostics include the blocking element when Chromium reports it.

### Downloads

Normal downloads have no plugin-level file-size, count, MIME-type, filename, or completion-time limit. Completed files are reported as `{ name, path, size }` under `BYCLAW_BROWSER_DOWNLOAD_ROOT`. Because browserd and DSH use the same runtime account, private mode-`0600` artifacts are directly readable without a cross-user group bridge.

Downloads are lifecycle-scoped, not persistent artifacts. The runtime removes them when their page, lease, broker connection, or process closes. Read or copy a returned path before calling `close`. Closing or cancelling also aborts active downloads and their upstream connections.

## Isolation and lifecycle

- In Docker-default `shared-novnc` mode, all sessions and byCLI share one headful persistent Chromium/profile and one process-lifetime VNC desktop while retaining separate leased pages and page policies. `none` keeps the same shared profile without VNC. Legacy `novnc` keeps one ephemeral Chromium/X/VNC stack per active session.
- Claims are keyed server-side by DSH session ID. The first Agent owns that session's sole Context until lifecycle cleanup; competing Agents receive `browser-session-owned-by-another-agent`. Turn boundaries do not destroy the Context.
- Calls for the claimed session are serialized in one FIFO lane. Different sessions sharing one broker socket execute concurrently in separate lanes up to `maxContexts`; excess sessions enter a bounded FIFO queue.
- Tool cancellation sends an authenticated broker control frame. `close`, cancellation, disconnect, and shutdown bypass a stalled business lane, abort the active operation, and close only the authorized Context.
- `close`, Agent/session disposal, active-operation cancellation, lease timeout, broker disconnect, and plugin shutdown close the Context and its resources.
- In `shared-novnc`, lease expiry removes only that lease's pages; Chromium, the extension bridge, and VNC remain until browserd shuts down. In `none`, shared headless Chromium remains warm for `BYCLAW_BROWSER_IDLE_MS`; in legacy `novnc`, each dedicated browser/desktop is removed with its lease.

## Configuration

### DSH profile

The bundled `cordis.patch.yml` registers this row:

```yaml
- id: byclaw-browser-use
  name: '@byclaw/dsh-browser-use'
  config:
    maxContexts: 4
    maxQueue: 32
    idleBrowserMs: 30000
    leaseTimeoutMs: 900000
```

| Field | Default | Meaning |
| --- | ---: | --- |
| `maxContexts` | `4` | Maximum concurrent session leases; in `novnc` mode this also caps independent Chromium/X/VNC desktops. |
| `maxQueue` | `32` | Maximum waiting sessions before `browser-queue-full`. |
| `leaseTimeoutMs` | `900000` | Idle timeout for an Agent-session lease. Active operations suspend expiry; completion restarts the full idle window. |
| `idleBrowserMs` | `30000` | Profile compatibility/default declaration. In the split broker deployment, process idle shutdown is controlled by `BYCLAW_BROWSER_IDLE_MS`. |

### Runtime and viewer

| Variable | Docker default | Meaning |
| --- | --- | --- |
| `BYCLAW_BROWSER_SOCKET` | `/run/byclaw-browser/browserd.sock` | Private Unix socket used by DSH and `browserd`. |
| `BYCLAW_BROWSER_DOWNLOAD_ROOT` | `/run/byclaw-browser/downloads` | Ephemeral download delivery root. |
| `BYCLAW_BROWSER_SCREENSHOT_ROOT` | `/run/byclaw-browser/screenshots` | Screenshot delivery root; files survive session close and are removed with the container runtime. |
| `BYCLAW_BROWSER_IDLE_MS` | `30000` | Chromium warm-idle window in `none`; ignored by process-owned `shared-novnc`. |
| `BYCLI_BROWSER_IDLE_TIMEOUT` | `900` | byCLI raw-browser lease idle timeout in seconds; each command renews it. |
| `BYCLAW_BROWSER_EXECUTABLE_PATH` | `/usr/local/bin/byclaw-playwright-chromium` | Existing base-image Playwright Chromium executable. |
| `BYCLAW_BROWSER_USER_DATA_DIR` | `${DSH_HOME}/browser/user-data` | Global persistent profile for `shared-novnc` and `none`; every session and byCLI share its login state. |
| `BYCLAW_BROWSER_EXTENSIONS` | bundled byCLI extension directory | Platform-delimited unpacked-extension paths; invalid paths are warned about and skipped. |
| `BYCLAW_BYCLI_ENABLED` | `true` | Makes the supervisor start and monitor the byCLI daemon/extension bridge. |
| `BYCLAW_BROWSER_VIEWER` | `shared-novnc` | One persistent browser and stable VNC desktop. `none` disables VNC; legacy `novnc` creates isolated per-session desktops. |
| `BYCLAW_BROWSER_XVFB_SCREEN` | `1365x768x24` | Xvfb width, height, and color depth; headed VNC Chromium windows use the same width and height. |
| `BYCLAW_BROWSER_SESSION_RUNTIME_ROOT` | `/run/byclaw-browser/sessions` | Private desktop runtime root; one process-lifetime entry is used by `shared-novnc`. |
| `BYCLAW_BROWSER_DISPLAY_RANGE` | `100-199` | Per-session X display allocation range. |
| `BYCLAW_BROWSER_RFB_PORT_RANGE` | `5901-6000` | Per-session raw VNC ports, bound only to loopback. |
| `BYCLAW_BROWSER_WEBSOCKIFY_PORT_RANGE` | `6101-6200` | Per-session internal websockify ports, bound only to loopback. |
| `BYCLAW_BROWSER_VNC_WEB_PORT` | `8081` | Unified noVNC gateway routed by `sessionId`. |
| `BYCLAW_BROWSER_VNC_WEB_LISTEN_ADDRESS` | `0.0.0.0` | Viewer gateway. Authentication is disabled by default, so restrict access or place it behind a proxy. |

The root supervisor creates private runtime directories, takes an exclusive advisory lock on the persistent Chromium profile, then launches the byCLI daemon and browserd as `byclaw`. While that lock is held, browserd removes Chromium singleton files left by an unclean container exit before each launch; a second container targeting the same profile fails closed instead of deleting a live owner's files. In `shared-novnc`, each Chromium launch loads the local extension directory without installing updates. After the extension connects, the supervisor runs `bycli doctor --json` and requires `extensionBuildVerified: true`, `uploadReady: true`, `dialog-policy-v1`, and working connectivity. On-demand mode marks the browser ready only after this check on first use; eager mode starts DSH only after verification. At runtime the bridge is checked passively every 30 seconds: one failure is tolerated, two consecutive failures restart the daemon and wait for reconnection, and an unrecoverable timeout exits the container nonzero for the orchestrator to restart. Browserd also relaunches an unexpectedly disconnected process-owned Chromium with 0.5–5 second backoff and the same persistent profile. Startup failures retain a bounded, single-line version of Playwright's original error. The random broker secret is delivered to browserd and DSH over separate private inherited descriptors.

In `shared-novnc`, use `http://HOST:8081/?hideHeader=true&sessionId=shared`; omitting `sessionId` redirects to that stable route. The route and desktop survive individual lease closure. The Browser tool operates the persistent Context through the broker, while byCLI operates pages through the extension loaded into that same Chromium, so navigation, clicks, and typing from either tool are visible on this VNC desktop. byCLI must not launch a separate browser or profile. Legacy `novnc` still routes independent desktops by their encoded DSH session IDs. An outer Sandbox proxy token may be preserved as `?token=TOKEN&...`, but browserd does not validate it by default. Anyone who can reach 8081 can control the shared desktop, so production deployments must restrict the entry point.

Headed VNC contexts use Chromium's native viewport. Browserd requests an outer window at `(0, 0)` with the Xvfb screen dimensions, then verifies through CDP that the returned window is normal, has positive dimensions, and fits entirely inside the desktop. Chromium can return slightly smaller bounds without a window manager; a fully visible window is valid and need not fill the desktop exactly. Startup windows and later pages opened by the Browser tool or the byCLI extension are checked, including after a lease reuses the persistent browser. Each new page checks its window again, correcting external resizing or repositioning that clips it; fully visible bounds need no update, and concurrent pages in the same window share one active correction. Maximized, minimized, and fullscreen windows are restored to normal before bounds are set. Target readiness retries are bounded, and geometry listeners and pending retries stop when the context closes. Startup or Browser-tool window sizing failures reject the operation; later extension-window failures log `browser-window-normalization-failed` with bounded error detail. Headless and non-VNC contexts retain their existing viewport behavior.

## Install and run from DSH source

This plugin changes no DSH source file. Build it against the same DSH checkout that will run it:

```sh
cd /path/to/byclaw-dsh/plugins/dsh-browser-use
DSH_ROOT=/path/to/deepseek-harness pnpm install --frozen-lockfile
DSH_ROOT=/path/to/deepseek-harness pnpm verify

cd /path/to/deepseek-harness
test_dsh_home="$(mktemp -d)"
DSH_HOME="$test_dsh_home" pnpm dsh plugin --profile web add \
  /path/to/byclaw-dsh/plugins/dsh-browser-use
DSH_HOME="$test_dsh_home" pnpm dsh --profile web --dump-config
```

The dump must include `id: byclaw-browser-use`. For a manual source run, start the broker and DSH with the same descriptor-delivered secret (the container supervisor performs this safely in production):

```sh
secret="$(openssl rand -hex 32)"
socket_dir="$(mktemp -d)"

BYCLAW_BROWSER_SOCKET="$socket_dir/browserd.sock" \
BYCLAW_BROWSER_EXECUTABLE_PATH=/path/to/chromium \
BYCLAW_BROWSER_SECRET_FD=3 \
node /path/to/byclaw-dsh/plugins/dsh-browser-use/lib/browserd.js \
3< <(printf %s "$secret") &
browserd_pid=$!

cd /path/to/deepseek-harness
set -a
source .env
set +a
DSH_HOME="$test_dsh_home" \
BYCLAW_BROWSER_SOCKET="$socket_dir/browserd.sock" \
BYCLAW_BROWSER_SECRET_FD=3 \
node --import tsx/esm apps/cli/src/bin.ts web --port 8080 --no-open \
3< <(printf %s "$secret")

kill "$browserd_pid"
```

Use an isolated `DSH_HOME` for tests. Do not print `.env` or the secret, and clean up the broker process and socket directory after the run.

## Docker and noVNC

`Dockerfile.base` now installs Xvfb, xauth, x11vnc, noVNC, and websockify in addition to the already pinned Playwright Chromium. Therefore **the base image must be rebuilt** before building the business image; rebuilding only `Dockerfile` against an older base will fail its package and noVNC checks.

```sh
docker build -f Dockerfile.base \
  --build-arg DSH_REF=master \
  -t 10.10.168.203:9080/byclaw/dsh-base:2026.9.8 .
docker build -f Dockerfile \
  --build-arg BASE_IMAGE=10.10.168.203:9080/byclaw/dsh-base:2026.9.8 \
  -t byclaw/dsh:2026.9.8 .
```

The business image reuses the Chromium installed by the base image, bundles the byCLI CLI and extension, and does not download a second browser. Its default `BYCLAW_BROWSER_VIEWER=shared-novnc` starts one X/VNC stack and one persistent Chromium at browserd startup. `none` uses the same global profile without X/VNC. Legacy `novnc` uses an ephemeral profile per independent Chromium/Xvfb/x11vnc/websockify stack.

`EXPOSE 8081` documents the viewer port but does not publish it on the host. Start Docker with `-p 8081:8081` or configure the hosting/Sandbox proxy to forward that port (and restrict it to trusted/authenticated clients). A container-external TCP timeout cannot be repaired by browserd when the platform does not publish the port.

Inside the rebuilt Linux image, the legacy isolated `novnc` mode can run its real two-session RFB acceptance test with `BYCLAW_RUN_VNC_INTEGRATION=1 node /opt/byclaw/dsh-managed/profiles/web/node_modules/@byclaw/dsh-browser-use/scripts/vnc-isolation-integration.mjs`. It opens two desktops, sends different keyboard input through both VNC WebSockets, closes one session, and verifies the other remains connected and unchanged.

The viewer gateway is unauthenticated by default. Restrict port 8081 to a trusted network or an authenticated Sandbox proxy. The custom HTML preserves the proxy path and optional token, supports optional `sessionId`, `hideHeader`, reconnect, scaling, input, and view-only controls. Every passwordless raw VNC and internal websockify target listens only on loopback and must not be published.

## Browser-command policy and its boundary

When `@byclaw/dsh-bash-provider` is installed, known direct `playwright`, `browser-use`, Chrome/Chromium, CDP, remote-debugging, package-runner, and script-loader command shapes are rejected with `DIRECT_BROWSER_ACCESS_DENIED`. Normal project commands and tests that merely mention browser-related filenames remain allowed.

This parser is defense in depth, not a hard security boundary against arbitrary code execution in the same container. A sufficiently novel loader or executable path may bypass command-shape detection, and a same-container process shares the operating-system boundary. If untrusted Agents need a strict guarantee, run `browserd` in a sidecar with a private socket/API, a separate filesystem and process namespace, an allowlisted network, and no browser binary or CDP endpoint in the DSH container.

## Troubleshooting

- `browser-broker-secret-unavailable`: start DSH through `byclaw-dsh-entrypoint` in Docker, or supply the same non-newline secret to broker and DSH through separate inherited descriptors during local development.
- `browser-broker-unavailable` / socket permission errors: confirm `browserd` is running, the socket path matches, and Docker created the private `/run/byclaw-browser` tree for the runtime account `byclaw`.
- Browser launch failure: verify `BYCLAW_BROWSER_EXECUTABLE_PATH` points to an executable Chromium compatible with `playwright-core` 1.62.1. Do not run `playwright install` in the business image.
- No useful visual interpretation: `inspect` is the primary model input and works with text-only models. `screenshot` returns metadata plus a readable artifact path; the caller must explicitly attach or inspect that file when visual interpretation is needed.
- ByClaw resource sync stops at authorization: provide the external Beyond Token/login state required by ByClaw Integration. This is independent of the browser broker.
- Blank or disconnected shared noVNC: verify `BYCLAW_BROWSER_VIEWER=shared-novnc`, open `?sessionId=shared`, and check the process-lifetime Xvfb/x11vnc/websockify children. If container-local access works but host TCP times out, publish `8081` or configure the Sandbox proxy. Preserve its path and optional token.
- A returned download cannot be read: consume it before `close` and verify the download root/directories are private mode `0700`, files are `0600`, and both browser and DSH processes run as `byclaw`.

## Verification status

The package suite covers the Agent-session lifecycle, structured errors, versioned observations, readiness/waits, batch actions, screenshot artifacts, broker isolation, and real Chromium behavior. The Bash policy rejects direct Playwright while permitting ordinary project commands.

The Docker build includes same-runtime-UID artifact permission and subreaper checks. When a Docker daemon is unavailable, the static Docker, noVNC, supervisor, entrypoint, and package checks remain the local verification gates.

### Optional Jev goal execution

`BYCLAW_BROWSER_JEV_ENABLED=false` by default. Enable it on both the Worker and browserd to expose `browser.runGoal` and `browser.goalControl`. It shares `BYCLAW_JEV_*` with the routers; field text reuses the calling session’s resolved provider/model and existing credentials through ByClaw integration, with no separate model configuration. Each goal snapshots the actual request route (including the result of Auto routing), without rerouting or attaching tools. The goal loop is bounded, checks semantic page state and control generations before actions, and never replays uncertain mutations. `reported_done` is a model claim; `verified` only checks supplied page predicates. See [configuration, controls, logs and limitations](README.zh.md#jev-目标执行默认关闭). Tool descriptions use concise Chinese to match the repository's business tool convention; this does not imply provider compatibility.

## Browser in the tool environment (slim deployment)

`workspaceOnToolEnvironment: true` (`BYCLAW_BROWSER_ON_TOOL_ENV=1`) runs browserd through the context's SSH subprocess provider. This branch takes precedence over `ownsRuntime`, including multi-host contexts. It is off by default, preserving existing local deployments.

When B runs the browser supervisor (the `tools` entrypoint of the full tool image, `Dockerfile.tools`), the bridge attaches to that browser instead of starting one: the user's own sandbox had one Chromium with the byCLI extension, one profile and one desktop, and so does B. The bridge triggers on-demand startup through the supervisor's socket (`BYCLAW_BROWSER_SOCKET`), reads the broker secret from the file the supervisor leaves next to it (`broker.secret`, readable by the browser user only; `BYCLAW_BROWSER_SECRET_FILE` overrides the path; commands on B run as that user too, so they can drive the user's own browser directly, which stays within that user's sandbox), and forwards A's frames after checking A's secret and substituting the supervisor's. The desktop is the supervisor's shared noVNC on 8081 (B's `vnc` instance) and the byCLI daemon listens on 19825 (B's `bycli` instance); the viewer settings below do not apply.

Without a supervisor on B (the slim tool image), the bridge starts a browser of its own. Screenshots and downloads live in B; goal downloads are copied within B. Native browser sessions use port 8082 by default and have a separate profile from byCLI on B:8081. Configure `BYCLAW_TOOL_BROWSER_VIEWER` / `BYCLAW_TOOL_BROWSER_VIEWER_PORT` for the desktop. Disconnects never replay actions; idle bridges with no leases or pending requests exit to release SSH activity. A/B must use paired artifacts. See [the slim build and deployment guide](../../README.slim.md).
