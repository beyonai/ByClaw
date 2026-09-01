---
name: project-cloud-knowledge-entity
description: "在 ByClaw 知识库或项目云盘中发起异步知识实体发现或补全。用于从单个原始文档、指定目录或整库生成 KnowledgeEntity 文档，或补全 KnowledgeEntity 文档中的实体信息、证据和关系。"
---

# 处理知识实体

这里的 `KnowledgeEntity` 是知识库内的 Markdown 文档目录，不是本体对象库。两个命令都要求当前用户拥有知识库管理权限。

两个实体命令都支持可选参数 `--session-id SESSION_ID`。当前任务上下文存在会话 ID 时，必须显式传入 `--session-id`，不得省略，也不得依赖运行环境代为发现，以便向对应会话空间发送实体文件变更通知。只有当前任务上下文没有会话 ID 时才可省略；此时实体处理任务照常提交，但不会发送 `X-CHAT-SESSION-ID`，也不会向会话空间发送实体文件变更通知。

## 项目云盘授权与成本提示

项目云盘支持实体发现和实体补全，但不得主动触发：

- 只有用户当前输入明确要求实体发现、实体补全或包含相应阶段的完整链路时，才可提交对应命令。
- 用户只提出“知识整理”等概括目标，或阶段选择不明确时，先询问要执行实体发现、实体补全还是两者；询问中必须说明这些都是**高 Token 消耗、高耗时**的异步操作。
- 用户未明确选择前，不得把项目云盘入库、文件构建完成或其他阶段成功视为实体处理授权。

## 发现实体

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py entity-discovery \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md \
  --max-entities 12 \
  --extra-params-json '{"requestSource":"manual"}'
```

实体发现支持三种范围：

- 传 `--file-path` 时只处理指定的单个原始文档。文件支持 `.csv`、`.htm`、`.html`、`.markdown`、`.md` 和 `.txt`。
- 传 `--directory-path` 时递归处理指定目录及其子目录中的合格原始文档。
- 两者都省略时扫描整库中的合格原始文档。

`--file-path` 与 `--directory-path` 不能同时传入。任何范围都不要把 `/KnowledgeEntity` 下的文件作为发现输入。

指定目录示例：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py entity-discovery \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --max-entities 12
```

## 补全实体

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py entity-enrich \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --file-path /KnowledgeEntity/示例实体.md \
  --top-k 20
```

省略 `--file-path` 时处理 `/KnowledgeEntity` 下的全部合格实体文档。

## 控制与汇报

- 只在用户明确要求重新处理时传 `--force`；否则允许后端复用活动任务或新鲜结果。
- 成功响应只表示异步批次已受理或复用。汇报 `scope`、`batchId`、各项计数，以及 `tasks` 中的 `taskId`、`status`、`filePath`、`reused` 和 `skipReason`。
- 不得把受理成功表述为实体处理已经完成。
- 每次提交或复用实体发现、实体补全批次后，都要明确告诉用户：如果已经配置可用的钉钉连接器并完成必要授权，任务完成后会推送通知到钉钉。
