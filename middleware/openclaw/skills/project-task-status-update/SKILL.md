---
name: project-task-status-update
description: 按项目状态字典更新会话 JSON 中的扩展任务状态。用于根据会话进度设置业务状态（如需求阶段、知识采集），不得把业务状态写入顶层运行态 status。
metadata:
  openclaw:
    requires:
      bins: [python3]
byclaw_managed: true
---

# 更新会话扩展任务状态

这是平台底层能力，所有百应数字员工都可使用，不要求员工单独绑定。

只通过本 Skill 自带的 CLI 执行。不得直接改 `/by/.acp-runs/sessions/{sessionId}.json`，不得绕过字典接口自造 `status_code`。

顶层 `status` 仍是运行态（`pending` / `in_progress` / `paused` / `completed`）。本 Skill 只维护根字段 `task_statuses`。

## 何时调用

会话阶段变化、需要对外展示业务状态，或用户明确要求更新任务状态时调用。`sessionId` 和 `projectId` 必须来自当前任务上下文，不要猜测。

## 执行

在容器内从技能目录运行：

```bash
python3 /app/skills/project-task-status-update/scripts/update_task_status.py list \
  --project-id "<项目ID>"
```

再写入会话投影：

```bash
python3 /app/skills/project-task-status-update/scripts/update_task_status.py update \
  --session-id "<会话ID>" \
  --project-id "<项目ID>" \
  --dimension-name "<维度，如 业务状态>" \
  --status-code "<编码，如 REQUIREMENT>" \
  --reason "<本次变更原因>"
```

默认写入 `/by/.acp-runs/sessions/<会话ID>.json`。文件必须已由 `self-developed-rules` 创建；本 CLI 只做补丁，不新建投影。

## 规则

1. `status_code` 必须能在 `ProjectTaskStatus` 字典中命中，命中后把 `status_name`、`status_desc`、`sort_order` 一并抄入 JSON。
2. 同一 `dimension_name` 只保留一条。
3. 成功时 `revision` 加 1，并追加一条 `transitions`。
4. 不要修改 `schema_version`、`stages` 结构，也不要把业务编码写进顶层 `status`。
5. CLI 失败时如实汇报并停止，不要手工改 JSON 补偿。

## 输出

CLI 打印一个 JSON 对象。`ok` 为 true 才视为已更新。
