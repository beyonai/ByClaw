---
name: knowledge-organizer-update-task-status
description: 更新非交互式知识整理任务的终态。仅用于后台、定时、异步或运营任务在初始化失败、同步 ingest 结束、或 organize/build 无法提交异步任务时，将状态设置为 failed、done 或 mixed；不得用于普通交互任务，也不得在异步任务成功受理后调用。
---

# 更新非交互式任务状态

只在父 Skill 已判断当前请求为非交互式任务时执行。普通交互任务不得调用本 Skill。

## 选择状态

只允许以下终态：

| 结果 | 状态 |
|---|---|
| 初始化失败 | `failed` |
| `ingest` 没有任何文件成功提交，包括没有可提交文件或全部失败 | `failed` |
| `ingest` 至少一个文件成功，且至少一个文件失败或跳过 | `mixed` |
| `ingest` 的全部待处理文件均成功 | `done` |
| `organize` 或 `build` 未能成功提交异步任务 | `failed` |

`organize` 或 `build` 成功受理后立即停止，不得更新任务状态。后续状态由异步任务维护。

## 执行

从当前任务上下文取得数值型会话 ID，不要猜测。执行：

```bash
python3 <技能目录>/scripts/knowledge_organizer.py update-task-status \
  --session-id "<会话ID>" \
  --task-status "<failed|done|mixed>"
```

只有命令执行成功时才视为状态已更新。失败时如实汇报，不得绕过 CLI 或手工补偿。
