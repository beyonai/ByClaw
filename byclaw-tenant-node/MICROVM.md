# MicroVM tenant deployment

Tenant PostgreSQL and Tenant Node can run on MicroVM with AgenticFS. Update the
ByClaw backend, Platform and `byclaw-tenant-node` image together. The PostgreSQL
image is unchanged: Platform installs its bounded binary WebSocket bridge at
sandbox startup. Rebuild the Tenant Node image so it contains the updated pg
transport and common Redis factory.

## Port entry points

Each `spec_json.ports` object accepts optional `exposure: "private" | "public"`.
This selects the returned/used entry point; it does not disable the cloud's other
entry point or remove authentication. Missing exposure preserves legacy behavior.
Tenant-owned database and Node ports require private access. New/recreated
sandboxes use the current effective port spec.

```json
{"ports":[{"port":5432,"instance":"opengauss","protocol":"tcp","exposure":"private"}]}
```

Platform returns the private HTTPS gateway for the PostgreSQL bridge. Backend
JDBC and Node pg adapt its binary stream to normal PostgreSQL connections. The
Node retains its TypeORM/pg pool (maximum eight connections), transactions,
independent verification connections and credential checks. Gateway tokens are
retrieved through the existing authenticated credential operation and kept in
memory; they are not stored in tenant_config, Redis snapshots or image metadata.
A failed pool refreshes credentials before reconnecting even if authority fields
have not changed.

The runtime host and cloud tenant must be able to reach the private sandbox
entry point. `BYCLAW_TENANT_BE_INTERNAL_URL` must resolve to the BE internal API
inside the VPC. Redis uses the same existing `REDIS_*` environment configuration
as the other services; there are no tenant-specific Redis settings. See
`src/infrastructure/coordination/README.md` for standalone/Cluster rules.

## Validation

Run `pnpm run typecheck`, `pnpm run build` and the focused suites:

```sh
pnpm exec vitest run test/connection.test.ts test/database.test.ts \
  test/private-database-stream.test.ts test/private-database-pool.test.ts \
  test/config.test.ts test/redis-topology.test.ts
```

The pool suite starts a disposable local PostgreSQL and real WS/TCP bridge; the
Redis suite starts an authenticated standalone server and a real six-node
Cluster. The PostgreSQL test skips explicitly if local PostgreSQL tools are
unavailable. These checks do not replace post-deployment VPC, TLS, image startup
and four-stage tenant provisioning acceptance.
