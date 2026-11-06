# Scoped desktop ingress

`getSandboxInfo` projects only header-protected noVNC endpoints into these same-origin paths:

- `/sandbox/desktop/exclusive/{sandboxId}/{instance}/`
- `/sandbox/desktop/shared/{mappingId}/{sandboxId}/{instance}/`

The configured servlet context path is prepended. SSH and header-free public endpoints keep their existing URLs. The internal `SandboxService` metadata remains raw so runtime SSH callers continue to use provider endpoints.

Desktop resources use `SandboxService.sandboxInfo(userCode, sandboxId)`. Remote mode passes the optional exact identity through the existing Platform `business/info` operation; local mode filters before endpoint hydration. Shared-context projection still runs before the final ID filter, preserving shared overrides and mapping authorization. A warm selected desktop therefore does not prepare unrelated unknown instances on every asset or `/goal` poll. Calls without the optional ID keep the full-directory behavior.

An original HTML entry such as `/desktop/vnc.html` is projected into the identity URL and redirected, after authorization, to that same desktop's `/index.html`. A directory URL without its final slash is also redirected to the slash form. Only viewer query parameters are retained, including `sessionId`. The unmodified canonical page strips `/index.html` when constructing `/goal` and `/websockify`; the server maps its fixed relative imports. Unicode and internal spaces in instance names are percent-encoded. Decoded path separators, control characters, leading/trailing whitespace and the single `.`/`..` segments are rejected in identities.

Each HTTP resource request and WebSocket handshake requires an authenticated browser Session. Its `USER_CODE` and enterprise must match the current login; URL parameters never select a tenant. The current sandbox directory remains the resource authority, including valid legacy Sessions without separate tenant-membership records. Targets are selected from that user's current directory using exact sandbox ID, instance and shared mapping ID. Exclusive records must still be `RUNNING`. An instance must declare `viewer=novnc` or use an established legacy `vnc`/`desktop` name. Client-supplied hosts and upstream URLs are never accepted.

The same-origin page is a trusted application component. A sandbox owner can replace files or service responses in the VM, so forwarding its HTML or JavaScript would grant that code application-origin access through the iframe. The controller returns only application-owned classpath assets under `desktop-viewer/v1/`. Public `/index.html` reads `novnc-index.html`, `/connection-bridge.js` reads `connection-bridge.mjs`, and the module paths come from the packaged `manifest.json`. At startup the controller validates the manifest schema, bounded module list, exact `core/` or `vendor/` JavaScript paths, entry, file sizes and SHA-256 hashes, then caches an immutable lookup map. Requests cannot supply or extend this list. Unknown resources, licenses and the manifest itself are not public HTTP assets. Missing or mismatched modules prevent startup.

The original `/rfb.js` URL redirects, after authorization, to the same desktop's `/core/rfb.js`. This makes the original ESM file's relative imports resolve from its canonical `core/` location. Directory entries use the canonical page, and other legal HTML basenames redirect to `/index.html`. GET/HEAD are supported. Authenticated assets remain private/no-store, inline and nosniff; sandbox files are never consulted for page or module content.

Maven copies `middleware/byclaw-harness/browser/novnc-index.html`, `middleware/builtin/runtime-tools/browser-viewer/connection-bridge.mjs`, and the fixed image-derived assets in `middleware/byclaw-harness/browser/desktop-viewer/v1/` directly into the JAR, without filtering, renaming or source transforms. The vendor directory is beside the canonical HTML; there are no backend source copies. Building requires the complete repository layout and fails during `validate` if the page, bridge or `core/rfb.js` is missing. The JAR does not need the repository, source image, Docker daemon or sandbox filesystem at runtime. Normal Maven builds package the already extracted assets; they do not invoke Node, Docker, npm or a download. CI backend path filters include the page, bridge and desktop-viewer directory. All viewer resources are under a private classpath location, outside default static-resource handlers.

The sandbox images already provide `/opt/byclaw/novnc/core/rfb.js` and its noVNC dependency tree. The asset-preparation tool now reuses those original ESM bytes from a fixed, inspected image, with the original license records, rather than rebuilding the npm CommonJS package. The approved source is `192.168.0.81:8080/byclaw/byclaw-harness@sha256:1868e6a58ca1efce6b01740dd88439bc77e6d739a4afa82885b7dd3ef197446f`, platform `linux/amd64`, Debian package `novnc 1:1.6.0-2`. Its RFB static dependency closure has 52 JavaScript files in `core/` and `vendor/`. The extraction does not start the source container or read a running sandbox. Runtime script content remains fixed by the application release.

Only GET and same-origin POST to the exact `/goal` suffix reach the upstream HTTP endpoint. POST still requires `X-Browser-Goal-Control: 1`. The response must be an `application/json` object, complete with no trailing tokens, at most 1 MiB. It is parsed and serialized before returning; HTML, JavaScript, oversized data, and all redirects become a generic JSON error. Upstream HTTP error statuses retain their status with a generic JSON body, preserving unavailable-goal and control-error behavior. No upstream response headers, cookies, Location, or error text are copied. All goal responses use `application/json`, `X-Content-Type-Options: nosniff`, and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox`.

WebSocket upgrades remain limited to `/websockify`. Goal HTTP and WebSocket transports inject provider headers on the server and never copy the browser's Cookie, Beyond-Token, or Authorization header to the cloud. The original OpenClaw route retains its existing separate forwarding behavior; there is no general desktop HTTP passthrough API.

WebSocket and goal POST require a valid HTTP(S) Origin. `Sec-Fetch-Site: same-origin` preserves the browser's same-origin check through ingress proxies that rewrite Host or omit its public port. Other supplied fetch-site values are rejected, including origins otherwise present in the configured allowlist. Clients without Fetch Metadata must match either the servlet request's scheme/host/port or an exact server-configured trusted origin. This code does not trust arbitrary Forwarded or X-Forwarded headers and never learns trusted origins from a request.

The service directly reads `sandbox.desktop.allowed-origins`, falling back to `SANDBOX_DESKTOP_ALLOWED_ORIGINS` and then an empty list. The uppercase key works in the backend environment and in the local `.env` loaded into JVM system properties; neither application-properties file needs a duplicate mapping. It is an optional comma-separated list of full HTTP(S) origins, with exact scheme, hostname and effective port; default HTTP/HTTPS ports are normalized. Paths (including a trailing slash), credentials, queries, fragments and wildcards are not allowed. Invalid configuration prevents startup. An empty list preserves the original strict request-authority fallback. This setting is limited to desktop ingress and does not change global CORS, artifact-preview domains, Session validation or sandbox authorization.

Leave `SANDBOX_DESKTOP_ALLOWED_ORIGINS` unset or empty by default; do not automatically derive trusted origins from host, ingress or port settings. Configure it only when a deployment needs an explicit trusted-origin fallback, for example `SANDBOX_DESKTOP_ALLOWED_ORIGINS=https://chat.example.com`. Add only frontend origins controlled by that deployment, including their actual public ports; local development origins belong only in local configuration. Standalone Compose already passes the root `.env` to the backend; other deployment systems must explicitly supply the variable or property when needed. Restart/recreate the backend after changing it. The original Nginx `/byaiService` location already forwards Cookie and WebSocket Upgrade and inherits the server's long timeouts, so no desktop-specific Nginx block is required. When a proxy loses the public authority and the browser sends no Fetch Metadata, the request remains denied until an explicit trusted origin is configured or the trusted proxy preserves the authority.

The WebSocket mapping explicitly installs the normal authentication and tenant interceptors before resolving an immutable target. Request thread identity is cleared before and after dispatch; asynchronous frame callbacks use only the authorized target. The existing OpenClaw anonymous IP/port route retains its separate behavior and is not used for these desktop URLs.

Desktop sessions allow binary messages up to 2 MiB and text messages up to 64 KiB, overriding the servlet container's smaller defaults without changing limits for other routes. The integration test sends and receives a 256 KiB binary message through a real Tomcat/Spring WebSocket connection; without the scoped binary limit it reproduces close code 1009.

The packaged connection bridge reports real RFB connection events. Updating a sandbox image cannot modify this same-origin viewer. Runtime gateway behavior, provider token expiry, and the sandbox's RFB/goal service remain independent: the proxy does not manufacture a connected state or refresh expired credentials. Platform must hydrate missing endpoint-header observations before returning protected directory entries.

## Image resource extraction and verification

`extract-desktop-viewer.mjs`, `desktop-viewer.lock.json` and `desktop-viewer.test.mjs` are maintained together in `middleware/byclaw-harness/browser/desktop-viewer/`. The extractor maintains only the original reachable ESM modules, licenses and manifest in `v1/`. It does not copy the image's HTML or bridge, bundle modules, install npm dependencies, use esbuild or patch JavaScript. Module dependency parsing uses Node's built-in VM module API; use the flag shown below. Run from the repository root:

```bash
# Extract from the exact lock-pinned image already present on a trusted Docker host.
node --experimental-vm-modules middleware/byclaw-harness/browser/desktop-viewer/extract-desktop-viewer.mjs
# Verify that the existing output matches that fixed image.
node --experimental-vm-modules middleware/byclaw-harness/browser/desktop-viewer/extract-desktop-viewer.mjs --check
# Reproduce/check from the approved, checksum-locked source archive without Docker.
node --experimental-vm-modules middleware/byclaw-harness/browser/desktop-viewer/extract-desktop-viewer.mjs --check --source-archive /path/to/approved-novnc-source.tar.gz
# Verify extraction boundaries, integrity, module closure and actual RFB module loading.
node --experimental-vm-modules --test middleware/byclaw-harness/browser/desktop-viewer/desktop-viewer.test.mjs
```

Prepare the exact source image through the approved domestic-registry release process. Extraction must use the locked digest and platform, not a mutable tag. It uses an unstarted temporary container, disables pulling, copies only fixed image paths, and removes the temporary container afterwards. It never starts the image supervisor, contacts a running VM or falls back to npm, a CDN or another registry.

The offline archive is a controlled extraction artifact whose expected whole-file checksum and size are stored in the repository lock; metadata supplied by an input archive cannot establish trust. This checksum authenticates the approved captured artifact, rather than independently reconstructing the complete OCI manifest/config/layer hash chain. Updating the source image or archive requires a reviewed lock and resource update. Docker inspection identifiers are recorded as observed, without calling an unverified identifier an OCI config-blob digest.

The extractor verifies original file hashes and the complete local ESM dependency closure. Only reachable regular JavaScript files are public assets; remote, missing or escaping imports and unsafe archive paths or links are rejected. No HTML, bridge, arbitrary image files or original HTML alias symlinks are published. The packaged manifest records the image source, module/file hashes and extraction-tool provenance. The backend independently checks each public module's bytes before serving it.

The Debian noVNC copyright record and its referenced MPL-2.0 text come from the same fixed image. Original inline source notices are preserved with the unchanged modules. License records and the manifest are distributed in the JAR, outside the public HTTP asset whitelist.

## Local checks

```bash
rtk proxy mvn -o -B -f byclaw-be/pom.xml -Dtest=SandboxControllerTest,SandboxDesktopProxyTest,SandboxDesktopOriginTest,SandboxDesktopTrustedViewerTest,SandboxDesktopWebSocketTest test
```
