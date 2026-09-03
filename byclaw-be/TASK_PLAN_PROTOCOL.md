# ByClaw Agent Task Plan 协议

> 内部写入协议与单表存储说明。前端协议继续使用 `byclaw.task-plan/v1`。

## 1. 不变的前端合同

本次改造不改变以下前端可见行为：

- WebSocket 类型仍为 `TASK_PLAN_SNAPSHOT`；
- `schemaVersion` 仍为 `byclaw.task-plan/v1`；
- `data` 仍是 `TaskPlanSnapshot` 完整快照；
- 仍以 `sessionId + messageId` 关联回答，以 `planId + version` 判断新旧；
- `TASK_PLAN_GET`、停止流程和历史消息中的 `taskPlan` 字段保持不变；
- 前端不调用内部写入接口。

完整前端协议见：

```text
byclaw-super/docs/task-plan-frontend-protocol.md
```

## 2. 内部写入协议

Leader 仍只看到一个 `updateTaskPlan` Tool。Tool 不接收 `sessionId`、`planId`、`taskId` 或 `version`；
运行时注入当前会话，BE 根据会话解析唯一活动计划和当前任务。

### 2.1 CREATE

CREATE 只提交任务定义：

```json
{
  "action": "create",
  "title": "实现任务计划",
  "explanation": "先分析，再实现和验证",
  "tasks": [
    {
      "step": "分析协议",
      "description": "确认接口和状态机"
    },
    {
      "step": "实现协议"
    }
  ]
}
```

`byclaw-super` 注入可信的 `sessionId`、`messageId`、`sourceRuntime`、`sourceRunId` 和
`idempotencyKey`。数据库生成自增 `planId`；BE 按位置生成计划内 `taskId`（`"1"`、`"2"`……），
第一项自动进入 `IN_PROGRESS`，其余项为 `PENDING`，初始 `version=1`。

同一会话已有活动计划时返回：

```json
{
  "ok": false,
  "error": {
    "code": "PLAN_ALREADY_EXISTS",
    "message": "An active task plan already exists for this session"
  },
  "currentPlan": {}
}
```

### 2.2 推进当前任务

后续调用只表达当前任务的业务结果：

```json
{
  "action": "complete_current"
}
```

支持 `complete_current`、`fail_current`、`skip_current`。失败或跳过时可增加扁平的
`reasonCode/reasonMessage`；Super 会组装为内部 `statusReason`。BE 使用
`userId + sessionId + 当前version + status=ACTIVE` 执行 Compare-And-Set。完成或跳过当前任务时，
后端在同一事务中自动启动下一项；最后一项结束后自动收口计划。

## 3. Tool Result

模型可见的成功结果不包含任何内部 ID：

```json
{
  "ok": true,
  "plan": {
    "status": "ACTIVE",
    "tasks": []
  }
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Task plan changed while it was being updated"
  },
  "currentPlan": {
    "tasks": []
  }
}
```

错误作为正常 Tool Result 返回，失败操作不广播前端快照。常用错误码：

| code | 含义 |
|---|---|
| `INVALID_REQUEST` | 参数或状态值不合法 |
| `PLAN_ALREADY_EXISTS` | 同一会话已有活动计划 |
| `PLAN_NOT_FOUND` | 当前会话没有活动计划 |
| `VERSION_CONFLICT` | 并发更新导致内部版本变化 |
| `INVALID_EXECUTION_ORDER` | 顺序计划执行次序不合法 |

## 4. 状态机

| 当前状态 | 允许的新状态 |
|---|---|
| `PENDING` | 由后端自动进入 `IN_PROGRESS`，或随计划收口 |
| `IN_PROGRESS` | `COMPLETED`、`FAILED`、`SKIPPED`、`CANCELLED` |
| `COMPLETED` | `COMPLETED` |
| `FAILED` | `FAILED` |
| `SKIPPED` | `SKIPPED` |
| `CANCELLED` | `CANCELLED` |

顺序计划同时满足：

- 最多一个 `IN_PROGRESS`；
- 前序任务未终态时，后序任务不能开始；
- 创建后不能增加、删除、改名或重排任务；
- 终态任务不能回退；
- 任务失败后，未开始的后续任务自动变为 `SKIPPED`；
- 任务取消后，未完成的后续任务自动变为 `CANCELLED`；
- 计划终态后，同一会话可以在后续时间段创建新的计划。

## 5. 模型上下文与完成守卫

每轮 Leader 推理前注入不含内部 ID 的权威模型视图。模型只能看到任务位置、定义和状态，并通过
`complete_current/fail_current/skip_current` 汇报当前任务结果。

只要计划仍为 `ACTIVE`，Runtime 就不提交 `run.completed`，而是在同一 Leader Session 内继续执行。
连续三轮计划版本没有推进时，Run 转为 FAILED，Runtime 自动把当前任务和后续任务收口。

数字员工委派与任务计划相互独立：

- `delegateAgent` 不接收 `planId`、`taskId`、`taskPosition` 或任务状态；
- 委派开始、结束和 callback 恢复都不会隐式修改任务计划；
- Leader 根据权威快照显式调用 `updateTaskPlan` 推进任务状态；
- 只有 Run 异常、停止或连续无进展等无法继续交还 Leader 的情况，Runtime 才执行失败兜底收口。

## 6. 单表存储

唯一表：`byai_agent_task_plan`。

| 字段组 | 用途 |
|---|---|
| `plan_id/user_id/session_id/message_id` | 自增计划 ID 与前端回答归属 |
| `source_runtime/source_run_id` | Runtime 执行归属 |
| `title/status/version/...` | 计划当前状态 |
| `tasks_payload` | `TaskPlanSnapshot.TaskSnapshot[]` JSON |
| `last_command_id` | 最近一次成功 Tool Call，用于直接网络重试幂等 |
| `created_at/updated_at/completed_at` | 生命周期时间 |

任务定义、状态、原因和时间戳全部保存在 `tasks_payload` 中。每次 UPDATE 通过一条 CAS SQL 原子替换
计划当前快照，不再维护 item 表或 event 表。

`last_command_id` 命中时直接返回当前权威快照，不重复增加版本或广播事件。内部版本由 BE 管理，
不再要求模型参与乐观锁。

## 7. 停止与历史恢复

停止仍为两阶段：

```text
ACTIVE → CANCELLING → CANCELLED
```

进入 `CANCELLING` 后拒绝迟到的 Tool 推进。生产 `STOP_CHAT` 由 BE 统一编排：先请求计划取消，
再停止 Runtime，最后由 BE 把所有非终态任务改为 `CANCELLED`；即使下游 Runtime 停止失败，BE 也会
在本次停止请求中确认计划终态。历史消息查询仍返回 `CANCELLED` 快照，Runtime 的活动计划查询只返回
`ACTIVE`。

## 8. API

| 方法 | 地址 | 返回 |
|---|---|---|
| `POST` | `/byaiService/internal/api/v1/task-plan/update` | `TaskPlanCommandResult` |
| `POST` | `/byaiService/internal/api/v1/task-plan/active` | `TaskPlanSnapshot/null` |
| `POST` | `/byaiService/internal/api/v1/task-plan/cancel` | `TaskPlanSnapshot/null` |

HTTP 仍使用现有 `ResponseUtil` 外壳。`update.data` 是 `{ok, plan/error/currentPlan}`；查询和取消的
`data` 仍直接是前端协议使用的完整快照。

## 9. DDL

DDL 位于：

```text
byclaw-be/src/main/resources/db/task-plan-v1.sql
```

该脚本会依次删除旧 event、item、plan 三张表，再创建新的单表，并创建“每个用户会话最多一个活动
计划”的唯一索引。`plan_id` 使用数据库 `BIGSERIAL` 自增。旧任务计划数据不会迁移。脚本必须由人工
执行，应用不会自动执行。
