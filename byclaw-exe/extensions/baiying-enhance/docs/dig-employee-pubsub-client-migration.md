# OpenClaw baiying-enhance：数字员工 Redis Pub/Sub 消费端说明

本文描述 **baiying-enhance** 插件如何消费与仓库根目录 [dig-employee-redis-change-notify.md](../../../../dig-employee-redis-change-notify.md) 所述一致的 **数字员工变更广播**，并与本机 **用户授权数字员工列表**（Redis Hash）对齐后更新 OpenClaw 托管 agent。

## 代码改造范围

本特性**仅落在 `baiying-enhance` 扩展包内**；不涉及 `byclaw-be` 发布端。具体文件职责如下。

| 范围 | 路径 | 改造内容 |
|------|------|----------|
| 新增 | [src/redis-json-store.ts](../src/redis-json-store.ts) | 统一 Redis JSON 读取层：`DIG_EMPLOYEE_{id}` 与 `{BIZTYPE}_{id}`。 |
| 修改 | [src/dig-employee-change-subscriber.ts](../src/dig-employee-change-subscriber.ts) | Redis 独立连接 `SUBSCRIBE`、JSON 解析与校验、`resourceId` 与授权集比对、防抖队列与按 id 合并、`changedAt` 乱序丢弃、调用 `__flushNow` / `deletedSourceKeys`；订阅启动不再要求 `USER_CODE`。 |
| 修改 | [src/agent-watchdog.ts](../src/agent-watchdog.ts) | 不再扫描磁盘目录；flush 时按授权 id 从 Redis `DIG_EMPLOYEE_{id}` 读取并注册。`deletedSourceKeys` 仅驱动配置移除，不删除本地文件。 |
| 修改 | [src/executor/local-snapshot.ts](../src/executor/local-snapshot.ts) | executor 资源快照改为读取 Redis `{BIZTYPE}_{id}`，不再读取 `executorResourcesDir`。 |
| 修改 | [index.ts](../index.ts) | `resolveDigEmployeePubSub` 合并插件配置与环境变量；装配 subscriber；`stop` 顺序：subscriber → auth watch → agent sync。 |
| 修改 | [src/types.ts](../src/types.ts) | 插件配置类型含 Redis 相关字段；`watchAgentDir` / `skillDirs` / `pollIntervalMs` 等标为 **@deprecated**，运行时忽略，仅保留类型与校验兼容。 |
| 修改 | [openclaw.plugin.json](../openclaw.plugin.json) | `configSchema`：`additionalProperties: true` 兼容任意遗留键；显式保留 `watchAgentDir`（boolean，已废弃、忽略）以免旧配置在「已知键」路径上类型报错。 |
| 修改 | [dig-employee-redis-change-notify.md](../../../../dig-employee-redis-change-notify.md) | 文末增加指向本文的「OpenClaw 插件消费端」链接（文档层，非运行时）。 |
| 测试 | [src/dig-employee-change-subscriber.test.ts](../src/dig-employee-change-subscriber.test.ts)、[src/agent-watchdog.test.ts](../src/agent-watchdog.test.ts) | 解析/合并/幂等辅助函数；`deletedSourceKeys` 在文件仍存在时仍能驱动配置同步。 |

**未改动的相关模块（行为保持，仅被复用）**

- [src/dig-employee-auth-watch.ts](../src/dig-employee-auth-watch.ts)：仍负责 `USER:RESOURCES:AUTH` 与 keyspace；`getAuthorizedIds()` 供订阅器做授权交集。
- [src/agent-adapter.ts](../src/agent-adapter.ts)、[src/agent-registry.ts](../src/agent-registry.ts)、[src/workspace-seed.ts](../src/workspace-seed.ts)：未为 Pub/Sub 单独分叉；flush 成功后仍走原有适配、合并与 workspace 种子逻辑。

**明确不在本改造范围内**

- 管理端 OpenAPI 拉取数字员工详情并写盘（计划中的 **策略 B**）。
- Redis Stream、消息持久化、跨实例 consumer group。
- `byclaw-be` 中 `DigEmployeeChangeEventPublisher` 等 Java 发布端实现。

构建产物：发布前需对扩展执行 `npm run build`，将变更打进 [dist/index.js](../dist/index.js)（esbuild 单包）。

## 与后端方案的关系

- **频道**：默认 `byai:pub:dig_employee_change`，与 `byai.dig-employee-change.pubsub-channel` 对齐；可通过环境变量或插件配置覆盖。
- **消息体**：整条 JSON，字段含义见后端文档中的 `DigEmployeeChangeEvent` 说明。
- **授权**：插件继续使用 `USER:RESOURCES:AUTH:{userId}`（由 `SHARE_BFM_USER_CODE_{USER_CODE}` 解析 userId），field 为资源 id、value 为 `DIG_EMPLOYEE` 时才视为可注册数字员工。
- **详情**：数字员工详情来自 Redis `DIG_EMPLOYEE_{resourceId}`；关联资源详情来自 Redis `{BIZTYPE}_{resourceId}`。

## 行为概览

| 能力 | 说明 |
|------|------|
| **数字员工加载** | 不再读取 `agentConfigDir`；仅在 **Pub/Sub / 授权变更 / 启动 flush** 时按授权 id 读取 Redis `DIG_EMPLOYEE_{id}`。 |
| **Pub/Sub 订阅** | 独立 Redis 连接 `SUBSCRIBE` 指定频道；消息防抖合并后触发 `agentWatch.__flushNow`。 |
| **授权过滤** | 默认 **严格模式**：`getAuthorizedIds()` 为 `undefined` 时忽略 Pub/Sub 事件，直到 dig-employee 授权加载完成。 |
| **删除** | `DIG_EMPLOYEE_DELETED`：从 OpenClaw 配置中移除对应 `baiying-agent-{resourceId}`。 |
| **更新/创建** | 触发一次 Redis 重读与配置合并；详情以 `DIG_EMPLOYEE_{resourceId}` 最新值为准。 |
| **资源读取** | `baiying_call` 执行时按需读取 `{BIZTYPE}_{resourceId}`，不扫描 executor 资源目录。 |

## 插件配置（openclaw 插件 config）

| 字段 | 类型 | 说明 |
|------|------|------|
| `digEmployeeChangeSubscribe` | boolean | 默认启用 Pub/Sub；显式设为 `false` 可关闭，环境变量 `BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE=false` 也可关闭。 |
| `digEmployeeChangeChannel` | string | 频道名；未设置时用环境变量 `BAIYING_DIG_EMPLOYEE_CHANGE_CHANNEL` / `DIG_EMPLOYEE_PUBSUB_CHANNEL`，再默认 `byai:pub:dig_employee_change`。 |
| `digEmployeeChangeSubscribeStrictAuth` | boolean | 默认 `true`；为 `false` 时授权未就绪也会处理事件（负载与误更新风险更高）。 |
| `watchDebounceMs` | number | Redis 侧 flush 防抖（毫秒），默认 `500`。 |

## 环境变量

| 变量 | 说明 |
|------|------|
| `BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE` | 设为 `false` 关闭订阅（插件配置未显式设置 `digEmployeeChangeSubscribe` 时生效）。 |
| `BAIYING_DIG_EMPLOYEE_CHANGE_CHANNEL` | 覆盖默认频道名。 |
| `DIG_EMPLOYEE_PUBSUB_CHANNEL` | 兼容监听脚本使用的频道环境变量。 |
| `BAIYING_DIG_CHANGE_SUBSCRIBE_STRICT_AUTH` | 设为 `false` 关闭严格授权模式（默认严格）。 |
| `BAIYING_DIG_CHANGE_REDIS_CONNECT_TIMEOUT_MS` | 订阅连接超时（毫秒），默认 `3000`。 |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DATABASE` 等 | 订阅器和 Redis JSON 读取层使用；订阅器不要求 `USER_CODE`。 |
| `USER_CODE` | 仅授权监听需要；缺失时不会注册任何数字员工。 |
| `BAIYING_ENV_FILE` | 可选 `.env` 路径；插件也会尝试加载当前工作目录 `.env` 与 OpenClaw 状态目录 `.env` 中的 Redis 默认值。 |

## 事件 JSON 示例

```json
{
  "eventType": "DIG_EMPLOYEE_UPDATED",
  "resourceId": 123456789,
  "resourceBizType": "DIG_EMPLOYEE",
  "changedAt": 1735689600000,
  "source": "manager-api"
}
```

- `resourceBizType` 若存在且不是 `DIG_EMPLOYEE`，事件会被跳过。
- `changedAt`：用于同 `resourceId` 的乱序去重（更旧的事件忽略）；缺省则不做该项幂等。

## 防抖与合并

短时间多条消息会按 `watchDebounceMs` 合并；同一 `resourceId` 多条事件合并规则为：**任一为 `DIG_EMPLOYEE_DELETED` 则结果为删除**；否则保留 `changedAt` 更大的一条（见 `mergeDigEmployeeChangeEvents`）。

## 与授权监听的关系

`dig-employee-auth-watch` 仍负责 **Hash 变更** 与 keyspace 通知；变更时仍会 `__flushNow({ fullWorkspaceReseed: true })`。Pub/Sub 负责 **资源内容变更** 信号，两者互补。

## 运维与故障排查

- **离线丢消息**：Pub/Sub 不持久化；网关停机期间变更需依赖下次全量或外部补偿。
- **订阅不生效**：检查 Redis 地址、ACL 是否包含 `subscribe`；日志中是否有 `dig-employee Pub/Sub subscriber disabled`。
- **事件被忽略**：严格模式下授权未就绪；或 `resourceId` 不在当前用户授权集合；或 `changedAt` 判定为过期。
- **更新未反映**：确认 Redis 中 `DIG_EMPLOYEE_{resourceId}` 已更新，且当前用户 Hash 中存在该 id 的 `DIG_EMPLOYEE` 授权。

## 阅读代码时的入口

- 订阅与解析：[src/dig-employee-change-subscriber.ts](../src/dig-employee-change-subscriber.ts)
- Redis 数字员工加载、删除与配置写入：[src/agent-watchdog.ts](../src/agent-watchdog.ts)
- 插件装配：[index.ts](../index.ts)
