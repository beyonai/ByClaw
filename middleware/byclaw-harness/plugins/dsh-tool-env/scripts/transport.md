# Private WebSocket SSH transport

`ws-proxy.mjs` takes one argument: a path to an endpoint JSON file containing
`url` and `headers`. `ToolEnvIdentity` atomically writes that file with mode 0600
inside its private state directory. The proxy verifies file ownership and mode,
refuses symlinks, and never prints the URL, headers, or underlying error text.
HTTP readiness and the WebSocket handshake both carry the endpoint headers;
redirects are disabled. Plain TCP SSH configuration requires no transport file.

The proxy uses `ws` streams to propagate binary stream backpressure. Install its
isolated, integrity-locked runtime dependency without changing the DSH closure:

```sh
npm ci --prefix /path/to/dsh-tool-env/scripts --omit=dev --ignore-scripts
```

For an overlay release, ship the built `lib/`, `scripts/ws-proxy.mjs`,
`scripts/package.json`, and `scripts/package-lock.json`, then run that install
inside the image. Never bake endpoint files or credentials into the image.
The plugin package also declares the same exact `ws` version for normal workspace
installation. Local integration tests exercise the actual proxy process and a
loopback authenticated WebSocket server; production ingress still needs E2E.

On MicroVM guests, reserve the system SSH port for the platform. Set B's existing
`BYCLAW_TOOL_ENV_PORT=2222` when system SSH already listens on 22; the WebSocket
bridge still uses `BYCLAW_TOOL_ENV_WS_PORT` and forwards to that tool SSH port.
Keep strict host-key checking enabled: connecting the bridge to system SSH must
fail rather than trusting its different key.

Identity initialization shares one pending operation per canonical directory so
concurrent callers cannot replace keys already published to B. A failed first
SSH connection still schedules idle cleanup of an allocated B. Active agents,
jobs, operations and streams postpone cleanup, and failed releases retry without
replaying the failed tool operation.
Residual checks receive the connection's exact helper path, so package and
workspace installations exclude their own helper while keeping user Node jobs busy.
