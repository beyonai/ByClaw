# Browser Tool Optimization Design

**Requirement source:** `browser-工具优化方案.md` (BRW-OPT-001)

## Scope

This change closes BRW-01 through BRW-12 and removes the browser/DSH Unix-user split. It also adds `status`, `focus`, `waitFor`, and batched `act`. Network logs, tabs, cookies/storage-state persistence, evaluate, recipes, uploads, and popup opt-in remain out of scope.

## Runtime identity and filesystem

The container supervisor continues to start separate `browserd`, desktop-viewer, and DSH processes, but all three run as the runtime account `byclaw`. `/run/byclaw-browser`, its downloads directory, and its screenshots directory are owned by `byclaw:byclaw`. The broker socket remains private and authenticated; process separation and one-time secret FDs remain unchanged. The obsolete `browserd` user, `byclaw-browser` group bridge, and distinct-UID permission test are removed or rewritten as same-runtime-user assertions.

## Session lifecycle

The registry and serialization lane are keyed by `sessionId`, so a context survives turn boundaries while each session has at most one usable Browser Context. The first Agent to open it becomes the claimant; another Agent in the same session receives `browser-session-owned-by-another-agent` and cannot enter the lease queue or operate the context. Turn-stop and turn-end events no longer close session-scoped contexts; explicit `close`, claiming-Agent disposal, session disposal, broker disconnect, controller disposal, fatal error, cancellation of an active operation, and idle expiry still do. Cancelling an operation that is only waiting in the session lane does not close the context. The default idle TTL becomes 15 minutes. Session state records the last URL/title/observation, policy, remaining idle time, and terminal reason.

## Errors

`BrowserRuntimeError` and broker error frames carry a bounded, sanitized detail plus `recoverable`, `fatal`, and session-state semantics. Playwright failures are normalized into stable element visibility, timeout, interception, detached, readonly, and query codes. Explicit fatal metadata takes precedence over fallback code tables. The runtime/controller release a context only for fatal transport/runtime failures and policy violations classified as fatal; argument, element, stale-observation, query, and local submit/key denials preserve it. Tool failures expose machine-readable metadata without exposing secrets or raw unbounded upstream messages.

## Observation and actions

Observations include `ready`, `elementCount`, and `observationId`. Element descriptions use accessible-name precedence and expose checked/mixed, selected value, readonly, required, multiple, accept, and `aria-expanded` state. Indexed actions may carry the observation ID; mismatches fail recoverably as `browser-observation-stale`. Action change detection compares URL and a bounded page-state fingerprint instead of assuming every non-wait action changed the page.

`open` performs a short bounded readiness wait for visible interactive or text content. `waitFor` supports one declared condition among selector, role, text, URL, or network-idle with a bounded timeout. `act` executes a bounded sequence through the same validation and policy gates, returns each step result, stops on the first failure, and returns the final observation after success.

## noVNC session selection

The later per-session VNC isolation design supersedes shared-display focus for `novnc` mode. Each live session now owns a separate Chromium/X/VNC desktop and port 8081 routes by optional URL `sessionId`; `focus` remains only as a compatibility operation. Capabilities and broker secrets never enter noVNC or model output.

## Screenshot delivery

Screenshots are written by `browserd` to the runtime-user-owned screenshots directory and returned as metadata plus an absolute path. PNG dimensions are parsed from IHDR rather than inferred from CSS viewport size. `fullPage`, element, clip, and JPEG quality are validated. Large images bypass the broker frame limit because bytes are not embedded in the response; metadata always remains bounded. Returned paths survive session close so callers can consume them, and are removed when the broker runtime shuts down.

## Compatibility and security

The existing ten operations remain accepted. Domain/subdomain enforcement, HTTP(S)-only navigation, credential rejection, submit controls, network method gate, popup rejection, capability isolation, bounded queues, auditability, one-context-per-session claiming, and cross-session Context isolation remain regression requirements. No script, CDP endpoint, session selector, lease, capability, or broker secret is exposed to the model; selectors are accepted only as narrowly validated `waitFor` conditions.

## Verification

Tests must demonstrate red/green behavior for cross-turn continuity, idle expiry diagnostics, recoverable versus fatal errors, accessible control state, real change detection, stale observations, SPA readiness, `waitFor`, batch execution, screenshot files/dimensions/large-image behavior, and same-UID container supervision. The final gate is package `verify` plus repository browser supervisor, desktop, entrypoint, and Docker-layout checks. A full Docker build is run only when a Docker daemon is available.
