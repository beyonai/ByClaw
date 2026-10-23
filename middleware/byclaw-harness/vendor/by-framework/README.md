# Harness-owned by-framework package

Both business Dockerfiles install `@byclaw/by-framework@1.7.0-byclaw.1` from this directory. No npm publication or developer checkout is required to build the image. The package includes compiled JavaScript, TypeScript source, tests and the upstream Apache-2.0 license.

Source: [beyonai/by-framework-ts](https://github.com/beyonai/by-framework-ts), commit `e840492139e02439d31859023bde682387d2727d`, based on 1.7.0 (`cdaabf0ab5e5838b881dcef92f182f65d91049e9`). `source.patch` is the readable source/test/documentation delta (zero context; apply with `git apply --unidiff-zero`). `artifact.json` records the package SHA-256 and source commits. The packaging script adds the local version and provenance metadata; it does not change runtime code.

The runner admits messages independently of business task completion. Deprecated `maxConcurrency` and `BYAI_WORKER_CONCURRENCY` no longer limit dispatch. In-flight tracking still drains tasks on shutdown. Stale consumption is unhealthy even when tasks remain unfinished. Node and Redis already use asynchronous I/O; this change removes a scheduling barrier, not a physical resource limit or a new Netty-style transport implementation. Redis polling batches, ACKs, cancellation and per-session ordering remain in place.

## Build and verify

From the **ByClaw repository root**:

```sh
docker build -f middleware/byclaw-harness/Dockerfile -t byclaw-harness:unbounded .
# Dockerfile.extensions has the same integration.
```

`prepare-by-framework.mjs` checks the archive hash and stages a supporting workspace package (not a DSH plugin bundle). Root overrides replace even old `1.6.0` requests. The existing package pipeline packs it into the final managed profile and creates a `file:` override there. Both stages resolve the framework from the integration plugin and run `verify-by-framework-runtime.mjs`: 64 suspended tasks, a later Resume, shutdown drain and stale-consumer health, with legacy limits omitted/1/8/50. A wrong package or failed assertion stops the image build.

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

Install the framework's development dependencies, check out the exact source commit pinned in `scripts/pack-by-framework.mjs`, and keep tracked files clean. With Node 24 and npm available, run from the ByClaw repository root:

```sh
node middleware/byclaw-harness/scripts/pack-by-framework.mjs /path/to/by-framework-ts
```

The script rebuilds the source, packages it, and regenerates the hash and patch. For a new revision, review source changes and tests, update the pinned commits/local version, then regenerate all three artifacts together. Do not manually edit compiled files inside the archive.
