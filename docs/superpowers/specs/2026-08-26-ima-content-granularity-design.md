# IMA 内容粒度与封面降级设计

## 背景

IMA 知识库目录接口可能只返回 AI 摘要和正文开头，但现有采集契约只能表达“是否已物化”，不能表达正文是全文、节选还是摘要。这会使 `materialized`、`complete` 和 `deliveryComplete=true` 被误读为“已获得完整文章全文”。

提交 `7f746bb0c` 还增加了封面本地化：适配器直接使用服务端 `fetch` 下载 IMA 返回的 `coverUrls`。当前 byCLI 没有“任意 HTTPS URL 到本地二进制文件”的受支持命令；直接 HTTP 下载既绕过来源执行器规则，也缺少可信的目标地址、重定向、超时和流式大小边界。

## 目标

1. 结构化记录每个已物化正文的内容粒度，并与交付流程状态分离。
2. 无法证明正文完整时不得标记为全文。
3. 删除 IMA 适配器的默认直接 HTTP 封面下载。
4. 封面无法合规本地化时，正文仍可成功物化；封面缺失作为独立覆盖信息报告。
5. IMA 恢复物化后保留知识库过滤器，避免 `collection-result.json.filters` 丢失 `kb`。
6. 保持旧会话可读，不修改既有会话文件。

## 非目标

- 不新增通用网络下载器。
- 不通过 `curl`、`wget`、`fetch`、browser eval 或其他直接 HTTP 方式下载封面。
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

旧会话或缺失字段在读取和标准化时按 `unknown` 处理，绝不默认 `full-text`。非法枚举值在严格写入边界被拒绝；恢复旧状态时降级为 `unknown` 并产生可追踪警告。

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

物化阶段不再默认调用 `globalThis.fetch`，也不再接受可退回到直接 HTTP 的 `fetchImpl`。当前没有合规封面下载能力时：

- 正文正常写入 `markdown/items/<article-name>-<item-id>/index.md` 和 `sanitized/items/<article-name>-<item-id>/index.md`。
- Markdown 不插入远程图片链接，也不伪造本地 `assets/` 路径。
- inventory 保留 `coverUrls`，并增加结构化封面状态，区分“没有封面”和“存在封面但未本地化”。
- 封面未本地化不使正文 `materialization.status` 变为 `failed`。
- 状态与交付报告汇总封面缺失数量，明确这是媒体覆盖缺口。

封面状态设计为独立对象：

```json
{
  "media": {
    "coverStatus": "not-present | materialized | unavailable",
    "coverCount": 0,
    "materializedCoverCount": 0,
    "reason": null
  }
}
```

当前实现只会生成：

- 无 `coverUrls`：`not-present`。
- 有 `coverUrls` 但没有合规下载器：`unavailable`，`reason=approved-cover-downloader-unavailable`。

`materialized` 为未来受支持下载器预留；本次不实现该传输能力。

## KB 追溯

metadata-only 会话恢复物化时，候选项已经保留 `kb` 和 `materializationKb`。物化 bundle 应从所有选中项推导公共 `kb`：

- 所有项具有相同非空 `kb`：写入 `collection-result.json.filters.kb` 和相应 `sourceMetadata`。
- 项目混合多个 `kb`：拒绝物化，避免生成含糊的 bundle。
- 全部为空：保持 `{}`，兼容无知识库过滤器的旧会话。

## 状态汇总

`status` 输出增加两组计数：

- `contentGranularity`：四种粒度的已物化条目数量；总和必须等于 `materialized`。
- `mediaCovers`：`notPresent`、`materialized`、`unavailable` 的条目数量。

这些计数不参与 `deliveryComplete` 的布尔判定，避免将媒体覆盖和正文交付混为一谈。

## 错误处理

- 内容粒度非法：新 bundle 写入时拒绝；旧会话恢复时归一化为 `unknown` 并告警。
- 封面存在但无合规下载能力：正文继续交付，封面状态为 `unavailable`。
- KB 混合：在写 bundle 前失败，错误应列出冲突的非敏感 KB 名称。
- 不引入网络重试、超时或重定向逻辑，因为本次彻底移除适配器的直接网络下载。

## 测试设计

按 TDD 顺序新增失败测试，再实现最小代码：

1. IMA 目录记录含 `abstract + introduction` 时为 `excerpt`。
2. 仅 `abstract` 时为 `abstract`。
3. 只有普通 `content` 字段且无完整性证据时为 `unknown`。
4. 明确完整性证据存在时为 `full-text`。
5. 旧会话缺字段归一化为 `unknown`；非法值严格写入时被拒绝。
6. collect 缺省为 `unknown`，显式合法值被保留。
7. 粒度汇总之和等于已物化数量。
8. 有 `coverUrls` 时不调用任何 HTTP downloader，正文仍成功，封面状态为 `unavailable`，Markdown 无远程或伪造图片。
9. 无封面时状态为 `not-present`。
10. 恢复物化保留共同 `filters.kb`；混合 KB 被拒绝。
11. 现有 IMA、collection-state、artifact-writer 和技能契约测试继续通过。

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
