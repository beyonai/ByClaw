# Collection Contract

所有来源执行器都将采集结果规范化为同一套新写入格式。根目录必须包含 `collection-result.json`，其结构固定如下：

```json
{
  "schemaVersion": "1.0",
  "title": "Collection title",
  "source": "public-internet",
  "backend": "bycli",
  "url": "https://example.com/source",
  "filters": {},
  "items": [
    {
      "title": "Item title",
      "url": "https://example.com/item",
      "author": "Author",
      "publishTime": "2026-07-27T00:00:00Z",
      "markdown": "sanitized/items/item-title.md",
      "fileName": "sanitized/items/item-title.md"
    }
  ]
}
```

`source` 表示逻辑来源或业务域，例如 `public-internet`、`dws`、`fws` 或 `wecom`。`backend` 表示最终取得内容的执行器，
例如 `bycli`、`dws`、`fws`、`wecom-cli` 或 `exa`；路由器本身未取得内容时不得写为 `backend`。router、diagnosticBackend、effectiveBackend
等路由与诊断 provenance 写入 `raw/metadata.json` 或 `sanitized/metadata.json`，不得写入 `collection-result.json` 顶层。

`items[].fileName` 必须是相对于采集根目录的相对路径，且对应文件必须存在。`items[].markdown` 保存规范化
Markdown 文件的相对路径。

## Markdown 与筛选条件

每个规范化 Markdown 文件使用以下 frontmatter：

```yaml
---
title: Item title
source: public-internet
source_url: https://example.com/item
collection_filters:
  language: zh-CN
---
```

`collection_filters` 仅记录用户明确指定的筛选条件；不得写入执行器推断、默认或内部筛选条件。

## 原始与净化产物

- `raw/` 保存执行器取得的原始产物，并包含 `raw/metadata.json`。
- `sanitized/` 保存可供预览和后处理的净化产物，并包含 `sanitized/metadata.json`。
- 两个 `metadata.json` 只保存执行、来源和产物描述信息；不得包含 token、Cookie、secrets 或其他凭据。

## Legacy read compatibility

读取历史采集结果时，允许只读兼容 `bycli-output.json`、`--bycli-json-file` 和 Markdown frontmatter 中的
`bycli_filter`。这些字段均为只读兼容入口；新写入不得使用旧格式，必须生成本文件定义的
`collection-result.json` 和 `collection_filters`。
