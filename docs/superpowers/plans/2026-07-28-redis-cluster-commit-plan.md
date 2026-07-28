# Redis Cluster Commit Plan

## 提交风格结论

当前分支及 `develop` 中与你相关的提交有以下稳定特征：

- 使用 Conventional Commits，但标题保持简短直接。
- 功能按模块拆分，常用 `feat(ByClaw)`、`feat(ByClaw-be)` 风格。
- 测试单独提交，典型提交为 `test(ByClaw): add redis cluster compatibility coverage`。
- 关键兼容性问题单独使用 `fix(...)` 或 `refactor(...)`，中英文标题均有先例。
- 提交时使用精确文件列表，不纳入当前工作区已有的无关未跟踪文件。

当前工作区建议按下面顺序拆分。每个提交都应能独立解释，最后一个业务提交完成后再统一跑全量验证。

## 提交顺序

### 1. `feat(ByClaw): support redis cluster in byai-channel`

**包含文件：**

- `byclaw-exe/extensions/byai-channel/src/redis-compat.ts`
- `byclaw-exe/extensions/byai-channel/src/hooks.ts`
- `byclaw-exe/extensions/byai-channel/src/sdk-app.ts`

**内容：**

- 增加 standalone/Cluster 双模式配置解析和 ioredis 客户端工厂。
- 增加 v1/v2 key 生成、框架 key patch、Cluster 安全关闭。
- 迁移用户信息读取、SDK App、Worker Runner 的 Redis 连接。

**提交前验证：**

```bash
cd byclaw-exe/extensions/byai-channel
pnpm run build
```

### 2. `feat(ByClaw): support redis cluster in baiying-enhance`

**包含文件：**

- `byclaw-exe/extensions/baiying-enhance/src/redis-compat.ts`
- `byclaw-exe/extensions/baiying-enhance/src/backend-service-discovery.ts`
- `byclaw-exe/extensions/baiying-enhance/src/dig-employee-auth-watch.ts`
- `byclaw-exe/extensions/baiying-enhance/src/dig-employee-change-subscriber.ts`
- `byclaw-exe/extensions/baiying-enhance/src/executor/call-agent.ts`
- `byclaw-exe/extensions/baiying-enhance/src/executor/datacloud-mcp-url.ts`
- `byclaw-exe/extensions/baiying-enhance/src/executor/doc-gateway.ts`
- `byclaw-exe/extensions/baiying-enhance/src/executor/doc-redis.ts`
- `byclaw-exe/extensions/baiying-enhance/src/executor/doc-shared.ts`
- `byclaw-exe/extensions/baiying-enhance/src/executor/resource-types/agent.ts`
- `byclaw-exe/extensions/baiying-enhance/src/executor/resource-types/doc.ts`
- `byclaw-exe/extensions/baiying-enhance/src/redis-env.ts`
- `byclaw-exe/extensions/baiying-enhance/src/redis-json-store.ts`

**内容：**

- 迁移服务发现、数字员工监听、DOC、Call Agent、Datacloud、JSON Store 等 Redis 调用。
- raw 和 SDK DOC 路径统一使用 schema-aware control/session key。
- Cluster 下数字员工权限监听使用 poll-only，避免执行不适用的 keyspace notification 配置流程。
- `.env` loader 接受 `REDIS_DB`、`REDIS_MODE`、`REDIS_CLUSTER_HOST`、`REDIS_CLUSTER_NODES`、`REDIS_KEY_SCHEMA_VERSION`。

**提交前验证：**

```bash
cd byclaw-exe/extensions/baiying-enhance
pnpm run build
```

### 3. `test(ByClaw): add redis cluster compatibility coverage`

**包含文件：**

- `byclaw-exe/extensions/byai-channel/src/redis-compat.test.ts`
- `byclaw-exe/extensions/baiying-enhance/src/redis-compat.test.ts`
- `byclaw-exe/extensions/baiying-enhance/src/dig-employee-auth-watch.test.ts`

**覆盖内容：**

- Cluster 节点解析和 standalone 兼容。
- v2 hash-tag key、framework queue/registry patch。
- Cluster 拒绝 v1 schema。
- Cluster 下权限监听降级为 poll-only。
- capability control Stream 使用 v2 key。

**提交前验证：**

```bash
cd byclaw-exe/extensions/byai-channel
pnpm exec vitest run

cd ../baiying-enhance
pnpm exec vitest run src/redis-compat.test.ts src/dig-employee-auth-watch.test.ts
```

### 4. `add redis cluster config 2`

**包含文件：**

- `.env.example`
- `byclaw-be/config/application.properties`

**内容：**

- 增加 `REDIS_CLUSTER_HOST`。
- 保留 standalone 配置并补充 `REDIS_DATABASE`、用户名和密码配置。

### 5. `update gateway.sdk.version to 0.2.10-SNAPSHOT,resolve redis cluster problem`

**包含文件：**

- `byclaw-be/pom.xml`
- `byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/service/SandboxService.java`

**内容：**

- 升级 Gateway SDK 到 `0.2.10-SNAPSHOT`。
- 使用 SDK 的动态 service-discovery key API。

### 6. `fix redis cluster send message problem`

**包含文件：**

- `byclaw-be/src/main/java/com/iwhalecloud/byai/state/config/GatewayClientConfig.java`
- `byclaw-be/src/main/java/com/iwhalecloud/byai/state/config/GatewayDiscoveryConfiguration.java`
- `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/resource/service/ResourceDiscoveryRegistrationService.java`

**内容：**

- 用 `RedisConnectionConfig.fromEnv()` 初始化 SDK singleton。
- 移除重复 Redis bean，确保 Gateway、WorkerRegistry、ServiceRegistry 复用同一连接。
- 资源服务发现清理使用 SDK 生成的 Cluster-compatible key。

### 7. `refactor: 统一Redis Stream监听键生成逻辑并新增单元测试`

**包含文件：**

- `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/service/SessionStreamManager.java`
- `byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/redis/RedisConfiguration.java`
- `byclaw-be/src/main/java/com/iwhalecloud/byai/state/config/RedisSubscriberConfig.java`
- `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/ws/handler/RedisStreamMessageListener.java`
- `byclaw-be/src/test/java/com/iwhalecloud/byai/state/domain/chat/service/SessionStreamManagerKeyTest.java`

**内容：**

- Session Stream key 改由 SDK 生成，覆盖 v1/v2。
- Spring Redis Cluster 写入 ACL username，并避免对 Cluster 执行 standalone database index 设置。
- 更新 Stream 监听相关注释并加入 Java 单元测试。

**提交前验证：**

```bash
JAVA_HOME=/Users/chenxiaofeng/software/jdk-21.0.9.jdk/Contents/Home \
PATH=/Users/chenxiaofeng/software/jdk-21.0.9.jdk/Contents/Home/bin:$PATH \
mvn -B -f byclaw-be/pom.xml -Dtest=SessionStreamManagerKeyTest test
```

### 8. `docs: update redis cluster implementation scope`

**包含文件：**

- `docs/superpowers/specs/2026-07-28-redis-cluster-support-design.md`
- `docs/superpowers/plans/2026-07-28-redis-cluster-support.md`
- `docs/superpowers/plans/2026-07-28-redis-cluster-commit-plan.md`

**内容：**

- 记录当前 `D0.0.5` 实际可应用范围。
- 明确当前分支不包含后续 model-secret resolver，因此只保留适用的 runtime `.env` allowlist 修复。
- 记录 Cluster smoke 和验证限制。

## 最终验证与提交检查

全部提交完成后执行：

```bash
git diff --check

cd byclaw-exe/extensions/byai-channel
pnpm run build
pnpm exec vitest run

cd ../baiying-enhance
pnpm run build
pnpm test

cd ../../..
JAVA_HOME=/Users/chenxiaofeng/software/jdk-21.0.9.jdk/Contents/Home \
PATH=/Users/chenxiaofeng/software/jdk-21.0.9.jdk/Contents/Home/bin:$PATH \
mvn -B -f byclaw-be/pom.xml verify
```

`envs/203/.env` 只用于本地 Cluster PING 烟测，禁止加入任何提交：

```bash
cd byclaw-exe/extensions/baiying-enhance
set -a; . ../../../envs/203/.env; set +a
pnpm exec tsx -e 'import { createRedisCompatClient, closeRedisCompatClient } from "./src/redis-compat.ts"; (async()=>{ const client=createRedisCompatClient({lazyConnect:true,connectTimeout:5000,enableOfflineQueue:false,retryStrategy:()=>null}); client.on("error",()=>{}); try { await client.connect(); console.log(await client.ping()); } finally { await closeRedisCompatClient(client); } })()'
```

提交时只使用本次提交对应的明确文件列表，例如第一笔提交可以执行：

```bash
git add byclaw-exe/extensions/byai-channel/src/redis-compat.ts \
  byclaw-exe/extensions/byai-channel/src/hooks.ts \
  byclaw-exe/extensions/byai-channel/src/sdk-app.ts
git commit -m "feat(ByClaw): support redis cluster in byai-channel"
```

不要使用 `git add .`，也不要纳入当前工作区已有的 `.codegraph/`、`envs/`、报告、HTML 或 ACP 相关未跟踪文件。
