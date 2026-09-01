# Collection Contract

## 单一状态文件 `session.json`

会话的权威状态是 `<session-dir>/session.json`（`schemaVersion: "2.0"`），由 `scripts/knowledge-collection.mjs` 统一读写。采集状态描述任务、研究过程、来源 inventory 与正文物化；可选的顶层 `delivery` 只记录本次用户文件交付的校验回执，不追踪下游业务动作。

- `task.sourceScope`：本任务实际允许使用的来源，默认 `public-internet`；企业来源只能因用户点名或明确内部语境加入。
- `task.materializationTarget`：`candidates`、`selected` 或 `all`。
- `task.discoveryGate`：公共来源授权状态，记录最多两轮发现、分类后的候选、耗尽状态与 `stopReason`。用户明确提供的 URL 由 `init --direct-urls` 登记为 `origin=user-provided`；Agent 自己发现或记忆的 URL 不得放入该参数。
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

在用户沙箱中，没有显式保存路径时推荐把采集会话根放在当前聊天会话的
`/by/.sessions/<sessionId>/collections/<task-name>/`。用户提供的保存路径是交付目录，不是采集会话目录；此时内部会话必须放在
`<Session Root>/.collection-runs/<run-id>/`，保存路径只传给最终 `publish`。`sessionId` 取自 Agent 上下文提供的 Session Root，不能从登录认证
环境变量或 Cookie 推导。对外路径参数以 `/` 开头时按绝对路径使用，可指向沙箱内任意可写位置；相对路径以可信的
`--session-root /by/.sessions/<sessionId>` 为基准解析，不得依赖进程当前目录。相对路径规范化后的结果以及其真实祖先
不得通过 `..` 或符号链接越出该 Session Root。绝对历史会话和绝对输出路径不要求属于当前 Session Root。

同一采集任务只能有一个初始化后的会话根目录。来源执行器或人工补采工具产生的下载目录、图片和原始 Markdown 必须位于该会话的 `raw/` 子树；由此生成的工作副本必须位于 `markdown/items/`，最终正文必须位于 `sanitized/items/`。当原始来源响应已保存文章图片 URL 时，无需在 `raw/` 重复下载图片；只有获准来源执行器取得的交付副本才能写入 `sanitized/items/<article-name>-<item-id>/assets/`。不得绕过来源执行器直接 HTTP 补抓、不得保留远程图片链接，也不得伪造本地资源路径。封面与正文在同一条目中处理，但媒体状态与正文物化状态相互独立：封面失败只登记媒体缺口，不得把已经成功取得的正文标记为失败；Markdown 只能引用实际成功落盘的本地封面。不得在会话根目录旁创建 `*-fulltext/`、`*-articles/` 或其他自定义交付目录。

单一企业来源的 `enterprise search` 必须原位发布：`--output-dir` 必须等于 `--parent-session-dir`。禁止在 `raw/` 下创建第二个完整采集会话；`raw/ima/sanitized/items`、`raw/dingtalk/session.json` 等嵌套会话或交付结构均无效。旧调用若把 `--output-dir` 指向父会话的 `raw/` 子树，runner 会将其归一到父会话根，最终正文仍只能落在根级 `sanitized/items/`。

出现重复 URL、部分下载失败或正文无法物化时，保留原始证据，并在同一会话 inventory 中登记为重复、`pending` 或 `failed`。这些情况不得触发旁路归档，也不得把未经 `publish` 交付校验的会话外文件作为下游正文交付。

新写入的 `sanitized/metadata.json` 使用 `schemaVersion: "1.0"`，并包含：

- `storage.fallback`：是否使用工作区回退目录。
- `collection.status`：采集状态 `complete`、`partial` 或 `failed`。
- `collection.items`：完整文章清单。每项使用稳定 `itemId`，并记录 `sourceSkill`、`backend`、`sourceItemId`、`sourceUrl`、用户筛选、`rawArtifacts` 及 `materialization`。公共发现条目还记录 `discoveryCandidateId`，它必须指向本会话 `task.discoveryGate.candidates` 中的 `article` 或用户明确提供的 URL。
- `materialization.status`：`materialized`、`pending` 或 `failed`；已物化时记录准确的 `markdownPath` 与 `sanitizedPath`，文件删除或校验失败后相应路径必须置为 `null`。
- `materialization.contentGranularity`：`full-text`、`excerpt`、`abstract` 或 `unknown`，表示正文内容粒度，与 `materialization.status`、`collection.status` 和 `deliveryComplete` 正交。旧会话或缺失字段一律按 `unknown`，不得默认 `full-text`；普通 `content`、`markdown` 或字数不能单独证明全文完整。
- `fullTextEvidence`：公共来源声明 `full-text` 时必填，记录 `schemaVersion`、获准 `executor` 和位于 `raw/` 的结构化 `artifact`。回执必须确认相同来源 URL、相同执行器、`complete=true` 与 `contentGranularity=full-text`，并同时登记在 `rawArtifacts`。只有获准来源执行器或专用 materializer 可以生成并在 `session.task.fullTextEvidenceReceipts` 注册该回执及哈希，不得由 Agent 手写；缺少注册、内容变化或字段不匹配时 `collect` 拒绝全文声明。
- `media`：文章媒体覆盖状态。`coverStatus` 为 `not-present`、`materialized`、`unavailable` 或 `unknown`，并记录 `coverCount`、`materializedCoverCount` 与非敏感 `reason`。`unavailable` 表示至少一个已知封面未能物化，允许 `materializedCoverCount` 小于 `coverCount` 以表达部分成功。旧会话缺失或含非法 media 状态时只读归一为 `unknown`，使用 `reason=legacy-media-state-unknown`；不得猜测为无封面或已物化。
- `materialization.pendingArtifactCleanup`：仅用于重新物化时清除旧工作副本的内部队列，只允许包含 `markdown/` 或 `sanitized/items/` 下的 Markdown，不得包含共享 `raw/`，也不得用于交付后的清理。
- `sourceMetadata`：来源执行器的非敏感版本、任务 ID、范围和诊断信息。

`sourceSkill`、来源 ID/URL、用户筛选和 `rawArtifacts` 组成非敏感恢复描述。缺少净化正文时，采集编排器据此让原始执行器从 raw 重新净化；raw 不足时再由同一执行器补采。不得保存恢复所需的凭据。

公共互联网新会话默认启用发现门禁。`public-discover` 原子登记 query、category、候选分类和最多两轮的调用状态；`collect` 与 pending inventory 写入会按规范化 URL 解析候选并持久化 `discoveryCandidateId`。不在候选中的 URL、`weak`/`reject` 候选以及 Agent 手工补充的 URL 一律以 `SOURCE_NOT_AUTHORIZED_BY_DISCOVERY` 拒绝。旧会话缺少 `task.discoveryGate` 时保持只读兼容；一旦调用 `public-discover`，该会话即启用门禁。

同一 `sourceSkill + sourceUrl` 视为同一来源记录；inventory 不得存在相同来源身份，并以最新采集操作为准。HTTP(S) URL 另按去 fragment、去末尾 `index.html`、统一尾斜杠及 query 参数排序后的值生成 `duplicateGroupKey`。同组的所有来源记录和 provenance 必须保留，第一条为 provenance 主记录，其余条目以 `duplicateOf` 指向主记录；canonical view 每个重复组仅输出按 inventory 顺序选出的首个已物化代表。

非 HTTP(S) 企业稳定 URI（如 `wecom-message:<message-id>`）各自独立，绝不按 URL 规则跨来源合并。metadata 中的物化路径位于错误目录、文件缺失、不是普通 Markdown 或与 status 矛盾时，不删除其指向的文件；状态脚本将该文章安全降级为 `pending`、清空无效当前路径、移出 canonical view 并返回警告，随后由原始执行器重新采集、净化。

`sourceSkill` 与 `sourceUrl` 必须是非空、可恢复的稳定身份；没有网页 URL 的来源必须写入带来源命名空间的稳定 URI，不得留空。

只读兼容旧的扁平 `partial`、`storageFallback` 与 `audit_required`。新写入不得使用旧格式；旧字段不会恢复任何已删除的下游动作。

`status` 和其他 inspect 路径对现有会话必须严格只读；兼容归一化只存在于返回结果中，不得回写 `session.json`、metadata 或其他会话文件。

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
      "rawArtifacts": ["raw/source-response.json"],
      "contentGranularity": "unknown",
      "media": {
        "coverStatus": "not-present",
        "coverCount": 0,
        "materializedCoverCount": 0,
        "reason": null
      },
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

`rawArtifacts` 是可选的来源恢复证据列表。每个显式登记的文件必须位于 `raw/`、真实存在、非空、可读且不是符号链接；重复路径按首次出现顺序去重。`rawArtifacts` 省略时保留 inventory 中已有的列表，显式传入时替换当前列表，传入空数组表示明确清空当前来源证据。

公共来源只有在执行器或专用 materializer 生成 `fullTextEvidence` 时才能把 `contentGranularity` 设为 `full-text`。证据对象不得由 Agent 手写，其 `artifact` 必须同时位于 `rawArtifacts`；否则使用 `unknown`、`excerpt` 或 `abstract` 的实际粒度。

只有需要在建会话时预置包含 pending 条目的完整清单，才使用 `--metadata-input-file`。只有导入历史兼容视图时才需要 `--collection-result-input-file`；新会话的第一次 `collect` 不再要求预置它。除此之外一律通过 `collect` 登记。

## 微信下载结果物化

对 `bycli weixin download` 已保存到会话 `raw/` 下的结果，使用：

```bash
node scripts/knowledge-collection.mjs materialize-wechat --session-dir <dir> \
  --executor-result-file <dir>/raw/bycli/weixin/<item-id>/download-result.json \
  --item-id <item-id>
```

执行器结果 JSON 必须记录成功状态、`saved`、实际字节数、标题、作者、发布时间、`source_url` 和可信的
`resolved_url=https://mp.weixin.qq.com/s...`。命令只删除确定的微信 UI、远程图片引用和纯推荐链接块，保留正文结语与作者免责声明；
高置信度时写入 `markdown/items/<item-id>/index.md`、`sanitized/items/<item-id>/index.md` 并返回
`.collection-inputs/` 下的 `collectPayloadPath`。低置信度、登录页或疑似截断内容不生成 payload，而是保留 raw 证据并登记
`materialization.status=pending`、`contentGranularity=unknown`，原因固定为 `wechat-materialization-low-confidence`。
不得用正文长度或清洗成功本身把 unknown 提升为 full-text，也不得手工编辑 session inventory。

## 交付

运行 `status` 后，只有 `status.collection.deliveryComplete=true` 才能执行用户文件发布：

```bash
node scripts/knowledge-collection.mjs publish --session-dir <dir> --delivery-dir <path>
```

相对 `<path>` 必须补充 `--session-root <Session Root>`；绝对路径保持原位置。目标不存在或为空时直接成为
`actualDirectory`。目标非空时，在其中创建 `<task-slug>-collection-<short-run-id>/`，不得覆盖或删除目标目录中已有的未知内容。
`<task-slug>` 优先来自首个已物化代表条目的标题，并限制为简短稳定名称；不得直接截取整段用户问题。`deliveryComplete=true` 之前以及 `publish` 调用之前不得创建或写入用户交付目录。
目标是 `/`、普通文件或符号链接时拒绝。发布内容只来自 `status.downstreamInput.files`，并且只复制 Markdown 引用的本地图片；
`raw/`、`markdown/`、metadata、状态文件和未引用图片不会发布。

发布使用临时目录和原子改名，并在 `session.delivery` 中记录 `schemaVersion: "1.0"`、`status`、`planHash`、请求/实际目录、
正文与图片的 source/target/hash 计划和时间。`status` 为 `planned`、`published`、`stale` 或 `failed`；写入用户目录前先持久化
`planned`，最终文件复验和状态落盘完成后才变为 `published`。来源变化时交付为 `stale`；目标内容被修改、增减未知文件或目录时
为 `failed`，不得覆盖。发布器同时持有会话锁和按请求路径派生的目标锁；异常留下的 staging 只能按计划中记录的精确路径与所有权
标记恢复或清理，不得通配删除。
只有目标仍与上次回执完全一致时，才能在同一个 `actualDirectory` 重新发布。

未指定保存路径时，只交付 `status.downstreamInput.files` 列出的内部 Markdown。指定保存路径且发布成功时，交付
`publish.deliveryInput`；详细终止与跨 Agent 规则见 [delivery.md](delivery.md)。
