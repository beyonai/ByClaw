# Application preview from a coding sandbox

Codex, Nginx and the existing SSH/browser transport belong to the coding image.
Application source comes from the user's persistent project workspace, not the tool
image. Upload or clone the requested source, inspect its own instructions and
lockfiles, then install its environment and start it explicitly. Sandbox startup
never initializes an application. Source, Git history, lockfiles and outputs belong
in persistent storage; rebuildable dependencies and caches belong on instance-local
storage. Do not depend on application-specific paths from another image.

## Exposing an application

Use the existing `sandbox_exec` lease; no new tool or openUrl field is needed.
After the application is ready, run:

```bash
sandbox-app expose --name my-app --port 7860
```

The platform's tool execution layer supplies `E2B_SANDBOX_ID` from the current
compatible MicroVM lease. Codex and its child commands inherit it automatically;
no instance ID from chat history or the shared Harness host is needed. For manual
execution outside that layer, pass `--sandbox-id <current-lease-sandboxId>`.

Applications must handle their own URL prefix; the gateway does not rewrite
application-specific HTML or scripts. Present the returned JSON `url` only after
checking the page and its assets/API. `sandbox-app list` checks registered
application readiness. `sandbox-app remove --name my-app` removes only
the route; stop the application process separately to end its service.

Nginx listens on BYCLAW_APP_PORT (default 8082) and forwards `/a/<random-id>/` to a
local application port, including WebSocket/streaming responses. Apps must support
a path prefix. Configure BYCLAW_APP_DOMAIN for a bound cloud domain, or configure
BYCLAW_APP_PUBLIC_BASE, e.g. `https://<platform-host>/sandbox-apps`, with the matching
platform Nginx route. The default aliyuncs.com host may download HTML rather than
render it. The platform route removes that download header and strips cookies and
authorization; it does not support cookie-based application login or provide a
separate browser origin. byclaw-middleware keeps its own deploy/config templates;
that deployment source must contain the route too.

Routes live in /run/byclaw-apps and expire when the instance is destroyed. Current
platform policy reclaims instances after about five idle minutes once the last
task lease is returned. Browser requests do not renew tool leases. Do not keep a
tool call running as a workaround or promise permanent hosting. This image does
not change the policy or enable automatic pause/resume.

The example enables anonymous cloud traffic. Links need no ByClaw login. The
random path locates an app; it is not sandbox-wide authorization. The cloud gateway
can reach other listening ports, and SSH still requires its authorized private key.
Do not expose management/desktop ports or credentials as application routes.
