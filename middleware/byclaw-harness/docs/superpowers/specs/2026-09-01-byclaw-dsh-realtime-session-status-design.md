# ByClaw DSH 实时会话状态设计

## 背景

ByClaw 通过 `byclaw-integration` 在 DSH Host 进程内消费 `session/event`，并通过
`GatewayDataEmitter` 将 DSH 根会话、子会话与 Agent Teams 快照写入
`byai_gateway:session:<sessionId>:data_stream`。ByClaw BE 已具备 Redis Stream 消费、
WebSocket 广播、运行态查询和断线恢复能力，FE 也已有会话运行中与等待输入状态管理。

端到端会话 `20042151` 证明消息实时链路可以工作：四个成员均被创建，Redis 收到 225 条
会话事件，FE 能实时看到团队进展和四个子会话。但存在两个状态一致性缺口：

1. DSH 已进入运行态时，BE 的 `runningStatus` 仍可能因为请求运行标记尚未建立而返回
   `false`；该接口没有使用 DSH 的真实 Agent 状态。
2. Agent Teams 所有任务进入终态时，插件立即结束异步 gate。队长最后一次唤醒和最终汇总
   可能尚未完成，导致 ByClaw 父会话停在旧进度，随后请求流被标记为完成。

## 设计目标

- 插件直接消费 DSH WebSocket 控制层所使用的核心事件源：`session/event` 与
  `agent/status`，不通过网络反连自身 WebSocket。
- 只要根 Agent、任意子 Agent 或团队任务仍在工作，ByClaw 会话保持运行中。
- 团队任务全部终态后，必须等待队长最终唤醒回合完成，才能关闭回答流。
- DSH 运行状态通过既有 Redis 会话 Stream 实时进入 BE，并由 WebSocket 推送到所有前端。
- FE 当前会话和侧边栏使用同一状态真源，并能在重连后恢复。
- 状态事件按 trace 和 revision 幂等，旧完成事件不能清除新一轮运行态。

## 非目标

- 不建立从插件到 DSH WebSocket 的 loopback 客户端。
- 不替换 GatewayDataEmitter、SessionStreamManager 或现有回答流协议。
- 不同步 `channelExtension`、`groupChat` 或 multi-agent lane 元数据。
- 不改变 DSH Agent Teams 的任务调度协议和持久化格式。

## 状态协议

插件向现有会话 Stream 写入 `event_kind=session.runtime` 的事件，metadata 包含：

```json
{
  "event_source": "dsh",
  "event_kind": "session.runtime",
  "session_scope": "parent",
  "host_session_id": "20042151",
  "external_root_session_id": "dsh-session-id",
  "session_status": "running",
  "active_agent_count": 3,
  "active_child_count": 2,
  "waiting_interaction_count": 0,
  "runtime_revision": 7,
  "runtime_changed_at": 1788259000000
}
```

状态值：

- `running`：根 Agent、子 Agent 或非终态团队任务至少存在一个。
- `waiting_user`：没有 Agent 执行，但存在等待用户处理的问题、审批或计划确认。
- `idle`：本轮队长最终回合已经完成，且没有活动 Agent、非终态任务或用户交互。
- `failed`：根回合失败并且没有仍在执行的子 Agent。

`runtime_revision` 在一个 ByClaw 回答 trace 内单调递增。插件只在状态或计数变化时发送，
避免为每个 token 生成状态事件。

## 插件运行态聚合

`ByClawDshSessionRuntime` 同时订阅：

- `session/event`：消息、工具、交互、团队快照和回合结束。
- `agent/status`：DSH Agent 从 idle/running 的真实转换；这也是 DSH Session Controller
  发布 `api-session/status` WebSocket 事件的上游来源。

活动 Agent 通过 Session 的 parent lineage 归属到当前 `ActiveTurn`。聚合器维护活动 session
集合、等待交互集合、最近团队非终态任务数和单调 revision。事件按 `turn.forwarding` 顺序写入，
确保状态与内容事件保持同一 Redis 顺序。

## Agent Teams 收尾门禁

团队快照全部终态只表示“成员任务完成”，不表示“用户可见回答完成”。门禁采用两个阶段：

1. `teamQuiescent`：团队快照显示所有任务终态，同时没有活动子 Agent。
2. `captainFinalized`：进入 `teamQuiescent` 后，队长至少启动并结束一次新的回合；该回合的
   `turn/end` 为 completed，且此时没有活动 Agent和等待交互。

只有两个条件都满足才 resolve gate。任务终态事件本身不再直接关闭 gate，因此不会与
`Agent.whenIdle()` 的即时返回产生竞态。无进展超时继续作为故障兜底，每次 durable 快照或
Agent 状态变化都会续期。

## ByClaw BE

新增独立的 DSH 运行态存储，避免请求完成时 `RunningOutputStreamRegistry.releaseIfOwner()`
删除 DSH 真源。建议 key：`byai:chat:dsh-runtime:<sessionId>`，内容为 trace、状态、计数、revision、
changedAt，带有有限 TTL。

`SessionStreamEventRouter` 在普通消息聚合前识别 `session.runtime`：

- revision 大于当前值才更新 Redis。
- 更新后发送 `SESSION_RUNTIME_STATUS` WebSocket 消息。
- `idle/failed` 只终结匹配 trace 且 revision 更新的 DSH 运行态。
- 状态事件不写入聊天正文，也不触发回答终态收尾。

`runningStatus` 合并请求运行标记与 DSH 状态：任一来源为运行/等待用户，即返回运行信息；
同时新增 `runtimeStatus`、`activeAgentCount`、`activeChildCount`、`runtimeRevision` 与
`runtimeChangedAt` 字段。

## ByClaw FE

`useGlobalChatRuntime` 订阅 `SESSION_RUNTIME_STATUS`，将状态写入
`chatSessionRuntimeManager`。管理器保留服务端运行态，与本地请求 runtime 分开索引：

- `running` 注册或更新服务端 runtime。
- `waiting_user` 保持运行态并设置等待输入标记。
- `idle/failed` 仅在 trace/revision 不旧于当前状态时完成对应 runtime。

当前会话显示状态文案；侧边栏继续使用同一管理器显示 loading/等待标记。WebSocket 重连后，
通过扩展后的 `runningStatus` 恢复 DSH 状态。

## 错误处理与兼容性

- 旧插件没有 `session.runtime` 时，BE/FE 继续使用现有请求运行标记，保持向后兼容。
- 非法状态事件返回 intentionally ignored，不影响普通聊天事件 ACK。
- Redis 状态写失败时当前 Stream 事件留在 pending，遵循现有重试语义。
- DSH 插件退出前发送匹配 trace 的 `failed` 或 `idle`；异常断电由 TTL 和 BE 恢复扫描兜底。

## 验收用例

在《测试研发项目》新建会话并发送：

> @ByClaw研发专家团 让各个成员做下自我介绍

验收标准：

1. DSH 创建四个成员任务，四个子 Agent 输出实时进入 Redis。
2. FE 实时创建四个只读子会话并持续显示其事件。
3. 任意 Agent 或团队任务工作时，`runningStatus` 和页面状态均保持 running。
4. 团队全部完成后，队长输出包含四位成员的最终汇总，然后才收到 idle/回答终态。
5. `.sessions/<sessionId>` 中存在四位成员的交付文件。
6. 刷新页面或断开重连不会丢失当前运行状态。
