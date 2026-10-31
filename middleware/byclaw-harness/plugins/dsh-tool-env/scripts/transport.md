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
