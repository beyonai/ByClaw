# Redis configuration and verification

Tenant Node shares the platform Redis settings and the `@byclaw/by-framework`
connection factory. Both the application connection and the 17 independent stream
readers use this factory.

- Standalone defaults to `REDIS_MODE=standalone` and requires `REDIS_HOST`.
  `REDIS_PORT` defaults to 6379 and `REDIS_DATABASE` defaults to 0.
- `REDIS_CLUSTER_HOST=host:port,host:port` selects Cluster, taking precedence over
  `REDIS_MODE`. A standalone host is unnecessary in this case. As in the SDK,
  this setting implies key schema v2 unless explicitly overridden.
- Explicit `REDIS_MODE=cluster` also accepts the SDK's legacy
  `REDIS_CLUSTER_NODES` list, but requires `REDIS_KEY_SCHEMA_VERSION=v2`.
- Cluster requires database 0 and schema v2. Invalid modes, node endpoints,
  database numbers, and incompatible schema versions fail during configuration.
- Both modes use `REDIS_USERNAME`, `REDIS_PASSWORD`, and `REDIS_TLS=true|false`.
  Configure these common settings in the process environment. No tenant-specific
  Redis variables are needed.

Existing tenant hashes, stream names, hash tags, lease ownership checks, TTLs,
and consumer group semantics are preserved. Each renewable coordination lease
uses a single hash key, and all Lua key access is supplied through `KEYS`.

Run `pnpm exec vitest run test/redis-topology.test.ts` from `byclaw-tenant-node/`.
It requires local `redis-server` and `redis-cli`, starts an authenticated standalone
server and a six-node Cluster (three masters and three replicas) on disposable
loopback ports, and removes their processes and temporary data afterward. It
covers renewable Lua lease TTL and ownership loss, tenant configuration HMGET,
all 17 stream consumer groups with read/ack, SDK service discovery, and worker
registration/heartbeat/withdrawal. It does not contact deployment Redis. TLS and
node-failure/failover behavior require separate deployment verification.
