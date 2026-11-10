# Share an application from this sandbox

Use the existing `sandbox_exec` lease. No additional platform tool is needed.

1. Start the application as a detached process, redirecting stdin/stdout/stderr.
   For Easel: `cd /by/Easel && easel web --port 7860 </dev/null >/var/cache/easel/web.log 2>&1 &`.
2. Run `sandbox-app expose --name easel --port 7860 --sandbox-id <sandboxId>`.
   Use the exact `sandboxId` returned by this task's `sandbox_acquire` result.
   The command accepts both the platform `microvm--...--sbx-...` ID and cloud `sbx-...` ID.
3. Read the JSON printed to stdout. Present its `url` as a clickable link only after
   checking the URL and application. `browserReady=false` means the default cloud
   domain may download HTML; a bound custom domain is needed for browser viewing.
4. `sandbox-app list` returns the current instance's routes and live readiness.
   `sandbox-app remove --name easel` removes the route, but does not stop the process.
   To end all application access, also stop the application process.

`BYCLAW_APP_DOMAIN` (or `expose --domain`) is the cloud gateway's bound data-plane
domain, without a scheme or path. `BYCLAW_APP_PORT` defaults to 8082. Nginx forwards
`/a/<random-id>/` to the registered local application port, including WebSocket and
streaming responses. Applications must support a path prefix; Easel's frontend
uses relative assets and a base-path API helper. An Easel-only compatibility rule
fixes the shipped upload-limit request without overwriting editable source.

When using the existing platform Nginx instead of a bound cloud domain, configure
`BYCLAW_APP_PUBLIC_BASE=http://<platform-ip>:8080/sandbox-apps` in the template.
The matching deployment configuration forwards only the instance's 8082 preview
gateway and removes the cloud download header. No extra service or Java proxy is
needed. This first deployment entry strips platform cookies/authorization and is
intended for cookie-independent application previews, including Easel.

Routes live under `/run/byclaw-apps`, not personal persistent storage. They and the
links expire when the instance is destroyed. Task completion can retain compute;
do not call `sandbox_release` unless the user requests destruction.

The template enables anonymous cloud traffic. Links do not require ByClaw login.
The random path is an application locator, not a sandbox-wide access boundary:
the cloud gateway can also reach other listening ports. SSH still requires its
authorized private key. Only share an application's UI with user authorization;
do not expose transport/desktop ports or credentials as application routes.
