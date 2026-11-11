# Application preview from a coding sandbox

Codex, Nginx and the existing SSH/browser transport belong to the coding image.
Application templates are optional project inputs, not sandbox identities. Start
only the application the user requested; sandbox startup never initializes a project.

## Templates

Use `sandbox-template list` to discover bundled templates and their source versions,
environment requirements, initialization and start commands. Then explicitly run:

```bash
sandbox-template init easel
sandbox-template run easel -- web --port 7860
```

The second command runs in the foreground. To launch through `sandbox_exec` without
holding the tool call, use a detached process and redirect all standard streams:

```python
import subprocess
log = open('/var/cache/easel/web.log', 'ab')
p = subprocess.Popen(
    ['sandbox-template', 'run', 'easel', '--', 'web', '--port', '7860'],
    stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
print(p.pid)
```

Read the template's instructions before installing dependencies. Source, lockfiles
and outputs belong in persistent workspace storage; disposable dependencies and
caches should stay on instance-local storage. Never overwrite an existing project
to upgrade its template. A bundled environment is not a persistent running service.

## Exposing an application

Use the existing `sandbox_exec` lease; no new tool or openUrl field is needed.
After the application is ready, run:

```bash
sandbox-app expose --name my-app --port 7860 --sandbox-id <current-lease-sandboxId>
```

A template may specify an explicit compatibility profile, e.g. `--profile easel`.
Profiles come from image-owned template files, not from user project directories.
The app name does not select compatibility behavior. Present the returned JSON
`url` only after checking the page and its assets/API. `sandbox-app list` checks
registered application readiness. `sandbox-app remove --name my-app` removes only
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
