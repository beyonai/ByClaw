# Collection Contract

## 单一状态文件 session.json

自一体化改造起,会话的**权威状态**是 `<session-dir>/session.json`(schemaVersion 2.0),
由 `scripts/knowledge-collection.mjs` 统一读写。其结构:

```jsonc
{
  "schemaVersion": "2.0",
  "task": { "query": "", "mode": "collection", "breadth": 3, "depth": 2, "concurrency": 2,
            "maxContextWords": 25000, "deadlineMinutes": null, "maxBranches": null,
            "maxSourcesPerBranch": null, "maxSearchRounds": null,
            "startedAt": "<iso-time>", "initialSearch": [], "followups": [],
            "combinedQuery": null, "stopReason": null, "status": "initialized" },
  "research": { "branches": [], "learnings": [], "citations": {},
                "context": [], "visitedUrls": [], "reportPath": null },
  "collection": { "schemaVersion": "1.0", "storage": { "fallback": false },
                  "collection": { "status": "complete", "items": [] },
                  "retention": { "auditRequired": false, "userRequested": false },
                  "postProcessing": { "runs": [] } }
}
```

- `task` / `research`: 深化研究状态(研究问题、计划、分支、learnings、citations、context)。
  `task.mode=research` 时 cleanup 要求 report 已交付;`mode=collection` 用于单步采集。
- `collection`: 采集状态,字段与本文档其余章节描述的 metadata 完全一致(见下);
- session.json 只能由脚本命令修改,禁止手工编辑;任何层级出现敏感字段名(token/Cookie/secrets 等)时拒绝持久化。

`collection-result.json` 与 `sanitized/metadata.json` 现在是 **`export-views` 生成的兼容导出视图**:
- `collection-result.json` 同时是执行器的产物输入契约(执行器写入 → `collect` 登记);
- `sanitized/metadata.json` 供 fileBrowser 预览与旧消费者读取,由 `export-views` 从 session.json 重新生成;
- 旧会话(仅有 collection-result.json + sanitized/metadata.json,无 session.json)首次读写自动迁移为 session.json,不删除旧文件。

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

## 已抓好一批正文后登记会话

来源执行器已经把正文抓到会话外的临时目录、要登记成正式会话时（例如把外围素材交给 `tech-article`），
用 `init` + `collect`。**不要手写 metadata inventory**——`collect` 在 inventory 缺该 `itemId` 时会按
`canonicalItem` 自动补登条目，`sourceSkill` 从 `collectionResult.backend` 推导，`materialization`
由脚本按文件存在性写入。手写 inventory 会让你自己承担 `rawArtifacts`、`materialization`、
canonical view 路径形态这些字段的正确性，而这些本来是脚本的职责。

```bash
# 1. init 建空会话。items 给空数组，只声明 backend；backend 决定后续 sourceSkill
echo '{"backend":"bycli","items":[]}' > /tmp/cr.json
node scripts/knowledge-collection.mjs init --mode collection --session-dir <dir> \
  --query "<采集任务>" --collection-result-input-file /tmp/cr.json

# 2. 把正文拷进会话。init 要求目标目录不存在或为空,所以必须在 init 之后拷
cp -r /tmp/harvest/markdown /tmp/harvest/sanitized <dir>/

# 3. 一次 collect 登记全部正文(payload 支持 items 数组批量)
node scripts/knowledge-collection.mjs collect --session-dir <dir> \
  --item-json-file <dir>/.post-processing-inputs/batch.json
```

`collect` 的批量 payload。**前置依赖：会话必须已声明 `backend`**（上面第 1 步的
`--collection-result-input-file`）。`collect` 从**会话已有的** `collectionResult.backend` 推导每个条目的
`sourceSkill`，**不读 payload 里的 `backend` 或 `sourceSkill` 字段**——把它们写进下面的 payload 不起作用，
会话缺 `backend` 时报 `inventory item-01 sourceSkill 必须是非空字符串`。
该报错指向 init 阶段的遗漏，不是 payload 字段缺失，照着改 payload 无法修复。

```json
{
  "schemaVersion": "1.0",
  "items": [
    {
      "itemId": "item-01",
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

单条时也可以直接用上面 `items[]` 中的对象作为根节点（省掉 `items` 包装）。
`canonicalItem.markdown` 与 `fileName` 必须相等且都是相对采集根的完整路径（`sanitized/items/x.md`，不是 basename）。

### 什么时候才需要 `--metadata-input-file`

只有一种情况：需要在建会话时就预置一份**完整清单**，其中包含尚未物化的条目——
例如站点抓取先登记 2215 条 sitemap URL 为 `pending`、随后分批物化，或从旧会话迁移既有 inventory。
此时 `--metadata-input-file` 整体替换 `session.collection`（`research-state.mjs` 内
`session.collection = metadata`），所以必须提交完整子树，并自行保证：

- 每个条目必填非空 `sourceSkill` 与 `sourceUrl`（身份键），以及 `rawArtifacts`（空也要写 `[]`）；
- 已物化条目必须预声明 `materialization`——物化状态只在 `init` 时按文件存在性推导一次，
  事后 `export-views` 不补算；
- canonical view 的 `fileName` 必须等于 inventory 的 `materialization.sanitizedPath`。
  （`validateCanonicalView` 用 `sanitizedPath` 建 map 却用 `fileName` 查，字段名不同但值必须一致，
  填 basename 会报 “canonical view 路径未对应 materialized inventory”。）

除此之外的场景一律走 `collect`。

## 后处理 run payload

`run` 是后处理运行的唯一写入入口,没有更简单的替代入口,所以这份 payload 必须自己写。以 `external` 为例：

```json
{
  "schemaVersion": "1.0",
  "runId": "run-tech-article-1",
  "operation": "external",
  "target": { "kind": "external", "id": "tech-article/jujutsu", "path": "<dir>/sanitized/items" },
  "status": "success",
  "sessionStatus": "success",
  "selection": {
    "mode": "all",
    "itemIds": ["item-01"],
    "discardUnselected": false,
    "discardUnselectedConfirmed": false
  },
  "items": [
    {
      "itemId": "item-01",
      "status": "success",
      "stage": "completed",
      "reason": null,
      "downstreamRef": null,
      "cleanupStatus": "not-started"
    }
  ],
  "globalStage": { "name": null, "required": false, "status": "not-required", "reason": null }
}
```

成功条目的 `stage` 由 operation 决定，写错即拒：

| operation | success item `stage` |
|---|---|
| `ingest` | `build-submitted` |
| `organize` | `ads-organized` |
| `external` | `completed` |

其余易错点：

- `target.kind` 只能是 `knowledge-base` / `knowledge-organization` / `external`，
  external 就写 `external`（不是 `external-task`）。
- `sessionStatus` 枚举是 `success` / `partial` / `failed` / `unknown`，**没有 `complete`**
  （`complete` 属于 `collection.status`，两个枚举不同）；且脚本会重算并校验，与提交值不一致时拒绝写入。
- `downstreamRef` 必填，无下游引用时写 `null`（不能省略）。
- `globalStage`：`required: false` 时 `status` 必须是 `not-required` 且 `name` 必须是 `null`；
  `required: true` 时 `name` 必须是非空字符串且 `status` 不能是 `not-required`。
- `selection.discardUnselected` 与 `discardUnselectedConfirmed` 必须是布尔值，
  只有用户明确确认放弃未选文章时才能同时为 `true`。
