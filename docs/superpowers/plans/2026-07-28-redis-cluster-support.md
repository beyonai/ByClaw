# Redis Cluster Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dual-mode standalone/Redis Cluster support to the current `D0.0.5` BE and EXE code without merging unrelated `develop` work.

**Architecture:** Add one compatibility boundary per active EXE extension that parses Redis topology, creates either an ioredis standalone or cluster client, patches Gateway SDK v2 key functions, and closes clients safely. Configure BE's shared Gateway SDK singleton from `RedisConnectionConfig.fromEnv()` and derive session Stream keys from the SDK so all participants use the same schema.

**Tech Stack:** Java 17/Spring Boot/Maven, TypeScript, ioredis, Vitest, JUnit 5, Gateway SDK `0.2.10-SNAPSHOT`.

## Global Constraints

- Preserve standalone Redis environment behavior.
- Cluster mode is selected by `REDIS_CLUSTER_HOST` unless `REDIS_MODE=standalone` is explicit.
- Cluster mode requires `REDIS_KEY_SCHEMA_VERSION=v2`.
- Do not merge unrelated `develop` changes or add the later ACP/shared refactor.
- Do not modify existing untracked workspace files.

---

### Task 1: BE Redis topology and Gateway SDK wiring

**Files:**
- Modify: `.env.example`
- Modify: `byclaw-be/config/application.properties`
- Modify: `byclaw-be/pom.xml`
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/config/GatewayClientConfig.java`
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/config/GatewayDiscoveryConfiguration.java`
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/service/SandboxService.java`

**Interfaces:**
- Consumes: `RedisConnectionConfig.fromEnv()` and `RedisClient.init(RedisConnectionConfig)` from Gateway SDK `0.2.10-SNAPSHOT`.
- Produces: one shared `RedisClient` bean used by `GatewayClient`, `WorkerRegistry`, and service discovery.

- [ ] **Step 1: Write the failing BE configuration/key tests**

Add the v1/v2 `SessionStreamManagerKeyTest` cases and assertions that the session Stream key comes from the SDK key generator rather than a hard-coded string.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `mvn -B -f byclaw-be/pom.xml -Dtest=SessionStreamManagerKeyTest test`

Expected: the v2 key assertion fails because the current branch still emits the v1 hard-coded key and the current SDK/configuration does not yet support the selected schema.

- [ ] **Step 3: Implement BE configuration and singleton wiring**

Add `REDIS_CLUSTER_HOST`, retain standalone fields, upgrade the Gateway SDK property, initialize the singleton with `RedisConnectionConfig.fromEnv()`, remove the duplicate discovery-specific Redis bean, and use `Constants.RegistryKeys.sdServices()` for cluster-compatible cleanup.

- [ ] **Step 4: Implement SDK-derived session Stream keys**

Replace `SessionStreamManager`'s hard-coded `byai_gateway:session:<id>:data_stream` construction with `Constants.QueueNames.sessionDataStream(sessionId)`. Update subscriber/listener comments and tests to cover v1 and v2.

- [ ] **Step 5: Run focused BE tests**

Run: `mvn -B -f byclaw-be/pom.xml -Dtest=SessionStreamManagerKeyTest test`

Expected: PASS.

### Task 2: `byai-channel` Redis compatibility boundary

**Files:**
- Create: `byclaw-exe/extensions/byai-channel/src/redis-compat.ts`
- Create: `byclaw-exe/extensions/byai-channel/src/redis-compat.test.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/cron.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/hooks.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/sdk-app.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/telemetry/sinks/redis-stats.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/utils.ts`

**Interfaces:**
- Produces: `resolveRedisCompatConfig`, `createRedisCompatClient`, `createByFrameworkRedisClient`, `closeRedisCompatClient`, `RedisCompatKeys`, and `patchByFrameworkRedisKeys`.

- [ ] **Step 1: Write failing compatibility tests**

Test cluster node parsing, standalone parsing, v2 hash-tagged key generation, framework key patching, and rejection of cluster mode with v1 schema.

- [ ] **Step 2: Run the focused Vitest file and verify RED**

Run: `cd byclaw-exe/extensions/byai-channel && pnpm exec vitest run src/redis-compat.test.ts`

Expected: FAIL because `redis-compat.ts` does not exist.

- [ ] **Step 3: Implement the compatibility module**

Implement the dual client factory, v1/v2 key helpers, framework key patching, and safe close fallback.

- [ ] **Step 4: Migrate channel call sites**

Replace direct framework standalone client creation and `quit()` calls in cron, hooks, SDK app, telemetry, and utility paths with the compatibility boundary while keeping existing business behavior unchanged.

- [ ] **Step 5: Run focused channel tests**

Run: `cd byclaw-exe/extensions/byai-channel && pnpm exec vitest run src/redis-compat.test.ts`

Expected: PASS.

### Task 3: `baiying-enhance` Redis compatibility and call sites

**Files:**
- Create: `byclaw-exe/extensions/baiying-enhance/src/redis-compat.ts`
- Create: `byclaw-exe/extensions/baiying-enhance/src/redis-compat.test.ts`
- Create: `byclaw-exe/extensions/baiying-enhance/src/redis-cluster-smoke.test.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/backend-service-discovery.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/dig-employee-auth-watch.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/dig-employee-change-subscriber.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/executor/call-agent.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/executor/datacloud-mcp-url.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/executor/doc-gateway.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/executor/doc-redis.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/executor/doc-shared.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/executor/resource-types/agent.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/executor/resource-types/doc.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/redis-env.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/redis-json-store.ts`

**Interfaces:**
- Consumes: the compatibility API from Task 2 by source-equivalent local implementation.
- Produces: cluster-aware registry, document, JSON-store, pub/sub, and framework event access.

- [ ] **Step 1: Write failing compatibility and document-store tests**

Cover cluster/standalone config, framework key patching, cluster scan behavior, and client cleanup for raw document access.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd byclaw-exe/extensions/baiying-enhance && pnpm exec vitest run src/redis-compat.test.ts src/executor/doc-redis.test.ts src/executor/doc-shared.test.ts`

Expected: FAIL because the compatibility module and cluster-aware call sites are absent.

- [ ] **Step 3: Implement the compatibility module and migrate call sites**

Use the same env semantics and v2 key mapping as `byai-channel`; replace direct Redis construction, `scan` assumptions, and `quit()` calls in the listed paths.

- [ ] **Step 4: Add optional real-cluster smoke coverage**

Keep the smoke test skipped unless `RUN_REDIS_CLUSTER_SMOKE=1`, and cover key/hash, pub/sub, control Stream, and session Stream operations when enabled.

- [ ] **Step 5: Run focused baiying tests**

Run: `cd byclaw-exe/extensions/baiying-enhance && pnpm exec vitest run src/redis-compat.test.ts src/executor/doc-redis.test.ts src/executor/doc-shared.test.ts`

Expected: PASS.

### Task 4: Wonfong's child-process and compatibility fixes

**Files:**
- Modify: `byclaw-exe/extensions/baiying-enhance/src/agent-registry.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/aimodel-config.test.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/redis-compat.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/redis-compat.ts`

- [ ] **Step 1: Write the failing secret environment assertion**

Assert that the generated managed-model secret provider forwards `REDIS_MODE`, `REDIS_CLUSTER_HOST`, `REDIS_KEY_SCHEMA_VERSION`, and `REDIS_DB`.

- [ ] **Step 2: Run the focused model-config test and verify RED**

Run: `cd byclaw-exe/extensions/baiying-enhance && pnpm exec vitest run src/aimodel-config.test.ts`

Expected: FAIL because only standalone Redis variables are forwarded.

- [ ] **Step 3: Forward all Redis topology variables**

Extend the child-process `passEnv` list with the cluster, schema, and DB alias variables.

- [ ] **Step 4: Fix cluster config return behavior**

Return a valid cluster config before standalone host/port validation in both compatibility modules so `REDIS_CLUSTER_HOST` alone does not incorrectly resolve to `null`.

- [ ] **Step 5: Run the focused model/config tests**

Run: `cd byclaw-exe/extensions/baiying-enhance && pnpm exec vitest run src/aimodel-config.test.ts src/redis-compat.test.ts`

Expected: PASS.

### Task 5: Full verification and review

**Files:**
- Modify: only files listed in Tasks 1-4 if verification exposes a scoped defect.

- [ ] **Step 1: Review the diff for scope and secrets**

Run: `git diff --check && git status --short`

Confirm only Redis-related tracked files changed and no credentials or unrelated untracked files are staged.

- [ ] **Step 2: Run BE verification**

Run: `mvn -B -f byclaw-be/pom.xml verify`

Expected: exit code 0, or report any pre-existing/environmental failure with its exact output.

- [ ] **Step 3: Run EXE focused verification**

Run the focused Vitest suites from Tasks 2-4 and the package build/typecheck commands defined by each extension's `package.json`.

- [ ] **Step 4: Re-check requirements against the design**

Verify standalone compatibility, cluster parsing, v2 key slot safety, BE singleton wiring, dynamic Stream keys, child-process env forwarding, tests, and absence of unrelated changes.
