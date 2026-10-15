---
name: by-knowledge-manager-entity
description: "在 ByClaw 知识库中发起异步知识实体发现或补全。用于从原始文档生成 KnowledgeEntity 文档，或补全 KnowledgeEntity 文档中的实体信息、证据和关系。"
---

# 处理知识实体

这里的 `KnowledgeEntity` 是知识库内的 Markdown 文档目录，不是本体对象库。两个命令都要求当前用户拥有知识库管理权限。

两个实体命令都支持可选参数 `--session-id SESSION_ID`。当前任务上下文存在会话 ID 时，必须显式传入 `--session-id`，不得省略，也不得依赖运行环境代为发现，以便向对应会话空间发送实体文件变更通知。只有当前任务上下文没有会话 ID 时才可省略；此时实体处理任务照常提交，但不会发送 `X-CHAT-SESSION-ID`，也不会向会话空间发送实体文件变更通知。

## 发现实体

```bash
python3 <by-knowledge-manager目录>/scripts/by_knowledge_manager.py entity-discovery \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md \
  --max-entities 12 \
  --extra-params-json '{"requestSource":"manual"}'
```

省略 `--file-path` 时扫描整库中的合格原始文档。单文件支持 `.csv`、`.htm`、`.html`、`.markdown`、`.md` 和 `.txt`；不要把 `/KnowledgeEntity` 下的文件作为发现输入。

## 补全实体

```bash
python3 <by-knowledge-manager目录>/scripts/by_knowledge_manager.py entity-enrich \
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
- 如果用户已配置可用的钉钉连接器并完成必要授权，实体发现或补全批次完成后，系统会向该用户的钉钉推送任务完成信息。
