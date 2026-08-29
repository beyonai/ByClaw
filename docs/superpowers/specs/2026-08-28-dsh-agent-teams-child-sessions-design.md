# DSH AgentTeams 父子会话与活动面板设计

## 目标

为 ByClaw 的 DSH 接入增加真实的 AgentTeams 父子会话能力，避免队长会话、成员会话的正文、思考过程和工具调用全部混在同一条消息流中。

本设计同时提供与 DSH `agent-teams` 插件一致的两类入口：

- 父会话标题区中的“`N 个子代理`”入口；
- 父会话消息流中的 AgentTeams 团队卡片及活动面板。

用户可以从这些入口进入每个成员的独立会话，查看该成员的完整正文、思考过程、工具调用和执行状态。父会话只保留队长过程、团队摘要与最终汇总。

## 已确认的产品决策

- 使用真实 ByClaw 子会话，而不是只在前端对父会话消息做虚拟过滤；
- 子会话不作为普通顶层会话混入左侧项目会话列表；
- 子会话通过父会话标题、团队卡片和活动面板进入；
- AgentTeams 活动数据由 ByClaw 自己持久化，不在历史回放时依赖 FE 直接轮询 DSH；
- 活动面板需要同时支持运行中快照和团队结束后的归档快照；
- 不新增数据库表或字段，不创建数据库迁移；
- 复用现有 `byai_session.parent_session_id` 和 `byai_session_ext`。

## 当前问题

### 插件事件全部写入父会话

`byclaw-integration` 已经在事件 metadata 中携带：

- `dsh_session_id`；
- `parent_dsh_session_id`；
- `delegation_depth`；
- `dsh_sequence`。

但 `ByClawDshSessionRuntime.emitSessionEvent()` 最终始终调用：

```text
emitter.emitChunk(turn.context.sessionId, ...)
```

第一参数始终是外部 ByClaw 父会话 ID，因此 DSH 根会话和所有子会话的事件都会进入同一个 ByClaw 聚合上下文并落入同一条父会话消息。

### ByClaw 已有父子字段但没有形成产品能力

BE 的 `ByaiSession` 已有 `parentSessionId`，数据库映射也读取 `parent_session_id`。FE 的 `ISession` 同样声明了 `parentSessionId`，但当前：

- 会话查询不会区分根会话和子会话；
- 左侧会话列表不根据父子关系过滤或分组；
- 聊天标题没有父子面包屑或子代理入口；
- 消息事件处理不根据 DSH 会话身份进行分流；
- AgentTeams 快照仍被当成普通 `3015 tool_call` 渲染。

### DSH 历史 UI 的限制

DSH 当前父会话 UI 提供“`4 个子代理`”菜单、团队卡片和活动面板。成员按钮通过真实子会话 ID 打开对应 Session。

但已结束会话可能出现：

- 子代理 API 返回空列表，而标题仍保留历史数量；
- 初始团队卡片只包含 0 成员；
- 归档活动面板无法恢复后续完整成员和任务信息。

ByClaw 的实现不能只转发初始卡片，也不能依赖 DSH 当前磁盘状态作为历史事实源。完整终态快照必须随会话数据持久化。

## 范围

### 包含

- `byclaw-integration` 输出可分流的父会话、子会话和团队快照事件；
- BE 幂等创建和维护 DSH 子会话映射；
- BE 将子会话事件独立聚合、持久化和广播；
- 父会话列表排除子会话的顶层展示；
- FE 父子会话标题、子代理下拉入口和返回父会话能力；
- AgentTeams 团队卡片和活动面板；
- 活动中增量更新和结束后历史回放；
- 插件、BE、FE 的自动化测试和真实端到端验证。

### 不包含

- 不修改 DeepSeek Harness 核心会话实现；
- 不通过 iframe 嵌入 DSH Web 页面；
- 不让 FE 直接访问 DSH 的本地或远程管理接口；
- 不新增或修改数据库结构；
- 不创建版本化 DDL/DML；
- 不把子会话作为普通项目会话放到左侧顶层列表；
- 不在本次任务中设计通用的非 DSH 多 Agent 会话协议；
- 不提交账号、密码、Token 或填充后的环境文件。

## 总体架构

```text
DSH root/captain session
  |
  +-- root events --------------------> ByClaw parent session
  |
  +-- agent-teams snapshots ----------> parent team card/activity panel
  |
  +-- child session A events ---------> ByClaw child session A
  +-- child session B events ---------> ByClaw child session B
  +-- child session C events ---------> ByClaw child session C
  +-- child session D events ---------> ByClaw child session D
```

DSH 会话 ID 是外部稳定标识，ByClaw 会话 ID 是内部数据库主键。BE 负责建立两者的持久映射，插件不生成或猜测 ByClaw 数字会话 ID。

## 插件事件协议

### 通用身份字段

所有 DSH 投影事件必须提供以下 metadata：

| 字段 | 含义 |
| --- | --- |
| `dsh_scope` | `parent`、`child` 或 `team` |
| `dsh_session_id` | 当前事件所属 DSH 会话 |
| `parent_dsh_session_id` | 当前 DSH 会话的直接父会话；根会话为空 |
| `root_dsh_session_id` | 本轮队长根会话 |
| `delegation_depth` | DSH 委派深度 |
| `dsh_sequence` | 当前 DSH Session 内的事件序号 |
| `dsh_event` | 原始投影事件类型 |
| `external_parent_session_id` | ByClaw 父会话 ID |

子会话首次出现和状态更新还需要携带：

| 字段 | 含义 |
| --- | --- |
| `child_name` | 成员展示名称 |
| `child_role` | 成员角色 |
| `child_status` | `ready`、`working`、`completed`、`failed`、`removed` |
| `team_id` | 所属 AgentTeams 团队 ID，可为空 |

### 事件作用域

#### `parent`

根 Agent 的正文、思考、工具调用、计划和终态继续发给当前 ByClaw 请求会话，沿用现有同步响应链路。

#### `child`

子 Agent 的以下内容只发送到子会话桥接链路：

- `session.created`；
- `session.status`；
- `session.error`；
- `session.output`；
- 思考文本；
- 工具开始、结果和失败；
- 上下文注入；
- 子会话终态。

这些事件不得再作为父会话 `REASONING_LOG_DELTA` 的可见节点输出。

#### `team`

AgentTeams 快照仍归属父会话，但必须作为团队快照处理，不能仅渲染成普通工具调用。

### 团队快照结构

快照采用可向后兼容的版本化结构：

```json
{
  "schemaVersion": 2,
  "eventKind": "agent-teams/snapshot",
  "team": {
    "teamId": "...",
    "name": "...",
    "description": "...",
    "captainDshSessionId": "...",
    "status": "working",
    "members": [],
    "tasks": [],
    "messageCount": 0,
    "captainInbox": []
  },
  "archived": false,
  "capturedAt": "..."
}
```

每个成员至少包含：

- `dshSessionId`；
- `name`；
- `role`；
- `status`；
- `activity`；
- `progress`；
- `done`；
- `total`；
- `currentTask`；
- `unread`。

每个任务至少包含：

- `id`；
- `subject`；
- `status`；
- `state`；
- `assignee`；
- `dependencies`；
- `depth`。

团队创建后可以先发送空快照，但后续非空快照必须覆盖它。团队解散或本轮结束前必须发送 `archived=true` 的完整终态快照。

## BE 子会话映射

### 会话实体

首次收到某个 DSH 子会话事件时，BE 创建一条 `byai_session`：

- `session_id`：通过现有 `SequenceService` 生成；
- `parent_session_id`：当前 ByClaw 父会话 ID；
- `session_name`：优先使用成员名称，缺失时使用子会话展示标签；
- `session_content`：成员角色或当前任务摘要；
- `creator_id`、`enterprise_id`、`project_id`：继承父会话；
- `object_type`、`object_id`、`session_type`：继承父会话，避免引入新的通用枚举；
- `create_time`、`update_time`：按事件时间维护；
- `parent_session_id > 0` 作为子会话判定依据。

### 扩展属性

使用 `byai_session_ext` 保存：

| `ext_param_code` | 值 |
| --- | --- |
| `dsh_session_id` | 外部 DSH 子会话 ID |
| `dsh_root_session_id` | DSH 队长根会话 ID |
| `dsh_team_id` | AgentTeams 团队 ID |
| `dsh_member_name` | 成员名称 |
| `dsh_member_role` | 成员角色 |
| `dsh_session_status` | 最新状态 |

查询映射键为：

```text
(parent ByClaw session ID, dsh_session_id)
```

相同 DSH 子会话 ID 不能跨父会话复用，以避免不同运行或同名团队互相污染。

### 幂等和并发

- 先按映射键查询已有子会话；
- 创建过程在事务内执行；
- 使用映射键粒度的锁串行化同一子会话首次创建；
- 创建后再次查询，保证进程内并发不会生成重复记录；
- 多实例部署时使用项目现有分布式锁能力；
- 重复 `session.created` 只更新元数据，不重复创建会话。

### 事件去重

子会话事件幂等键为：

```text
parent ByClaw session ID + dsh_session_id + dsh_sequence + projected event kind
```

Redis Stream 重投、BE 重启恢复和 DSH 重试不得产生重复的正文、思考或工具节点。

## BE 事件处理

### 路由顺序

`SessionStreamEventRouter` 在查找普通 `ChatProcessContext` 之前识别 DSH 作用域：

1. `dsh_scope=parent`：进入现有请求上下文；
2. `dsh_scope=team`：进入父会话上下文并更新团队快照；
3. `dsh_scope=child`：进入 DSH 子会话桥接服务，不要求子会话拥有独立的前台 HTTP 请求上下文。

### 子会话消息聚合

子会话桥接服务为每个 DSH 子会话维护独立聚合状态：

- 正文增量只合并到该子会话；
- 思考和工具节点沿用当前 ByClaw 原生 contentType；
- 工具开始和结果按 `toolCallId` 合并；
- 子会话终态触发消息落库；
- 长时间运行时按安全检查点保存快照，支持 BE 重启恢复；
- 每次更新向已登录用户广播该子会话的增量和状态通知。

父会话最终回复仍由当前同步请求负责落库，子会话不能改变父请求的终止判断。

### 团队快照持久化

团队快照作为父会话消息中的专用内容节点持久化。相同：

```text
parent session ID + team ID
```

复用稳定消息标识，后续快照覆盖前一状态。覆盖规则为：

- `capturedAt` 更新的快照优先；
- 非空成员/任务数据不能被旧的空快照覆盖；
- `archived=true` 的完整终态优先于活动快照；
- 归档快照仍保留成员到 ByClaw 子会话 ID 的映射。

## 会话查询和删除

### 会话列表

现有普通会话查询默认只返回：

```text
parent_session_id IS NULL OR parent_session_id <= 0
```

新增按父会话查询子会话的接口，返回：

- 子会话基本信息；
- 成员名称与角色；
- 运行状态；
- 未读数量；
- 更新时间；
- 所属团队 ID。

接口必须校验父会话的企业、创建人和项目访问权限，不能仅凭子会话 ID 越权读取。

### 删除

删除父会话时先查询并删除其子会话消息、扩展属性和会话记录，再执行现有父会话删除流程。删除单个子会话不影响父会话和其他成员会话。

## FE 交互设计

### 父会话标题

当父会话存在子会话时显示：

```text
父会话名称 / N 个子代理
```

点击“`N 个子代理`”打开菜单。每个菜单项展示：

- 成员头像或名称首字；
- 成员名称；
- 角色；
- 当前状态；
- 未读标记。

加载中显示骨架；加载失败显示可重试状态，不能无限停留在“正在加载子代理”。

### 子会话标题

进入子会话后显示：

```text
父会话名称 / 成员名称
```

父会话名称可点击返回。子会话复用当前消息列表和思考/工具渲染器，不复制一套聊天页面。

已结束子会话默认只读；用户通过父会话继续下达团队任务。本次不自动复活已销毁的 DSH 子 Agent。

### 左侧会话列表

- 根会话保持现有位置；
- 子会话不作为同级条目出现；
- 搜索结果命中子会话时，结果需要同时显示父会话名称，并通过父会话上下文打开；
- 子会话更新可以提升父会话更新时间，但不能新增多个顶层条目。

### 父会话消息过滤

父会话只渲染：

- 用户消息；
- 队长正文、思考、工具调用和计划；
- AgentTeams 团队卡片；
- 队长最终汇总。

子成员的正文、思考、工具调用和状态节点不再出现在父会话消息树中。

## AgentTeams 团队卡片

当 `contentType=3015` 且内容满足：

```text
eventKind == agent-teams/snapshot
```

时，`ToolCall` 渲染器切换到 AgentTeams 专用卡片。普通工具调用仍使用现有 `ToolCall` UI。

团队卡片展示：

- 团队名称；
- 成员数量；
- 已完成任务数/总任务数；
- 团队状态；
- “活动面板”按钮；
- 可选的成员快捷头像。

点击成员头像打开对应子会话，点击“活动面板”打开右侧或浮层面板。

## AgentTeams 活动面板

活动面板以已持久化的最新团队快照为数据源，展示：

### 团队概览

- 团队名称、描述和运行/结束状态；
- 成员数量；
- 完成任务数/总任务数；
- 消息数量。

### 队长派工关系

- 队长节点；
- 已派发任务数；
- 接收任务的成员数量；
- 当前是否等待成员回报。

### 总进度

- 进行中；
- 等待依赖；
- 已交付；
- 失败/取消；
- 总体进度条。

### 成员区域

每个成员展示：

- 名称、角色和头像；
- 工作中、等待、完成、失败或空闲状态；
- 当前任务；
- 已完成任务数/总任务数；
- 未读消息数。

成员行可以点击并进入对应子会话。

### 任务区域

展示任务标题、负责人、状态、依赖、层级和完成进度。依赖任务需要明确标识，失败和取消不能被算作已完成。

### 活动与归档

- 活动中的快照通过现有 WebSocket/SSE 增量更新；
- 面板关闭后再次打开使用 FE Store 中的最新状态；
- 页面刷新后从父会话历史消息恢复；
- 团队结束后显示归档终态，不再请求 DSH；
- 当前快照缺失时显示明确空状态，不使用初始空卡片伪装完整结果。

## 状态和错误处理

- 子事件早于 `session.created`：BE 先按事件 metadata 幂等创建子会话，再处理事件；
- 团队快照早于子会话映射：先展示成员，映射完成后补充可点击的 ByClaw 子会话 ID；
- DSH 子会话失败：子会话显示失败终态，父活动面板同步失败成员和任务；
- BE 重启：从持久映射和运行快照恢复，Redis 重投依赖幂等键去重；
- FE 重连：重新读取父会话快照和子会话列表，不重复插入节点；
- 子会话不存在或无权访问：返回 404/403，不回退到父会话内容；
- 旧版 `schemaVersion=1` 快照：兼容团队名称、成员数和任务数，面板显示受限历史状态；
- 未知普通 `3015`：继续走现有工具卡，不被 AgentTeams 分支误判。

## 测试设计

### 插件单元测试

- 根事件标记为 `parent` 并投递父会话；
- 子事件标记为 `child`，不再向父消息流投递；
- 每个子事件携带稳定 DSH 父子身份和序号；
- 团队快照使用 `schemaVersion=2`；
- 后续非空快照覆盖初始空快照；
- 结束时产生完整 `archived=true` 快照；
- 工具开始/结果仍复用 `toolCallId`；
- 原有 Resume、资源路由和 Worker 验证继续通过。

### BE 单元与集成测试

- 首个子事件创建真实子会话并继承父会话权限字段；
- 重复创建事件不产生重复子会话；
- 相同 DSH 子会话 ID 在不同父会话下互不污染；
- 并发首次事件只创建一个映射；
- 子事件只落入子会话；
- 父事件和最终答案仍落入父会话；
- Redis 重投按序号去重；
- 工具开始和结果在子会话内正确合并；
- 普通会话列表排除子会话；
- 按父会话查询子会话校验权限；
- 删除父会话清理子会话；
- 团队归档快照不会被旧空快照覆盖；
- 现有非 DSH 聊天路径不受影响。

### FE 测试

- 父标题正确显示子代理数量；
- 子代理菜单展示成员、角色和状态；
- 点击成员打开对应子会话；
- 子会话面包屑返回父会话；
- 顶层列表不展示子会话；
- 父消息树不渲染 child scope 内容；
- AgentTeams 快照走专用卡片，普通 3015 仍走工具卡；
- 活动面板展示成员、任务、依赖、进度和终态；
- 空、加载、错误、归档状态都有明确展示；
- 页面刷新后可以从持久化消息恢复面板和入口。

## 端到端验收

使用 `/Users/chenxiaofeng/code/open/ByClaw/envs/229/.env` 启动 BE、FE，使用 `/Users/chenxiaofeng/code/open/deepseek-harness/.env` 启动 DSH，并保持 DSH 环境中的远程 `BYCLAW_DSH_BASE_URL` 配置不被改成本地地址。

在《测试研发项目》中创建新会话并发送：

```text
@ByClaw研发专家团：让成员分别做下自我介绍
```

验收条件：

1. BE 将请求路由到 `BYCLAW_DSH_<userCode>`；
2. DSH 创建队长会话和 4 个成员子会话；
3. ByClaw 父会话顶部显示“4 个子代理”；
4. 父会话不出现四位成员的内部正文、思考和工具调用；
5. 团队卡片和活动面板显示 4 名成员、4 个任务及正确状态；
6. 点击每位成员都能进入独立子会话；
7. 每个子会话只显示该成员自己的正文、思考和工具调用；
8. 队长最终汇总正常进入父会话；
9. 页面刷新后父子入口、成员内容和归档活动面板仍然存在；
10. 重启 BE/DSH 后历史回放仍然正确；
11. FE 不出现“不支持的消息类型”；
12. BE、DSH 无未处理异常或重复消息。

## 安全、兼容与回滚

- 不在日志、文档、测试 fixture 或提交内容中记录账号、密码、Token、数据库密码或模型密钥；
- 子会话接口继承父会话的企业、用户和项目权限检查；
- `ENABLE_DSH=0` 时现有非 DSH 路由和聊天展示完全不变；
- 旧历史消息没有父子身份时继续按现有方式显示，不尝试猜测拆分；
- 前端 AgentTeams 分支只识别明确的 `eventKind` 和支持的 `schemaVersion`；
- 如需运行回滚，先关闭 `ENABLE_DSH`，再停止 DSH Worker；
- 代码回滚只撤销子会话桥接、查询入口和活动面板，不删除已经产生的历史子会话数据；
- 数据清理属于独立破坏性操作，不作为本次回滚自动执行。
