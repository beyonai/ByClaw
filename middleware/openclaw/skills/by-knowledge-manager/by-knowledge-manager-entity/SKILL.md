---
name: by-knowledge-manager-entity
description: "在 ByClaw 知识库中发起异步知识实体发现或补全。用于从原始文档生成 KnowledgeEntity 文档，或补全 KnowledgeEntity 文档中的实体信息、证据和关系。"
---

# 处理知识实体

这里的 `KnowledgeEntity` 是知识库内的 Markdown 文档目录，不是本体对象库。两个命令都要求当前用户拥有知识库管理权限。

## 发现实体

```bash
python3 <by-knowledge-manager目录>/scripts/by_knowledge_manager.py entity-discovery \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md \
  --max-entities 12 \
  --session-id SESSION_ID \
  --extra-params-json '{"requestSource":"manual"}'
```

省略 `--file-path` 时扫描整库中的合格原始文档。单文件支持 `.csv`、`.htm`、`.html`、`.markdown`、`.md` 和 `.txt`；不要把 `/KnowledgeEntity` 下的文件作为发现输入。

## 补全实体

```bash
python3 <by-knowledge-manager目录>/scripts/by_knowledge_manager.py entity-enrich \
  --resource-id RESOURCE_ID \
  --file-path /KnowledgeEntity/示例实体.md \
  --top-k 20 \
  --session-id SESSION_ID
```

省略 `--file-path` 时处理 `/KnowledgeEntity` 下的全部合格实体文档。

## 控制与汇报

- 当前任务上下文有会话 ID 时通过 `--session-id` 显式传入；CLI 发送 `X-CHAT-SESSION-ID`，但不会自行发现或猜测。
- 只在用户明确要求重新处理时传 `--force`；否则允许后端复用活动任务或新鲜结果。
- 成功响应只表示异步批次已受理或复用。汇报 `scope`、`batchId`、各项计数，以及 `tasks` 中的 `taskId`、`status`、`filePath`、`reused` 和 `skipReason`。
- 不得把受理成功表述为实体处理已经完成。

Worker 报 `missing beyond-token and X-User-Code` 时，这是当前门户未向 QA 转发 `X-User-Code` 的后端限制；客户端重复传 Header 无法绕过，应修复门户转发逻辑。
