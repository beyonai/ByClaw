# Redis Cluster Support Design

**Date:** 2026-07-28

**Goal:** Add Redis Cluster support to the current `D0.0.5` branch while preserving standalone Redis behavior in `byclaw-be` and the active `byclaw-exe` extensions.

## Scope

The implementation is limited to the Redis topology and key-compatibility path. It does not merge the full `develop` branch and does not introduce the later ACP/shared extension refactor, which is not present in the current branch's tracked product scope.

The BE changes cover environment/application configuration, Gateway SDK initialization, service discovery cleanup, and session Stream key generation. The EXE changes cover `byai-channel` and `baiying-enhance`, including their Redis clients, framework key patching, pub/sub and Stream access, JSON storage, model-secret child-process environment forwarding, and tests.

The migration includes the relevant `develop` history: cluster configuration and SDK upgrades, the Gateway client singleton fix, dynamic session Stream keys, Wonfong's cluster-config return fixes, Stream-key tests, and model-secret Redis environment propagation. Duplicate cherry-pick lines are applied once.

## Design

Redis mode is selected from environment variables. A non-empty `REDIS_CLUSTER_HOST` selects Cluster mode unless `REDIS_MODE=standalone` explicitly overrides it. Cluster nodes are parsed from comma-separated `host:port` values. Standalone mode continues to use `REDIS_HOST`, `REDIS_PORT`, `REDIS_DATABASE`/`REDIS_DB`, username, and password.

Cluster clients use `ioredis` `Cluster`; standalone clients use `ioredis` `Redis`. Both expose the same compatibility type and a safe close helper. Cluster mode requires `REDIS_KEY_SCHEMA_VERSION=v2`, and the compatibility layer supplies v2 key names with Redis hash tags so multi-key operations remain in one slot. Existing v1 key behavior remains available for standalone deployments.

The framework Redis key functions/constants are patched at the extension boundary before framework clients are created. BE session listeners call the Gateway SDK key generator instead of hard-coding a v1 key. BE Gateway and discovery beans share the SDK's `RedisClient.init(RedisConnectionConfig.fromEnv())` singleton so both paths understand cluster configuration.

The model secret resolver is a child process, so all Redis topology variables are explicitly included in its `passEnv` list.

## Error handling

Invalid cluster node syntax, an empty cluster node list in explicit cluster mode, an invalid key schema version, and cluster mode without v2 keys fail fast. Missing or invalid standalone settings preserve the existing disabled/fallback behavior of optional EXE Redis features. Redis close failures fall back to disconnect and do not mask the original operation error.

## Verification

Tests cover cluster and standalone configuration parsing, v2 key generation and framework patching, session Stream key generation for v1/v2, secret-resolver environment propagation, and optional real-cluster smoke coverage. Verification runs the focused EXE Vitest suites and the BE Maven test/verify commands that are practical for the current environment.
