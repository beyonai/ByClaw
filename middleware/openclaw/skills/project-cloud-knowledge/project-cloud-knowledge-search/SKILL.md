---
name: project-cloud-knowledge-search
description: "检索一个或多个 ByClaw 知识库或项目云盘。用于语义切片检索、文件级检索、选择全文/向量/混合召回模式，以及使用 Agent DSL 按系统文件属性或自定义元数据过滤结果。"
---

# 检索知识库

使用父 Skill 的 Python CLI 执行 `search` 或 `search-file`。

## 选择检索方式

- 需要命中文本、评分和行范围时使用 `search`。
- 只需要定位相关文件时使用 `search-file`。
- 需要结构化过滤时传 `--where-json`。编写过滤条件前必须读取 [`../references/agent-dsl.md`](../references/agent-dsl.md)，不要凭印象编造操作符。
- 需要返回元数据值时，对每个字段重复传入 `--metadata-field`。
- 默认使用 `mixedRecall`；只有用户或场景明确要求时才改为 `fullTextRecall` 或 `embedding`。

## 执行切片检索

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py search \
  --resource-id RESOURCE_ID \
  --query "员工请假流程是什么" \
  --top-k 20
```

多知识库检索时重复传入 `--resource-id`。

带 DSL 和元数据返回字段的检索：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py search \
  --resource-id RESOURCE_ID \
  --query "合同续签" \
  --where-json '{"and":[{"eq":{"fieldName":"status","value":"active"}},{"contains":{"fieldName":"tags","value":"contract"}}]}' \
  --metadata-field status \
  --metadata-field tags \
  --search-mode mixedRecall \
  --top-k 10
```

结果字段包括 `resourceId`、`filePath`、`chunkNo`、`chunkText`、`score`、可选行范围、`imagePath` 和请求的 `metadata`。按文件路径与行范围引用结果。

## 执行文件检索

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py search-file \
  --resource-id RESOURCE_ID \
  --query "故障" \
  --where-json '{"prefix":{"fieldName":"fileName","value":"运维"}}' \
  --metadata-field fileType \
  --top-k 10
```

结果字段包括 `resourceId`、`filePath`、`score` 和可选 `metadata`。需要查看正文时读取只读子 Skill，再使用 `read-file` 或 `download`。

## 修正 DSL 错误

CLI 会先校验 AST 结构、布尔深度、叶子数量和基础值形状；字段是否存在、字段类型与操作符是否匹配由后端校验。

后端返回 DSL 校验错误时，根据 `errorList[].path`、`errorList[].code` 和 `errorList[].message` 修正，不要移除过滤条件后静默重试。
