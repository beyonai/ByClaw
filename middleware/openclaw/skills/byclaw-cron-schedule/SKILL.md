---
name: byclaw-cron-schedule
description: 管理 ByClaw 当前用户的聊天定时任务，包括查询、创建、修改、启停、删除、立即运行和运行记录查询。仅适用于 /automation 的 sourceType=chat 任务。
---

# ByClaw 定时任务

使用 `scripts/cron_schedule.py` 管理当前用户的 `sourceType=chat` 定时任务。

## 流程

1. 用 `list` 定位任务；用 `projects`、`employees` 解析项目和数字员工。
2. 创建或修改时，`prompt` 只写单次业务目标，执行频率只写 `schedule`。
3. 对 `create`、`update`、`pause`、`resume`、`delete`、`run`，先执行 `plan --request`，向用户完整展示 `confirmation.summary`、`confirmation.constraints` 和 `planHash`，然后停止并等待确认。
4. 用户在后续消息中明确确认当前计划后，执行 `apply --request ... --accept-plan <planHash> --confirmed-by-user`。不得在生成计划的同一轮自行确认；计划变化后必须重新展示并确认。
5. 写入后按操作类型回读；结果不明时只回查，不自动重试。

命令、请求和调度格式见 [执行说明](references/execution.md)；调用前阅读 [API 契约](references/api-contracts.md)。

## 约束

- 仅操作当前用户可见的 chat 任务；`projectId=-1` 按未指定处理，不发送给 API。
- 默认阻止同名创建；更新只修改显式字段，不改变 `projectId` 或 `sourceType`。
- 脚本默认拦截提示词中的调度指令；仅当业务本身需要管理定时任务时，才可在用户确认后显式覆盖。
- 立即运行会绕过启用状态和到期判断；API 成功仅表示写入或会话下发，不代表执行完成。
