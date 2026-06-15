# ByClaw Browser Bridge

This is a no-build Chrome/Edge MV3 extension for ByClaw conversation-driven ecosystem collection.

After binding from the ByClaw portal, the extension keeps a WebSocket connection to ByClaw, claims pending collection tasks, reuses already signed-in browser tabs when possible, opens the target site when needed, extracts Markdown/HTML/text through the content script, and reports progress/results back to the backend.

## Install Locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this directory:

```text
byclaw-fe/public/browser-extension/byclaw-browser-bridge
```

## Package And Upgrade

From the frontend module:

```bash
pnpm package:browser-extension
```

The script writes:

```text
byclaw-fe/public/download/browser-extension/byclaw-browser-bridge-v{version}.zip
byclaw-fe/public/download/browser-extension/latest.json
```

When `manifest.json` version changes, re-run this script and publish the generated ZIP/static files with the portal. The portal checks the installed extension through `BYCLAW_CAPTURE_PING` and warns when the installed version is below the current minimum supported version.

## Binding Protocol

The ByClaw portal posts this message from the ecosystem collector page:

```js
window.postMessage({
  source: "BYCLAW_PORTAL",
  type: "BYCLAW_CAPTURE_BIND",
  payload: {
    protocolVersion: "1.1",
    portalOrigin: location.origin,
    websocketPath: "/byaiService/ws",
    auth: {
      userCode: localStorage.getItem("uc"),
      headers: {
        "Beyond-Token": "...",
        "SSO-TOKEN": "...",
        "x-session-id": "..."
      }
    },
    captureDefaults: {
      collectMode: "USER_BROWSER_BRIDGE",
      runLocation: "LOCAL",
      ownerType: "personal",
      importTarget: "knowledgeBase",
      knowledgeBaseId: "...",
      knowledgeBaseResourceId: "...",
      knowledgeBaseName: "..."
    }
  }
});
```

The extension replies:

```js
window.postMessage({
  source: "BYCLAW_EXTENSION",
  type: "BYCLAW_CAPTURE_BIND_ACK",
  payload: {
    installed: true,
    version: "0.3.0",
    protocolVersion: "1.1",
    binding: {
      bound: true,
      tokenStatus: "VALID",
      expiresAt: "..."
    },
    bridgeStatus: {
      connected: true
    }
  }
});
```

The portal can also detect installation/status and unbind:

```js
window.postMessage({ source: "BYCLAW_PORTAL", type: "BYCLAW_CAPTURE_PING" });
window.postMessage({ source: "BYCLAW_PORTAL", type: "BYCLAW_CAPTURE_UNBIND" });
```

## Bridge Protocol

The background service worker connects to:

```text
ws(s)://{portal-host}/byaiService/ws?beyond-token=...
```

Client messages use `type: "ECOSYSTEM_BRIDGE"` with `extParams.action`:

- `BIND` / `HEARTBEAT`
- `PULL_TASKS`
- `CLAIM_TASK`
- `RENEW_LEASE`
- `TASK_PROGRESS`
- `TASK_RESULT`
- `TASK_FAILED`
- `TASK_CANCELLED`

Server messages use `type: "ECOSYSTEM_BRIDGE"` with `event`:

- `TASK`
- `TASK_LIST`
- `CLAIM_ACCEPTED`
- `LEASE_RENEWED`
- `CANCEL_TASK`

Tasks use a lease-first flow. The extension must claim a task and receive `leaseId` before executing page commands. Progress, result, failure, cancellation, and renewal messages include `runId`, `bridgeClientId`, and `leaseId`.

## Browser Behavior

- For `open` commands, the extension first searches existing tabs by `allowedHosts` and focuses a matching tab before opening a new one.
- If the target site is not logged in, the content script returns a login-required error; the user should sign in in the browser and retry from ByClaw.
- QQ Mail collection supports keyword search and a best-effort `days` filter for prompts such as "最近 7 天关于发票的邮件".
- Generic page extraction uses `readability-lite.js` and a bounded lazy-load scroll. Complex pagination and heavily dynamic sites still need connector-specific commands.
