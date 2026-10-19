# Per-session VNC isolation design

## Status and scope

This design replaces the current single shared X11/noVNC desktop with one
independent headed browser desktop per active DSH session. It extends the
browser-tool optimization work without changing the rule that one DSH session
has exactly one browser owner and one usable browser context.

The user-facing viewer URL is:

```text
https://<sandbox-proxy>/proxy/8081/?hideHeader=true&sessionId=<encoded-session-id>
```

`token` remains an optional opaque query parameter for an outer Sandbox proxy:

```text
https://<sandbox-proxy>/proxy/8081/?token=<token>&hideHeader=true&sessionId=<encoded-session-id>
```

Both `sessionId` and `token` are optional. With no `sessionId`, the gateway
redirects to the newest live session; with no live session it serves the viewer
in a disconnected state. The browser viewer does not require or validate a token by default. Anyone who
can reach port 8081 and knows a live session ID can control that session, so the
port must remain inside a trusted network or behind an authenticated proxy. Raw
RFB listeners remain loopback-only and are never published.

## Requirements

- Each active `sessionId` owns a separate X display, Chromium process, browser
  context, x11vnc process, and internal websockify endpoint.
- Two viewers connected to different session IDs see and control different
  desktops concurrently. Opening or operating one session never changes the
  other session's foreground page, keyboard focus, or pointer state.
- The viewer selects a desktop with URL `sessionId`, or deterministically uses
  the newest live session when the parameter is omitted; no `focus` call or
  shared `page.bringToFront()` operation is required.
- The trusted DSH execution context supplies `sessionId` when opening a browser
  lease. Model/tool input cannot override it.
- One Agent claims a DSH session. Competing Agents in that same session remain
  rejected, and operations from the owner remain FIFO-serialized.
- Session close, Agent disposal, idle expiry, browser failure, or browserd
  shutdown terminates the complete per-session process tree and removes its
  viewer route.
- Existing domain, submit, stale-observation, screenshot, download, cancellation,
  and structured-error policies remain in force.
- `maxContexts` becomes the effective maximum number of simultaneous browser
  desktops, because each active lease now owns a Chromium process.

## Considered approaches

### 1. Per-session desktop stack and one routing gateway — selected

Each lease gets its own Xvfb, Chromium, x11vnc, and loopback websockify process.
A single viewer gateway on port 8081 serves noVNC assets and routes each WebSocket
upgrade to the internal websockify endpoint registered for `sessionId`.

This is the only approach that preserves VNC semantics while providing complete
display and input isolation. It costs more memory and processes per active
session, so concurrency and cleanup must be strict.

### 2. Shared display with window focus

Keep one Chromium and one VNC desktop, then call `page.bringToFront()` according
to `sessionId`. This is inexpensive but different sessions still share keyboard,
pointer, clipboard, and foreground state. Concurrent viewers race. It does not
meet the requirement.

### 3. CDP screencast per page

Stream each page through Chrome DevTools Protocol and translate input events.
This could isolate viewers without Xvfb per session, but it is not VNC, changes
input/clipboard behavior, and requires a new streaming protocol and frontend.
It is out of scope.

## Runtime architecture

### Browser session identity

`BrowserSessionController.open` derives the trusted `sessionId` from the Agent
execution context and includes it in the private broker open request. The public
browser tool schema continues to reject `sessionId` input. Browserd maintains a
one-to-one registry:

```text
sessionId -> leaseId -> desktop runtime
```

Duplicate live session IDs, duplicate lease IDs, and attempts to rebind either
identity fail closed. Session IDs are length-bounded and never used directly as
filesystem names. Private runtime directories use a random lease ID or a hash.

### Per-session desktop runtime

Opening a lease performs these steps as the `byclaw` runtime user:

1. Reserve an unused display number and internal loopback ports under the
   browserd manager's serialized allocator.
2. Create `/run/byclaw-browser/sessions/<opaque-lease>/` with mode `0700`.
3. Start Xvfb with `-nolisten tcp` and wait for display readiness.
4. Start x11vnc against that display with `-localhost`, `-shared`, `-forever`,
   and `-nopw`; the RFB port is loopback-only.
5. Start websockify on a loopback-only internal port targeting that RFB port.
6. Launch a dedicated headed Playwright Chromium process with that session's
   `DISPLAY`, then create exactly one browser context and page.
7. Publish the `sessionId` viewer route only after every child is healthy.

If any step fails, startup unwinds in reverse order and the route is never
published. Port/display conflicts are retried from a bounded configured range.
The manager serializes allocation so two opens cannot select the same resources.

The Playwright driver launch contract gains a child environment or display
parameter. BrowserRuntime changes from one shared `#browser` to one browser
instance per lease. A browser disconnect invalidates only its own lease instead
of closing unrelated sessions.

### Viewer gateway

Browserd owns the viewer gateway so the gateway and lease registry have one
authoritative lifecycle. The gateway listens on the configured web address and
port, defaulting to `0.0.0.0:8081`, and provides:

- static noVNC assets for normal HTTP requests;
- a WebSocket upgrade route at the existing relative `websockify` path;
- lookup and routing by the decoded `sessionId` query parameter.

The customized noVNC page carries an optional `sessionId` into the WebSocket
URL. A root request without one redirects to the newest live route when one
exists. It continues to preserve the proxy path, optional `token`,
`hideHeader`, reconnect, scaling, and view-only settings. The gateway ignores
`token`; an outer proxy may consume or validate it.

Responses fail without exposing lease IDs or capabilities:

- malformed `sessionId`: HTTP 400 / viewer error;
- omitted `sessionId`: redirect to newest live session, or disconnected viewer
  when no session exists;
- unknown, starting, expired, or closed session: HTTP 404 / viewer error;
- viewer disabled: HTTP 404;
- desktop startup failure: route remains absent and browser open fails;
- internal target disconnect: close the WebSocket and allow noVNC reconnect only
  while the same live session route still exists.

Static-file handling rejects traversal, encoded traversal, NUL bytes, and files
outside the configured noVNC root. Request/header sizes and session ID lengths
are bounded. Slow or half-open proxy sockets have timeouts and backpressure.

## Lifecycle and process cleanup

Each desktop runtime tracks the exact child process handles it created. Cleanup
is idempotent and proceeds in this order:

1. remove the session route so no new viewer can connect;
2. close existing viewer proxy connections for that session;
3. close the Playwright page, context, and browser process;
4. terminate websockify, x11vnc, and Xvfb with a grace period, then SIGKILL;
5. remove the private runtime directory and release display/port reservations.

The root Python supervisor remains the Linux child subreaper and is the final
safety net for descendants after a browserd crash. The old global desktop stack
is removed from normal startup; viewer infrastructure is now created by
browserd per lease. DSH and all browser/viewer children continue to run with the
same `byclaw` UID/GID/HOME.

## Configuration

Existing viewer configuration is retained where meaningful:

- `BYCLAW_BROWSER_VIEWER=none|novnc` controls whether the gateway and desktop
  children are enabled.
- `BYCLAW_BROWSER_VNC_WEB_PORT=8081` and
  `BYCLAW_BROWSER_VNC_WEB_LISTEN_ADDRESS=0.0.0.0` configure the gateway.
- `BYCLAW_BROWSER_VNC_LISTEN_ADDRESS=127.0.0.1` remains restricted to loopback.
- `BYCLAW_BROWSER_XVFB_SCREEN=1365x768x24` applies to every session display.
- new bounded display, RFB-port, and internal-websockify-port ranges support
  deterministic allocation and collision retry.
- authentication mode defaults to `none`; no token is required by browserd.

The Docker image still exposes only 8081. Per-session RFB and websockify ports
are internal loopback listeners and are not declared with `EXPOSE`.

## Compatibility

The `browser {"operation":"focus"}` branch can remain temporarily as a
compatibility no-op that confirms the caller's desktop exists, but it no longer
selects a shared display. Documentation marks URL `sessionId` as the viewer
selection mechanism. Removing the branch can be a later breaking change.

Existing `status` output remains compatible. Viewer details are not returned to
the model, preventing internal ports or runtime paths from leaking into prompts.
Host integration may construct the public viewer URL from its known session ID
and Sandbox proxy base URL.

## Verification

Implementation follows test-first development and adds:

- controller/protocol tests proving trusted session ID propagation and schema
  rejection of caller-supplied session IDs;
- desktop-manager tests for unique resources, bounded allocation, partial-start
  rollback, per-session browser disconnect, and idempotent cleanup;
- gateway tests proving two simultaneous session IDs route to different fake RFB
  backends and never exchange bytes;
- noVNC tests for optional/encoded `sessionId`, deterministic default routing, proxy-path preservation,
  optional-token preservation, reconnect, and visible unknown-session errors;
- lifecycle tests for close, timeout, cancellation, Agent/session disposal, and
  browserd shutdown with no surviving child or route;
- same-UID and private-permission verification for every per-session runtime;
- Linux/Docker integration tests that open two sessions, type different values
  through their VNC connections, and verify both screens and pages remain
  independent;
- the existing full plugin suite, TypeScript build, Docker static checks,
  supervisor checks, noVNC tests, and `git diff --check`.

Docker-only process/display tests must run in the image build or CI because the
host development environment may not provide Xvfb, x11vnc, or Docker.

## Acceptance criteria

1. Opening session A and session B produces different Chromium PIDs, X displays,
   RFB targets, and viewer routes.
2. Two noVNC clients connected concurrently with A and B remain attached to
   their own sessions while both users and Agents interact.
3. A viewer URL without a token works by default; a supplied proxy token remains
   intact in HTTP and WebSocket URLs but is not interpreted by browserd.
4. Closing or expiring A disconnects A's viewer and removes all A processes
   without affecting B.
5. An omitted session ID resolves only to the newest live session; a malformed
   or stale explicit ID never attaches to a fallback desktop.
6. No raw VNC listener is reachable outside loopback, and no session runtime
   artifact is readable by a different UID.
7. All existing browser policy and ownership tests remain green.
