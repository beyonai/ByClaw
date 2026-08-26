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

Leader 仍只看到一个 `updateTaskPlan` Tool，通过 `action` 区分首次创建和后续更新。

### 2.1 CREATE

CREATE 只允许提交任务定义，任务初始状态只能是 `PENDING` 或 `IN_PROGRESS`：

```json
{
  "action": "create",
  "title": "实现任务计划",
  "explanation": "先分析，再实现和验证",
  "tasks": [
    {
      "step": "分析协议",
      "description": "确认接口和状态机",
      "status": "IN_PROGRESS"
    },
    {
      "step": "实现协议",
      "status": "PENDING"
    }
  ]
}
```

`byclaw-super` 注入可信的 `sessionId`、`messageId`、`sourceRuntime`、`sourceRunId` 和
`idempotencyKey`。BE 生成 `planId`、`taskId` 和 `version=1`。

同一 Run 已有计划时返回：

```json
{
  "ok": false,
  "error": {
    "code": "PLAN_ALREADY_EXISTS",
    "message": "An active or historical plan already exists for this Run"
  },
  "currentPlan": {}
}
```

### 2.2 UPDATE

UPDATE 不再提交标题、步骤定义或完整任务数组，只提交 ID、版本和状态变化：

```json
{
  "action": "update",
  "planId": "90001",
  "expectedVersion": 1,
  "updates": [
    {
      "taskId": "91001",
      "status": "COMPLETED"
    },
    {
      "taskId": "91002",
      "status": "IN_PROGRESS"
    }
  ]
}
```

后端使用 `planId + expectedVersion + status=ACTIVE` 执行 Compare-And-Set。成功后版本加一，
返回新的完整权威快照并广播 `TASK_PLAN_SNAPSHOT`。

## 3. Tool Result

成功：

```json
{
  "ok": true,
  "plan": {
    "planId": "90001",
    "version": 2,
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
    "message": "Task plan version has changed"
  },
  "currentPlan": {
    "planId": "90001",
    "version": 3,
    "tasks": []
  }
}
```

错误作为正常 Tool Result 返回，失败操作不广播前端快照。常用错误码：

| code | 含义 |
|---|---|
| `INVALID_REQUEST` | 参数或状态值不合法 |
| `PLAN_ALREADY_EXISTS` | 同一 Run 重复创建 |
| `PLAN_NOT_FOUND` | 计划不存在或不属于当前执行 |
| `PLAN_NOT_ACTIVE` | 计划已经进入终态或正在取消 |
| `TASK_NOT_FOUND` | taskId 不属于当前计划 |
| `VERSION_CONFLICT` | expectedVersion 已过期 |
| `ILLEGAL_TASK_TRANSITION` | 状态迁移不合法 |
| `INVALID_EXECUTION_ORDER` | 顺序计划执行次序不合法 |

## 4. 状态机

| 当前状态 | 允许的新状态 |
|---|---|
| `PENDING` | `PENDING`、`IN_PROGRESS`、`SKIPPED`、`CANCELLED` |
| `IN_PROGRESS` | `IN_PROGRESS`、`COMPLETED`、`FAILED`、`CANCELLED` |
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
- 计划终态后拒绝新的 UPDATE。

## 5. 模型上下文与完成守卫

每轮 Leader 推理前注入完整的权威模型视图，其中包含 UPDATE 所需的 `planId`、`version` 和
每个 `taskId`。这些值只能从可信上下文或 Tool Result 复制，不能自行生成。

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
| `plan_id/user_id/session_id/message_id` | 计划与前端回答归属 |
| `source_runtime/source_run_id` | Runtime 执行归属 |
| `title/status/version/...` | 计划当前状态 |
| `tasks_payload` | `TaskPlanSnapshot.TaskSnapshot[]` JSON |
| `idempotency_payload` | toolCallId 与首次权威结果 JSON |
| `created_at/updated_at/completed_at` | 生命周期时间 |

任务定义、状态、原因和时间戳全部保存在 `tasks_payload` 中。每次 UPDATE 通过一条 CAS SQL 原子替换
计划当前快照，不再维护 item 表或 event 表。

`idempotency_payload` 保存已处理 Tool Call 及其首次结果，因此旧调用在更高版本产生后重放，仍返回
第一次调用得到的快照，不重复增加版本或广播事件。

## 7. 停止与历史恢复

停止仍为两阶段：

```text
ACTIVE → CANCELLING → CANCELLED
```

进入 `CANCELLING` 后拒绝迟到的 Tool UPDATE；确认 Runtime、Tool 和数字员工停止后，把所有非终态任务
改为 `CANCELLED`。历史消息查询仍返回 `CANCELLED` 快照，Runtime 的活动计划查询只返回 `ACTIVE`。

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

该脚本会依次删除旧 event、item、plan 三张表，再创建新的单表。旧任务计划数据不会迁移。脚本必须由
人工执行，应用不会自动执行。
