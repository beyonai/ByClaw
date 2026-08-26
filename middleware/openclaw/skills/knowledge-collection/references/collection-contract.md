# Collection Contract

## 单一状态文件 `session.json`

会话的权威状态是 `<session-dir>/session.json`（`schemaVersion: "2.0"`），由 `scripts/knowledge-collection.mjs` 统一读写。采集状态只描述任务、研究过程、来源 inventory 与正文物化，不追踪交付后的动作。

- `task.sourceScope`：本任务实际允许使用的来源，默认 `public-internet`；企业来源只能因用户点名或明确内部语境加入。
- `task.materializationTarget`：`candidates`、`selected` 或 `all`。
- `collection.collection.status`：`complete`、`partial` 或 `failed`。
- `collection.collection.items`：完整文章清单，可以包含尚未物化的 pending/failed 条目。
- `research`：研究问题、分支、learnings、citations、context 与报告路径。

`session.json` 只能由脚本命令修改，禁止手工编辑；任何层级出现敏感字段名（token、Cookie、secrets 等）时拒绝持久化。

`collection-result.json` 与 `sanitized/metadata.json` 是 `export-views` 生成的兼容导出视图：

- `collection-result.json` 同时是来源执行器的产物输入契约（执行器写入，随后由 `collect` 登记）。
- `sanitized/metadata.json` 供 fileBrowser 预览与旧消费者读取，由权威 session 状态生成。
- 旧会话只有上述两个文件、没有 `session.json` 时，可只读迁移为当前采集状态；旧的下游字段不产生任何可执行行为。

## `collection-result.json`

所有来源执行器都必须规范化为同一套新写入格式。根目录的 `collection-result.json` 结构固定如下：

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

`source` 表示逻辑来源或业务域，例如 `public-internet`、`dws`、`fws` 或 `wecom`。`backend` 表示最终取得内容的执行器，例如 `bycli`、`dws`、`fws`、`wecom-cli` 或 `exa`。router、diagnosticBackend、effectiveBackend 等路由与诊断 provenance 写入 `raw/metadata.json` 或 `sanitized/metadata.json`，不得写入 `collection-result.json` 顶层。

`collection-result.json.items` 是当前已物化正文视图，允许为空数组。非空时，`items[].fileName` 必须是相对于采集根目录的相对路径且对应文件必须存在；`items[].markdown` 保存同一个规范化 Markdown 文件的相对路径。完整文章清单写入 `sanitized/metadata.json`。canonical item 只能使用示例中的固定字段；`sourceSkill`、`itemId` 和路由 provenance 不得回写到 `collection-result.json.items[]`。

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

## 原始、净化与 inventory 产物

- `raw/` 保存来源执行器取得的原始产物，并包含 `raw/metadata.json`。
- `sanitized/` 保存可预览的净化产物，并包含 `sanitized/metadata.json`。
- `sanitized/items/` 是唯一可交给下游 Agent 的正文目录。正文可使用 `sanitized/items/<article-name>-<item-id>/index.md` 的文章目录布局；与正文绑定的本地资源放在同一目录的 `assets/`，并由 Markdown 使用相对链接引用。
- `sanitized/metadata.json` 保存完整文章清单、物化状态和非敏感来源信息；不得包含 token、Cookie、secrets、授权缓存或其他凭据。

### 会话目录边界

同一采集任务只能有一个初始化后的会话根目录。来源执行器或人工补采工具产生的下载目录、图片和原始 Markdown 必须位于该会话的 `raw/` 子树；由此生成的工作副本必须位于 `markdown/items/`，最终正文必须位于 `sanitized/items/`。当原始来源响应已保存文章图片 URL 时，无需在 `raw/` 重复下载图片；交付副本必须位于 `sanitized/items/<article-name>-<item-id>/assets/`，不得仅保留远程图片链接。不得在会话根目录旁创建 `*-fulltext/`、`*-articles/` 或其他自定义交付目录。

出现重复 URL、部分下载失败或正文无法物化时，保留原始证据，并在同一会话 inventory 中登记为重复、`pending` 或 `failed`。这些情况不得触发旁路归档，也不得把会话外文件作为下游正文交付。

新写入的 `sanitized/metadata.json` 使用 `schemaVersion: "1.0"`，并包含：

- `storage.fallback`：是否使用工作区回退目录。
- `collection.status`：采集状态 `complete`、`partial` 或 `failed`。
- `collection.items`：完整文章清单。每项使用稳定 `itemId`，并记录 `sourceSkill`、`backend`、`sourceItemId`、`sourceUrl`、用户筛选、`rawArtifacts` 及 `materialization`。
- `materialization.status`：`materialized`、`pending` 或 `failed`；已物化时记录准确的 `markdownPath` 与 `sanitizedPath`，文件删除或校验失败后相应路径必须置为 `null`。
- `materialization.pendingArtifactCleanup`：仅用于重新物化时清除旧工作副本的内部队列，只允许包含 `markdown/` 或 `sanitized/items/` 下的 Markdown，不得包含共享 `raw/`，也不得用于交付后的清理。
- `sourceMetadata`：来源执行器的非敏感版本、任务 ID、范围和诊断信息。

`sourceSkill`、来源 ID/URL、用户筛选和 `rawArtifacts` 组成非敏感恢复描述。缺少净化正文时，采集编排器据此让原始执行器从 raw 重新净化；raw 不足时再由同一执行器补采。不得保存恢复所需的凭据。

同一 `sourceSkill + sourceUrl` 视为同一来源记录；inventory 不得存在相同来源身份，并以最新采集操作为准。HTTP(S) URL 另按去 fragment、去末尾 `index.html`、统一尾斜杠及 query 参数排序后的值生成 `duplicateGroupKey`。同组的所有来源记录和 provenance 必须保留，第一条为 provenance 主记录，其余条目以 `duplicateOf` 指向主记录；canonical view 每个重复组仅输出按 inventory 顺序选出的首个已物化代表。

非 HTTP(S) 企业稳定 URI（如 `wecom-message:<message-id>`）各自独立，绝不按 URL 规则跨来源合并。metadata 中的物化路径位于错误目录、文件缺失、不是普通 Markdown 或与 status 矛盾时，不删除其指向的文件；状态脚本将该文章安全降级为 `pending`、清空无效当前路径、移出 canonical view 并返回警告，随后由原始执行器重新采集、净化。

`sourceSkill` 与 `sourceUrl` 必须是非空、可恢复的稳定身份；没有网页 URL 的来源必须写入带来源命名空间的稳定 URI，不得留空。

只读兼容旧的扁平 `partial`、`storageFallback` 与 `audit_required`。新写入不得使用旧格式；旧字段不会恢复任何已删除的下游动作。

## Legacy read compatibility

读取历史采集结果时，允许只读兼容 `bycli-output.json`、`--bycli-json-file` 和 Markdown frontmatter 中的 `bycli_filter`。这些字段均为只读兼容入口；新写入不得使用旧格式，必须生成本文件定义的 `collection-result.json` 和 `collection_filters`。

## 已抓好一批正文后登记会话

来源执行器已经把正文抓到会话外的临时目录、要登记成正式会话时，使用 `init` + `collect`。不要手写 metadata inventory；`collect` 会按 `canonicalItem` 登记条目，并根据实际文件状态写入 materialization。

```bash
node scripts/knowledge-collection.mjs init --mode collection --session-dir <dir> \
  --query "<采集任务>" --source-scope '["public-internet"]' \
  --materialization-target all

node scripts/knowledge-collection.mjs collect --session-dir <dir> \
  --item-json-file <dir>/.collection-inputs/collection-item-payload.json
```

`collect` 的批量 payload 如下。首次登记必须由条目显式携带 `source`、`sourceSkill` 和 `backend`；它们会建立会话的来源兼容视图。已有旧会话仍可从 `collection-result.json` 回退推导这些字段。

```json
{
  "schemaVersion": "1.0",
  "items": [
    {
      "itemId": "item-01",
      "source": "public-internet",
      "sourceSkill": "bycli",
      "backend": "bycli",
      "markdownPath": "markdown/post.md",
      "sanitizedPath": "sanitized/items/post.md",
      "canonicalItem": {
        "title": "Post title",
        "url": "https://example.com/post",
        "author": "",
        "publishTime": "",
        "markdown": "sanitized/items/post.md",
        "fileName": "sanitized/items/post.md"
      }
    }
  ]
}
```

payload 文件必须位于当前会话的 `.collection-inputs/` 内，成功登记后会被删除。单条时也可直接使用上面 `items[]` 中的对象作为根节点。`source` 必须对应父会话的 `task.sourceScope`（`dws → dingtalk`、`fws → feishu`）；`canonicalItem.markdown` 与 `fileName` 必须相等且都是相对采集根的完整路径。

只有需要在建会话时预置包含 pending 条目的完整清单，才使用 `--metadata-input-file`。只有导入历史兼容视图时才需要 `--collection-result-input-file`；新会话的第一次 `collect` 不再要求预置它。除此之外一律通过 `collect` 登记。

## 交付

运行 `status` 后，只交付 `status.downstreamInput.files` 列出的、已验证存在于 `sanitized/items/` 下的 Markdown。详细终止规则见 [delivery.md](delivery.md)。
