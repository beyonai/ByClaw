# Browser viewer connection bridge

`connection-bridge.mjs` is the shared implementation used by the Harness and
OpenClaw noVNC pages. Images install it next to `index.html` as
`connection-bridge.js` so the existing viewer server supplies JavaScript MIME.
Build images from the repository root; do not copy a second maintained version
into either runtime.

The parent sends the existing `beyond-iframe-payload` envelope with
`data.bridge: {version: 1, channelId}`. The bridge accepts it only from its parent
window and replies to that event's exact origin using
`beyond-iframe-receive-payload`. Messages contain a `type` and a `data` object:

- `connection-observation-reset`: `{version: 1, channelId, attemptId}`.
- `connection-state-change`: the same identity plus `state: 'connected'` or
  `'disconnected'`, and optionally boolean `clean` for a disconnect.

Each new RFB connection increments `attemptId`, clears the previous observation
and emits a reset. Actual RFB connect/disconnect callbacks supply state; obsolete
connection callbacks are ignored. A new parent handshake receives the current
attempt and any observed state, covering connect-before-handshake. Standalone
viewing emits nothing. No credentials or sandbox/business identities are sent.

The reusable frontend `IframeRender` opts in with `connectionBridge`. It checks
the frame window, allowed origin, channel and monotonic attempt; each navigation
rotates its channel and retries the handshake finitely. Its 15-second observation
budget begins at mount. If no valid observation arrives, the parent shows
“连接状态未知” and retains the viewer and an explicit retry. `disconnect` means
the viewing connection ended; it does not establish that a sandbox or process
exited. Closing a viewer only unloads that iframe.

Older viewers can still load without reporting state. Ordinary embedded pages
continue using the existing payload/business message and height envelopes;
redirected frames must declare trusted `allowedOrigins`. Opaque-origin messaging
requires an explicit legacy-only opt-in and cannot enable the connection bridge.

Verification:

```sh
node --test middleware/tests/novnc-connection-bridge.test.mjs middleware/openclaw/novnc-index.test.mjs
python3 -m unittest discover -s middleware/tests -p 'test_shared_builtin.py'
node --test middleware/tests/shared-builtin-portability.test.mjs
bash middleware/byclaw-harness/scripts/docker-browser-layout-verify.sh --dockerfile Dockerfile
bash middleware/byclaw-harness/scripts/docker-browser-layout-verify.sh --dockerfile Dockerfile.extensions
```

The bridge tests execute the actual HTML connection scripts with a controlled
RFB boundary. They do not establish that built images start or that a real RFB
server connects; validate those separately before release.
