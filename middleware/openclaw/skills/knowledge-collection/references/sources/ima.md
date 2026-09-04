# IMA 采集桥接

IMA 采集意图由 `knowledge-collection` 统一编排，所有 IMA 数据读取统一通过浏览器支持的 byCLI IMA adapter 完成。指定知识库时执行 `bycli ima knowledge <knowledgeBase> -f json`；未指定知识库时先执行 `bycli ima knowledge-list -f json`，再对返回的知识库按 `--concurrency` 上限执行 `bycli ima knowledge <knowledgeBase> -f json`。不得调用独立 IMA OpenAPI 命令、curl、wget、任意手写 HTTP 或直接调用上游 API 获取 IMA 数据。

IMA adapter 返回可信的 `https://mp.weixin.qq.com/s...` 文章 URL 时，正文继续交给 `bycli weixin download`；这是对已发现原文 URL 的来源执行。另一个窄化例外是 adapter 内置的受控 HTTP(S) 下载器：它只能下载 `bycli ima knowledge` 原始响应中的 `coverUrls`，用于把封面与正文一起物化，不能用于发现、正文采集或任意 URL 下载。

## 来源路由

| 输入或意图 | byCLI 能力 |
| --- | --- |
| 指定 IMA 知识库 | `bycli ima knowledge <knowledgeBase> -f json` |
| 未指定知识库 | `bycli ima knowledge-list -f json` 后逐库调用 `bycli ima knowledge <knowledgeBase> -f json` |
| 已发现的微信公众号文章原文 | `bycli weixin download --url <sourceUrl> --output <session/raw/...> --download-images true --site-session persistent --keep-tab true -f json` |
| 非微信公众号条目 | 只使用 `bycli ima knowledge` 返回的 `introduction`、`abstract` 或其他已有内容字段，不额外查询正文 |

## 执行、筛选与认证

1. `bycli ima` 是浏览器支持的 adapter，遵循主 Skill 的 bridge bootstrap 单一恢复所有者规则。根 Agent 不得直接运行 browser、doctor、daemon status、restart 或其他诊断/恢复命令；collection Runner 返回最终 bridge 状态后也不得再次恢复或重试。
2. 指定知识库时，把用户提供的知识库完整名称或 ID 原样传给 `knowledge`。未指定知识库时，从 `knowledge-list` 中优先读取稳定 ID，缺少 ID 时才使用完整名称，按选择器去重后最多调度 500 个唯一知识库，并使用 `--concurrency`（1..16，默认 4）分批读取；当前批次已达到 `limit` 后不得继续调度后续知识库。超过 500 个唯一知识库时把 `knowledge-base-budget-exhausted` 记为覆盖缺口。条目物化复用同一并发上限；并发完成顺序不得改变知识库顺序、来源排名或最终 inventory 顺序。
3. 未指定知识库时必须在本地筛选：规范化查询词后，对标题、文件夹路径、摘要、导语、标签、来源路径和 URL 做不区分大小写的匹配；跨库合并后按来源条目和 `sourceUrl` 去重，最后应用 `limit`。不得把查询词拼入网页脚本或改写知识库选择器。
4. 单个知识库读取失败时记录非敏感失败原因并继续其他知识库；只要至少一个知识库读取成功，就保留成功结果并在 discovery metadata 中报告部分失败。所有终态失败都必须写出 `collection.status=failed` 且 `publicationStatus=committed` 的完整 bundle，不得留下仅 initialized 的会话：登录或授权失效返回 `status=auth_required`、`reasonCode=AUTH_REQUIRED`；无效响应返回 `status=failed`、`reasonCode=INVALID_RESPONSE`；其他来源失败返回 `status=failed`、`reasonCode=SOURCE_FAILED`。对应 reason code 为 `AUTH_REQUIRED`、`INVALID_RESPONSE`、`SOURCE_FAILED`。认证数据不得读取或展示；需要登录时只提示用户在 IMA 网页完成登录。
5. bridge 不可用时返回 `status=bridge_unavailable`、`reasonCode=BRIDGE_UNAVAILABLE`；已有其他任务持有 bridge 恢复权时返回 `status=bridge_recovery_busy`、`reasonCode=BRIDGE_RECOVERY_BUSY`。指定知识库的 `knowledge` 调用失败或返回无效 JSON 时直接写失败 bundle，不切换到其他 IMA 获取方式。有效空列表是成功结果，不得伪造记录。Runner 返回上述结构化终态后停止，不得降级为普通 stderr、外层重试或另一获取方式。
6. IMA 桥接只允许搜索、读取和采集知识库条目；URL 导入等写入能力不属于本技能。
7. 单一 IMA 采集会话中，`enterprise search` 的 `--output-dir` 必须等于 `--parent-session-dir`，`--query` 必须与父会话 `task.query` 完全一致（只忽略首尾空白）；不得另行改写主题或把结果写入脱离父任务的新会话。metadata-only 候选的 `enterprise materialize` 也必须令 `--session-dir` 与 `--output-dir` 指向同一个发现会话；dispatcher 和 adapter 都拒绝为 IMA 指定新输出会话。这样原 `query`、`sourceScope`、`materializationTarget`、`requiredContentGranularity` 与 `deliveryRequested` 会继续由同一 `session.json` 持有。凡向既有会话根写入 bundle，搜索必须在打开 initialized 会话前取得独占会话锁，原地物化必须在读取候选前取得独占会话锁；两者都要持锁到 bundle 成功提交、失败回滚或 writer 放弃后才释放，并拒绝并发写者。发布前必须用 manifest 记录原 initialized 或 committed 会话实际存在的三个兼容视图，先写入 `uncommitted` 标记再更新兼容视图；失败或进程中断时恢复原有视图并最后恢复 `session.json`，下一次持锁调用也必须能幂等完成恢复。禁止把 `raw/ima/` 初始化成第二个会话，也不得交付 `raw/ima/sanitized/items`；最终正文只能位于会话根级 `sanitized/items/`。

## 规范化产物

IMA 搜索和 materialize 遵循统一 collection contract：

```text
collection-result.json
raw/
  metadata.json
  bycli-knowledge-list.json       # 仅未指定知识库时存在
  bycli-knowledge.json            # 指定单一知识库时存在
  bycli-knowledge-<hash>.json     # 未指定知识库时每库一份
markdown/items/<article-name>-<item-id>/index.md
sanitized/items/<article-name>-<item-id>/
  index.md
  assets/*  # 仅在获准来源执行器确实物化媒体时存在
```

`bycli ima knowledge` 返回的 `coverUrls` 是 IMA 条目封面来源，物化时必须保留该字段；不得猜测、扩展或搜索额外图片 URL。IMA adapter 的受控 HTTP(S) 下载器只接受这些来源 URL，并执行以下硬限制：仅 HTTP 或 HTTPS 且 URL 不得带凭据；最多 10 MiB；总超时 15 秒；最多 3 次重定向且每个目标都必须重新通过 HTTP(S) 校验；同时按 `Content-Length` 和流式累计字节数限流；只接受 JPEG、PNG、GIF、WebP MIME 类型。

封面与正文必须作为同一条目一起处理。成功取得的封面写入该文章的 `sanitized/items/<article-name>-<item-id>/assets/`，正文只以本地相对链接引用这些已落盘封面；全部封面成功时登记 `media.coverStatus=materialized`。封面失败不改变正文的物化状态：正文成功时仍登记 `materialization.status=materialized` 并进入 canonical view；媒体单独登记 `media.coverStatus=unavailable`、原始封面数、成功封面数和非敏感失败类别。不得插入失败封面的远程链接或虚构路径，也不得泄露带签名的 URL。

记录带有可信微信公众号原文 URL 时，IMA adapter 必须优先执行 `bycli weixin download`，读取其成功结果中的 `saved` Markdown，把正文内图片复制到该条目的本地 `assets/article-images/` 并重写相对链接；确认文件可读且非空后才登记 `full-text`。该下载失败时不得切换到其他 IMA 获取方式，但原始记录已有 `abstract` 或 `introduction` 时可以降级物化为 `abstract` 或 `excerpt`。非微信公众号 URL 或无 URL 的条目只能使用 adapter 已返回的摘要或导语；没有可用内容时登记物化失败。所有降级仍使用 `<article-name>-<item-id>` 目录和受控封面下载器。不得手工复制 Markdown、不得改用 `ima-<item-id>` 平铺目录、不得跳过封面下载，也不得把失败库存条目改写成已物化。

每个 materialized IMA 条目必须写入 `materialization.contentGranularity`：明确的完整性证据才允许 `full-text`；存在导语时标记为 `excerpt`；仅摘要为 `abstract`；其他已有内容字段或无法证明完整度时为 `unknown`。旧会话缺失字段一律按 `unknown`，不得默认 `full-text`。该字段不改变条目的 `materialized` 状态或 collection 的 `complete` 状态；当原会话要求 `requiredContentGranularity=full-text` 时，它必须参与下游 `deliveryComplete` 判定，摘要、节选和 `unknown` 均不能满足全文交付。

旧会话缺失或含非法 media 状态时，读取结果按 `media.coverStatus=unknown`、`reason=legacy-media-state-unknown` 报告；只读 `status` 不得因此修改原会话文件。

当 IMA 条目需要通过其他获准工具补抓全文时，下载工具的原始目录及图片必须写入当前会话的 `raw/` 子树；随后由 adapter 登记为当前会话的 `markdown/items/<article-name>-<item-id>/index.md` 与 `sanitized/items/<article-name>-<item-id>/index.md`，并把正文引用的本地图片物化到对应 `sanitized/.../assets/`。不得创建 IMA collection 会话外的全文或摘要目录。`bycli ima knowledge` 返回相同 `sourceUrl` 的多个记录时，adapter 只登记第一个来源项，完整原始响应仍保留在对应 `raw/bycli-knowledge*.json`。

`collection-result.json` 和 inventory 的执行身份统一写为 `source=ima`、`backend=bycli`，inventory 的 `sourceSkill` 写 `bycli`：`source` 表示业务来源，`backend` 表示实际取得数据的执行器。新物化条目的 `markdown/items/` 与 `sanitized/items/` 必须使用相同目录名：清洗后的文章标题前 5 个 Unicode 可见字符加稳定 `itemId`；完整标题仍保留在正文元数据和 inventory 中。旧会话路径不迁移。

metadata-only 会话恢复物化时，执行 `enterprise materialize --source ima --session-dir <ima-session> --output-dir <ima-session> --item-ids <id[,id...]> [--concurrency 1..16]`。物化结果原地替换该会话的候选视图，同时保留每条 inventory 自身的知识库名称；全部条目来自同一知识库时把名称写入 `collection-result.json.filters.kb` 和 `sourceMetadata.kb`，来自多个知识库时不写会话级 `kb`，不得丢失或覆盖条目级 `kb`。

执行企业 `search`、`search-all` 或 `resource` 时必须传入已授权 IMA 的 `--parent-session-dir`；metadata-only 输出会直接带有完整 `session.json`。单来源 `search` 的候选直接在该会话原地物化。`search-all` 聚合会话与 IMA 子会话都必须继承父会话的原始 `query`、`materializationTarget`、`requiredContentGranularity` 与 `deliveryRequested`，但子会话 `sourceScope` 只保留 `ima`，不得扩大授权范围；包含 IMA 的 `search-all --query` 同样必须与父会话 `task.query` 完全一致。父会话和聚合会话必须使用互不包含的独立会话树，通常放在同一 Session Root 下的兄弟目录，禁止让 `--output-root` 等于、包含或位于 `--parent-session-dir` 内。IMA 候选位于 `<output-root>/ima`：选中条目时必须把该子会话同时作为 `--session-dir` 和 `--output-dir`，后续 `status`、交付与发布也从该 IMA 子会话继续；父会话要求 full-text 时，聚合会话和子会话中的摘要或节选都必须使 `deliveryComplete=false`。

`search-all` 聚合器必须按 child bundle 的语义状态计算成功来源；可读取的 failed bundle 仍是失败，全部来源失败时 aggregate 必须为 failed。每个 inventory 声明的 raw 证据必须复制到 aggregate 的 `raw/<source>/`，路径同步改写并验证文件真实存在、非空、可读、位于 `raw/` 且不是符号链接。`search-all --metadata-only false` 还必须复制每个条目内的 `assets/` 文件并保持相对布局；越界、非常规文件或符号链接资源必须使聚合失败，正文引用缺失资源则由统一 publish 校验拒绝。不得把尚未刷新的 discovery aggregate 当作已物化结果。采集完成后只交付 `status.downstreamInput.files` 列出的已验证 Markdown 及其本地引用资源，然后停止。
