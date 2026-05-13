# OpenClaw baiying-enhance：数字员工 Redis Pub/Sub 消费端说明

本文描述 **baiying-enhance** 插件如何消费与仓库根目录 [dig-employee-redis-change-notify.md](../../../../dig-employee-redis-change-notify.md) 所述一致的 **数字员工变更广播**，并与本机 **用户授权数字员工列表**（Redis Hash）对齐后更新 OpenClaw 托管 agent。

## 代码改造范围

本特性**仅落在 `baiying-enhance` 扩展包内**；不涉及 `byclaw-be` 发布端、也不改 executor / `baiying_call` 的调用链。具体文件职责如下。

| 范围 | 路径 | 改造内容 |
|------|------|----------|
| 新增 | [src/dig-employee-change-subscriber.ts](../src/dig-employee-change-subscriber.ts) | Redis 独立连接 `SUBSCRIBE`、JSON 解析与校验、`resourceId` 与授权集比对、防抖队列与按 id 合并、`changedAt` 乱序丢弃、调用 `__flushNow` / `deletedSourceKeys`。 |
| 修改 | [src/agent-watchdog.ts](../src/agent-watchdog.ts) | 目录**不**再使用 chokidar；仅在 flush 时扫描磁盘。`AgentFlushNowOptions` 含 `deletedSourceKeys`；flush 内 unlink `AGENT_{id}.json`、从扫描结果剔除并强制 `removedSet` 写入配置。 |
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
- **授权**：插件继续使用 `USER:RESOURCES:AUTH:{userId}`（由 `SHARE_BFM_USER_CODE_{USER_CODE}` 解析 userId），`resourceId` 与 agent 的 `sourceKey` 一致（均为数字字符串）。

## 行为概览

| 能力 | 说明 |
|------|------|
| **目录扫描** | 不再监听文件系统；仅在 **Pub/Sub / 授权变更 / 启动 flush** 时读取 `agentConfigDir` 下 JSON。 |
| **Pub/Sub 订阅** | 独立 Redis 连接 `SUBSCRIBE` 指定频道；消息防抖合并后触发 `agentWatch.__flushNow`。 |
| **授权过滤** | 默认 **严格模式**：`getAuthorizedIds()` 为 `undefined` 时忽略 Pub/Sub 事件，直到 dig-employee 授权加载完成。 |
| **删除** | `DIG_EMPLOYEE_DELETED`：尝试删除 `agentConfigDir` 下 `AGENT_{resourceId}.json`，并从 OpenClaw 配置中移除对应 `baiying-agent-{resourceId}`，**即使 JSON 文件仍存在**。 |
| **更新/创建** | 触发一次目录重扫与配置合并；**不**在插件内调用管理端 HTTP 拉数（策略 A：由外部同步器写 JSON 后再 flush）。 |

## 插件配置（openclaw 插件 config）

| 字段 | 类型 | 说明 |
|------|------|------|
| `digEmployeeChangeSubscribe` | boolean | 为 `true` 时启用 Pub/Sub；未设置时也可通过环境变量 `BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE=true` 开启。 |
| `digEmployeeChangeChannel` | string | 频道名；未设置时用环境变量 `BAIYING_DIG_EMPLOYEE_CHANGE_CHANNEL`，再默认 `byai:pub:dig_employee_change`。 |
| `digEmployeeChangeSubscribeStrictAuth` | boolean | 默认 `true`；为 `false` 时授权未就绪也会处理事件（负载与误更新风险更高）。 |
| `watchDebounceMs` | number | Redis 侧 flush 防抖（毫秒），默认 `500`。 |

## 环境变量

| 变量 | 说明 |
|------|------|
| `BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE` | 设为 `true` 启用订阅（插件配置未显式设置 `digEmployeeChangeSubscribe` 时生效）。 |
| `BAIYING_DIG_EMPLOYEE_CHANGE_CHANNEL` | 覆盖默认频道名。 |
| `BAIYING_DIG_CHANGE_SUBSCRIBE_STRICT_AUTH` | 设为 `false` 关闭严格授权模式（默认严格）。 |
| `BAIYING_DIG_CHANGE_REDIS_CONNECT_TIMEOUT_MS` | 订阅连接超时（毫秒），默认 `3000`。 |
| `USER_CODE` / `REDIS_HOST` / `REDIS_PORT` / `REDIS_DATABASE` 等 | 与 [dig-employee-auth-watch](../src/dig-employee-auth-watch.ts) 一致；缺任一项则订阅器不启动并打 warn。 |

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
- **订阅不生效**：检查 `USER_CODE`、Redis 地址、ACL 是否包含 `subscribe`；日志中是否有 `dig-employee Pub/Sub subscriber disabled`。
- **事件被忽略**：严格模式下授权未就绪；或 `resourceId` 不在当前用户授权集合；或 `changedAt` 判定为过期。
- **更新未反映**：策略 A 下需保证 **外部已将最新 `AGENT_{resourceId}.json` 写入 `agentConfigDir`** 后再收到或重放事件。

## 阅读代码时的入口

- 订阅与解析：[src/dig-employee-change-subscriber.ts](../src/dig-employee-change-subscriber.ts)
- 目录扫描、删除与配置写入：[src/agent-watchdog.ts](../src/agent-watchdog.ts)
- 插件装配：[index.ts](../index.ts)
