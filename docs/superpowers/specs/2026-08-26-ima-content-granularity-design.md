# IMA 内容粒度与受控封面物化设计

## 背景

IMA 知识库目录接口可能只返回 AI 摘要和正文开头，但现有采集契约只能表达“是否已物化”，不能表达正文是全文、节选还是摘要。这会使 `materialized`、`complete` 和 `deliveryComplete=true` 被误读为“已获得完整文章全文”。

提交 `7f746bb0c` 还增加了封面本地化：适配器直接使用服务端 `fetch` 下载 IMA 返回的 `coverUrls`。当前 byCLI 没有“任意 HTTPS URL 到本地二进制文件”的受支持命令；直接 HTTP 下载既绕过来源执行器规则，也缺少可信的目标地址、重定向、超时和流式大小边界。

## 目标

1. 结构化记录每个已物化正文的内容粒度，并与交付流程状态分离。
2. 无法证明正文完整时不得标记为全文。
3. 保留 IMA 封面与文章同次物化，并将原始无边界下载替换为受控 HTTPS 下载器。
4. 封面下载失败时不得发布只有正文的半成品；该条物化失败并保留可审计原因。
5. IMA 恢复物化后保留知识库过滤器，避免 `collection-result.json.filters` 丢失 `kb`。
6. 保持旧会话可读，不修改既有会话文件。

## 非目标

- 不新增可下载任意 URL 的通用网络下载器。
- 不通过 `curl`、`wget`、browser eval 或会话外工具下载封面。
- 不允许受控下载器处理 IMA 来源记录之外的 URL 或非 HTTPS URL。
- 不将 `web/read` 或 `weixin/download` 误用为任意图片下载命令。
- 不重新采集或改写已经交付的 IMA 会话。
- 不把微信公众号全文采集纳入本次修改。

## 数据契约

在 `materialization` 对象增加：

```json
{
  "contentGranularity": "full-text | excerpt | abstract | unknown"
}
```

语义如下：

- `full-text`：存在来源特定且可验证的完整正文证据。
- `excerpt`：正文节选，或“摘要 + 正文开头”。
- `abstract`：只有摘要或元数据描述，没有正文片段。
- `unknown`：旧数据、缺少证据，或来源响应无法可靠判断完整度。

`contentGranularity` 与以下状态正交：

- `materialization.status=materialized` 仅表示正文产物已成功写入并验证。
- `collection.status=complete` 仅表示本次范围内的采集流程完成。
- `deliveryComplete=true` 仅表示目标交付产物齐备。

旧会话或缺失字段在读取和标准化时按 `unknown` 处理，绝不默认 `full-text`。非法枚举值在严格写入边界被拒绝；恢复旧状态时降级为 `unknown` 并产生可追踪警告。只读 `status` 和 `inspect` 只能在内存中兼容旧字段，不得静默改写旧会话；显式迁移或写操作才能持久化新契约。

## IMA 粒度判定

粒度必须依据实际响应证据判定，不能仅依据 `wiki`、`note` 类型或字段名判定。

判定顺序：

1. 来源响应提供可信的显式完整性证据时，才标记 `full-text`。
2. 有 `introduction` 或明确截断/预览证据时，标记 `excerpt`。
3. 仅有 `abstract` 时，标记 `abstract`。
4. 普通 `content`、`markdown`、`text`、`body` 字段本身不构成全文证据；没有其他证据时标记 `unknown`。
5. 没有可物化内容时仍按原流程标记 `pending` 或 `failed`，内容粒度为 `unknown`。

适配器应保留用于判定的非敏感来源证据，但不能通过字数阈值猜测全文。后续若 IMA 提供正式的“完整/截断”字段，可以在不改变枚举的前提下扩展判定器。

## 封面处理

IMA 发现阶段继续保留来源响应中的 `coverUrls`，原始 byCLI JSON 仍是权威来源证据。

物化阶段使用 IMA adapter 内置的受控 HTTPS 下载器处理来源记录中的 `coverUrls`。它不是通用下载接口，必须同时满足：

- 只接受 `bycli ima knowledge` 已返回并保存在 inventory/raw 证据中的 HTTPS URL。
- 限制单张封面的响应字节数、请求超时和重定向次数；每次重定向后的目标仍必须是 HTTPS。
- 在读取完整响应前检查 `Content-Length`（若存在），流式读取时再次执行硬字节上限。
- 只接受允许列表中的图片 MIME 类型，并根据验证后的 MIME 决定扩展名。
- 下载到临时文件并原子写入 `sanitized/items/<article-name>-<item-id>/assets/`；正文 Markdown 只引用已经成功落盘的相对路径。
- 任一封面失败时不发布该条正文的半成品，该条 `materialization.status=failed`，原因保持非敏感且可审计。

无 `coverUrls` 的条目正常物化正文，不创建 `assets/`。禁止把远程图片链接直接写入交付 Markdown，也禁止伪造不存在的本地路径。

封面状态设计为独立对象：

```json
{
  "media": {
    "coverStatus": "not-present | materialized | unavailable | unknown",
    "coverCount": 0,
    "materializedCoverCount": 0,
    "reason": null
  }
}
```

新 IMA 会话生成：

- 无 `coverUrls`：`not-present`。
- 所有 `coverUrls` 均成功落盘：`materialized`，且 `materializedCoverCount=coverCount`。
- 下载失败：条目物化失败，`unavailable` 记录封面数量与失败原因。

旧会话缺失 `media` 时在只读视图中标记 `unknown`，不得默认 `not-present`。如果旧记录含 `coverUrls`，汇总必须保留其数量；除非通过显式迁移核验了本地资产，否则不得猜测为 `materialized` 或 `unavailable`。

## KB 追溯

metadata-only 会话恢复物化时，候选项已经保留 `kb` 和 `materializationKb`。物化 bundle 应从所有选中项推导公共 `kb`：

- 所有项具有相同非空 `kb`：写入 `collection-result.json.filters.kb` 和相应 `sourceMetadata`。
- 项目混合多个 `kb`：拒绝物化，避免生成含糊的 bundle。
- 全部为空：保持 `{}`，兼容无知识库过滤器的旧会话。

## 状态汇总

`status` 输出增加两组计数：

- `contentGranularity`：四种粒度的已物化条目数量；总和必须等于 `materialized`。
- `mediaCovers`：`notPresent`、`materialized`、`unavailable`、`unknown` 的条目数量。

这些计数不参与 `deliveryComplete` 的布尔判定，避免将媒体覆盖和正文交付混为一谈。

技能交付规范必须强制输出正文粒度与媒体覆盖计数。只要存在 `excerpt`、`abstract` 或 `unknown`，报告就不得把对应记录称为“完整文章正文”；应使用“记录及可获取片段/摘要”等准确措辞，并将缺失全文列入覆盖缺口。`excerpt` 和 `abstract` 可以作为有明确粒度的实际采集产物登记，不能冒充 `full-text`。

## 错误处理

- 内容粒度非法：新 bundle 写入时拒绝；旧会话恢复时归一化为 `unknown` 并告警。
- 封面下载超时、超限、重定向越界、非 HTTPS 或 MIME 不合法：该条物化失败，不发布正文半成品，媒体状态为 `unavailable`。
- KB 混合：在写 bundle 前失败，错误应列出冲突的非敏感 KB 名称。
- 下载器不自动重试，避免重复外部请求；超时、字节和重定向边界必须可测试且使用固定安全默认值。

## 测试设计

按 TDD 顺序新增失败测试，再实现最小代码：

1. IMA 目录记录含 `abstract + introduction` 时为 `excerpt`。
2. 仅 `abstract` 时为 `abstract`。
3. 只有普通 `content` 字段且无完整性证据时为 `unknown`。
4. 明确完整性证据存在时为 `full-text`。
5. 旧会话缺字段归一化为 `unknown`；非法值严格写入时被拒绝。
6. collect 缺省为 `unknown`，显式合法值被保留。
7. 粒度汇总之和等于已物化数量。
8. 有 `coverUrls` 时受控下载器取得图片，封面与正文位于同一文章目录，Markdown 使用本地相对路径。
9. 非 HTTPS、超时、重定向超限、响应超限或 MIME 非图片时，该条失败且不发布正文半成品。
10. 无封面时状态为 `not-present`；旧会话缺失媒体状态时只读归一化为 `unknown`，且 `status` 不改写会话文件。
11. `status` 和最终交付规范必须显式报告粒度、封面计数，并禁止把片段表述为全文。
12. 恢复物化保留共同 `filters.kb`；混合 KB 被拒绝。
13. 现有 IMA、collection-state、artifact-writer 和技能契约测试继续通过。

## 实施范围

预计修改：

- `references/collection-contract.md`
- `references/sources/ima.md`
- `scripts/enterprise/shared/status-model.mjs`
- `scripts/enterprise/shared/artifact-writer.mjs`
- `scripts/collection-state.mjs`
- `scripts/delivery-state.mjs`（仅在汇总归属需要时）
- `scripts/enterprise/adapters/ima.mjs`
- 对应 Node 与 Python 契约测试

不会修改本次已完成的线上 session，也不会改动仓库内无关文件。
