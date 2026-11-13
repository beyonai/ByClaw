# Pinned by-framework package

Both business Dockerfiles install `@byclaw/by-framework@1.9.0` from this directory, so an image build needs neither registry access nor a developer checkout. The archive is the official npm release, byte for byte: `artifact.json` records its SHA-256, the registry's `integrity` value and the source tag.

Source: [beyonai/by-framework-ts](https://github.com/beyonai/by-framework-ts), tag `v1.9.0`. Earlier images carried `1.7.0-byclaw.1`, a harness-built 1.7.0 with uncapped dispatch patched in; that change is part of 1.9.0, as is the clean-up of what dead workers leave in Redis (1.8.0), so nothing is patched here any more.

The runner admits messages independently of business task completion. Deprecated `maxConcurrency` and `BYAI_WORKER_CONCURRENCY` no longer limit dispatch. In-flight tracking still drains tasks on shutdown. Stale consumption is unhealthy even when tasks remain unfinished. Node and Redis already use asynchronous I/O; this change removes a scheduling barrier, not a physical resource limit or a new Netty-style transport implementation. Redis polling batches, ACKs, cancellation and per-session ordering remain in place.

## Build and verify

From the **ByClaw repository root**:

```sh
docker build -f middleware/byclaw-harness/Dockerfile -t byclaw-harness:unbounded .
# Dockerfile.extensions has the same integration.
```

`prepare-by-framework.mjs` checks the archive hash and stages a supporting workspace package (not a DSH plugin bundle). Root overrides replace even old `1.6.0` requests. The existing package pipeline packs it into the final managed profile and creates a `file:` override there. Both stages resolve the framework from the integration plugin and run `verify-by-framework-runtime.mjs`: 64 suspended tasks, a later Resume, shutdown drain and stale-consumer health, with legacy limits omitted/1/8/50. The verifier is copied directly into the runtime stage before profile installation; copying it only into an independent tools stage does not make it available in the final image. Both layout and package-route regression checks enforce this stage and ordering requirement. A wrong package or failed assertion stops the image build.

After building, the same probe can run without Redis or model calls:

```sh
docker run --rm --entrypoint sh byclaw-harness:unbounded -c '
  cd /opt/byclaw/dsh-managed/profiles/web
  node /usr/local/lib/byclaw/verify-by-framework-runtime.mjs "$(node -p "require.resolve(\"@byclaw/dsh-integration/package.json\")")"
'
```

The probe uses controlled message-processing callbacks. It establishes package resolution and runner behavior, not Redis Cluster capacity, model throughput or memory safety under unlimited load. Run real business traffic separately.

The local package-route regression test installs a temporary pnpm workspace and a separate packed profile, checks checksum failures and legacy overrides, and also runs the integration plugin's concurrency/health probes:

```sh
node middleware/byclaw-harness/scripts/by-framework-package.test.mjs
```

## Update the artifact

From this directory, with the new version in place of `1.9.0`:

```sh
npm pack @byclaw/by-framework@1.9.0
npm view @byclaw/by-framework@1.9.0 dist.integrity
sha256sum byclaw-by-framework-1.9.0.tgz
```

Check that the archive's SHA-512 (`openssl dgst -sha512 -binary <file> | base64 -w0`, prefixed `sha512-`) equals the registry's `integrity`, then update `artifact.json` and the version in `scripts/prepare-by-framework.mjs`, `scripts/docker-workspace-prepare.mjs`, `scripts/verify-by-framework-runtime.mjs` and `scripts/by-framework-package.test.mjs`, and remove the old archive. Do not edit files inside the archive.
