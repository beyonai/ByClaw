---
name: knowledge-organizer
description: 用户上传或采集文档后，对已落盘资料进行知识整理：对象拆分、两阶段关系梳理、预览确认后入库。
allowed-tools: read, edit, exec, write, baiying_call
triggers:
  - "整理文档"
  - "帮我整理"
  - "知识整理"
  - "整理资料"
  - "上传了文档帮我整理"
  - "采集了一批资料帮我整理"
  - "上传了一批文档"
  - "我有一批资料"
---

# 知识整理（knowledge-organizer）

本 skill 只整理用户指定、已存在于本体文件系统中的资料。不得采集、搜索或引入其他渠道素材；知识库候选只可用于既有主流程中的实例消解与融合，不能新增对象或扩大对象范围。

## 工作流脚本

先初始化一次。`--source` 可重复传入；脚本创建任务目录和流程配置，但不扫描或校验素材内容。

```bash
python3 <knowledge-organizer>/scripts/workflow_runner.py init \
  --session-id "{session_id}" \
  --task-name "{任务名称}" \
  --source "{本地素材路径1}" \
  --source "{本地素材路径2}"
```

默认任务目录是：

```text
/by/.sessions/{session_id}/{任务名称}/
```

流程状态与工作产物位于：

```text
/by/.sessions/{session_id}/{任务名称}/knowledge-organizer/
```

从此以后，**只按 Runner 输出的当前步骤完整提示执行**。提示中的其他 skill 路径以 `<skill-name>/...` 表示，由 Agent 自行解析实际路径，绝不依赖当前工作目录。

## 状态协议

每个步骤只能由 Agent 调用以下之一：

```bash
# Agent 认为当前步骤完成后调用；校验通过会直接输出下一步提示。
python3 <knowledge-organizer>/scripts/workflow_runner.py complete \
  --task-dir "{任务目录}" --step "{当前步骤}" [Runner 当前提示要求的参数]

# 当前步骤无法继续完成时调用；流程终止。
python3 <knowledge-organizer>/scripts/workflow_runner.py failed \
  --task-dir "{任务目录}" --step "{当前步骤}" --reason "{具体原因}"
```

- `complete` 校验不通过时，Runner 返回 `incomplete` 与逐项返工原因。必须修复后再次调用 `complete`，不得推进或跳步。
- `complete` 校验通过时，Runner 立即输出下一步完整提示。
- `failed` 仅表示流程级失败：当前步骤无法继续执行。单文件入库失败可重试并作为 Step 7 的可汇总结果，不应直接终止。
- 任务恢复时可调用：

  ```bash
  python3 <knowledge-organizer>/scripts/workflow_runner.py current --task-dir "{任务目录}"
  ```

不要手改 `state.json`、不要跳过 Runner、不要提前读取后续步骤。对象正文、YAML 打标、关系判断和入库仍由本 skill 的主流程执行；Runner 只负责渐进披露、目录/状态控制和产物完备性校验。
