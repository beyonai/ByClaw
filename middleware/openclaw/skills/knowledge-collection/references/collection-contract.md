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

`collection-result.json.items` 是当前已物化正文视图，允许为空数组。非空时，`items[].fileName` 必须是相对于
采集根目录的相对路径且对应文件必须存在；`items[].markdown` 保存同一个规范化 Markdown 文件的相对路径。
完整文章清单不写入固定顶层字段，而是写入 `sanitized/metadata.json`。
canonical item 只能使用示例中的固定字段；`sourceSkill`、`itemId` 和路由 provenance 只允许出现在
`sanitized/metadata.json`，不得回写到 `collection-result.json.items[]`。

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
- `sanitized/metadata.json` 保存完整文章清单、物化状态、保留策略与后处理运行历史；不得包含 token、Cookie、
  secrets、授权缓存或其他凭据；新版 metadata 任意层级出现敏感字段名时必须拒绝持久化，不能只依赖文件权限。

新写入的 `sanitized/metadata.json` 使用 `schemaVersion: "1.0"`，并包含：

- `storage.fallback`：是否使用工作区回退目录。
- `collection.status`：采集状态 `complete`、`partial` 或 `failed`。
- `collection.items`：完整文章清单。每项使用稳定 `itemId`，并记录 `sourceSkill`、`backend`、`sourceItemId`、
  `sourceUrl`、用户筛选、`rawArtifacts` 及 `materialization`。
- `materialization.status`：`materialized`、`pending` 或 `failed`；已物化时记录准确的 `markdownPath` 与
  `sanitizedPath`，文件删除后相应路径必须置为 `null`。
- `materialization.pendingArtifactCleanup`：等待续清的旧工作副本路径数组，只允许包含 `markdown/` 或
  `sanitized/items/` 下的 Markdown，不得包含共享 `raw/`。
- `retention.auditRequired` 与 `retention.userRequested`：任一为 `true` 时禁止默认清理。
- `postProcessing.runs`：按时间保留每次操作、目标、选择范围、逐篇状态、运行状态和 `cleanupStatus`。新运行只追加；
  同一个 run 的当前状态可原子更新。
- `sourceMetadata`：来源执行器的非敏感版本、任务 ID、范围和诊断信息。

`sourceSkill`、来源 ID/URL、用户筛选和 `rawArtifacts` 组成非敏感恢复描述。缺少净化正文时，采集编排器据此先让
原始执行器从 raw 重新净化；raw 不足时再由同一执行器补采。不得保存恢复所需的凭据。

同一 `sourceSkill + sourceUrl` 视为同一篇文章；inventory 不得存在重复身份，并以最新操作为准。metadata 中的物化路径位于错误目录、文件缺失、
不是普通 Markdown 或与 status 矛盾时，不删除其指向的文件；状态脚本将该文章安全降级为 `pending`、清空无效当前路径、
移出 canonical view 并返回警告，随后由原始执行器重新采集、净化。
`sourceSkill` 与 `sourceUrl` 必须是非空、可恢复的稳定身份；没有网页 URL 的来源必须写入带来源命名空间的稳定 URI（例如
`wecom-message:<message-id>`），不得留空。

只读兼容旧的扁平 `partial`、`storageFallback` 与 `audit_required`；新写入必须使用上述嵌套字段。
新旧字段同时存在时只采用嵌套字段并返回兼容警告，状态脚本下一次成功写入时移除旧扁平字段。新版 metadata
必须严格校验对象、布尔值、枚举和路径状态；retention 缺失、损坏或无法确认时，所有清理安全失败并保留文件。

## Legacy read compatibility

读取历史采集结果时，允许只读兼容 `bycli-output.json`、`--bycli-json-file` 和 Markdown frontmatter 中的
`bycli_filter`。这些字段均为只读兼容入口；新写入不得使用旧格式，必须生成本文件定义的
`collection-result.json` 和 `collection_filters`。
