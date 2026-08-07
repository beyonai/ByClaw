---
name: knowledge-organizer-ingest
description: Use when an initialized knowledge-organizer task must store one or more user-provided Markdown or text files as ODS source documents.
allowed-tools: read, exec
---

# 写入 ODS 原始文档

只负责将已有 `.md` 或 `.txt` 文件快照并写入已授权的 ODS 对象。不得初始化对象、抽取 ADS 碎片或提交构建。

## 执行

每个文件单独调用一次：

```bash
python3 <knowledge-organizer>/scripts/knowledge_organizer.py ingest \
  --task-dir "{完整任务目录}" \
  --source "{原始文件绝对路径}" \
  --object-code "{ODS对象编码}" \
  --storage-file-name "{有语义的文件名.md}" \
  --labels-json '{"属性编码":"仅填写原文有依据的值"}'
```

`source` 必须是存在的 `.md`/`.txt` 文件；`object-code` 必须来自初始化快照且属于 ODS；文件名必须有语义且不能使用 `document`、`attachment` 等占位名；labels 只能使用对象 `properties` 中声明的字段，值只能来自原文。

## 完成标准

成功结果中的 `term_id` 是 ODS 实例 ID，CLI 会将原文快照、时间戳路径和状态写入 `state.json`。单文件失败只报告 CLI 错误并保留失败记录，不得手工重试底层接口；成功入库后才能执行 `knowledge-organizer-organize`。
