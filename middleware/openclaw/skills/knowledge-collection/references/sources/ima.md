# IMA 采集桥接

IMA 采集意图由 `knowledge-collection` 统一编排。笔记和一般 IMA 读取使用已安装的 `ima-openapi-cli@0.1.3`；指定知识库的文章详情列表优先使用 `bycli ima knowledge <knowledgeBase> -f json`。
加载并遵循 `ima-skill`；除上述只读文章列表例外外，所有业务调用只能通过通用 `exec` 执行 `ima` CLI，禁止 curl、wget、任意手写 HTTP 或直接调用上游 API。唯一窄化例外是 IMA adapter 内置的受控 HTTPS 下载器：它只能下载 `bycli ima knowledge` 原始响应中的 `coverUrls`，用于把封面与正文一起物化，不能用于发现、正文采集或任意 URL 下载。

## 来源路由

| 输入或意图 | IMA CLI 能力 |
| --- | --- |
| IMA 笔记搜索、读取 | `ima note search` / `ima note get` |
| 指定 IMA 知识库的文章详情列表 | `bycli ima knowledge <knowledgeBase> -f json`；失败后一次 `ima wiki search` 兜底 |
| IMA Wiki 内容搜索、读取（无指定知识库或兜底） | `ima wiki search` |

## 执行与认证

1. 任何业务调用前先执行 `ima auth check --test --json`，并确认 `checks.token_fetch === true`。
2. 认证失败返回 `auth_required`，提示用户到连接器设置重新连接；不得读取或展示凭据。
3. 所有支持 JSON 的命令必须带 `--json`，成功依据退出码和 JSON 结构共同判断。
4. 指定知识库的文章详情列表先调用 `bycli ima knowledge <knowledgeBase> -f json`。仅当该调用失败或返回无效 JSON 时，才调用一次 `ima wiki search` 兜底；有效空列表是成功结果，不得兜底。两者都失败时如实返回失败原因，不得伪造结果。
5. IMA 桥接只允许搜索、读取和采集笔记或 Wiki 内容；URL 导入等写入能力不属于本技能。

## 规范化产物

IMA 搜索和 materialize 遵循统一 collection contract：

```text
collection-result.json
raw/
  metadata.json
  note-search.json
  wiki-search.json
markdown/items/<article-name>-<item-id>/index.md
sanitized/items/<article-name>-<item-id>/
  index.md
  assets/*  # 仅在获准来源执行器确实物化媒体时存在
```

`bycli ima knowledge` 返回的 `coverUrls` 是 IMA 条目封面来源，物化时必须保留该字段；不得猜测、扩展或搜索额外图片 URL。IMA adapter 的受控 HTTPS 下载器只接受这些来源 URL，并执行以下硬限制：仅 HTTPS 且 URL 不得带凭据；最多 10 MiB；总超时 15 秒；最多 3 次重定向且每个目标都必须重新通过 HTTPS 校验；同时按 `Content-Length` 和流式累计字节数限流；只接受 JPEG、PNG、GIF、WebP MIME 类型。

封面与正文必须作为同一条目一起处理。成功取得的封面写入该文章的 `sanitized/items/<article-name>-<item-id>/assets/`，正文只以本地相对链接引用这些已落盘封面；全部封面成功时登记 `media.coverStatus=materialized`。封面失败不改变正文的物化状态：正文成功时仍登记 `materialization.status=materialized` 并进入 canonical view；媒体单独登记 `media.coverStatus=unavailable`、原始封面数、成功封面数和非敏感失败类别。不得插入失败封面的远程链接或虚构路径，也不得泄露带签名的 URL。

每个 materialized IMA 条目必须写入 `materialization.contentGranularity`：明确的完整性证据才允许 `full-text`；`abstract + introduction` 或正文开头标记为 `excerpt`；仅摘要为 `abstract`；普通 `content` 字段或无法证明完整度时为 `unknown`。旧会话缺失字段一律按 `unknown`，不得默认 `full-text`。该字段不改变 `complete`、`deliveryComplete` 或 `materialized` 的流程语义。

旧会话缺失或含非法 media 状态时，读取结果按 `media.coverStatus=unknown`、`reason=legacy-media-state-unknown` 报告；只读 `status` 不得因此修改原会话文件。

当 IMA 条目需要通过其他获准工具补抓全文时，下载工具的原始目录及图片必须写入当前会话的 `raw/` 子树；随后通过 `collect` 登记为当前会话的 `markdown/items/<article-name>-<item-id>/index.md` 与 `sanitized/items/<article-name>-<item-id>/index.md`。不得创建 IMA collection 会话外的全文或摘要目录。`bycli ima knowledge` 返回相同 `sourceUrl` 的多个记录时，适配器只登记第一个来源项，完整原始响应仍保留在 `raw/bycli-knowledge.json`。

`collection-result.json` 的 `source` 和 `backend` 都写 `ima`，inventory 的 `sourceSkill` 写 `ima-skill`。
metadata-only 会话恢复物化时必须把共同的知识库名称保留到 `collection-result.json.filters.kb` 和 `sourceMetadata.kb`；同一次 materialize 不得混合多个知识库。
执行企业 `search`、`search-all` 或 `resource` 时必须传入已授权 IMA 的 `--parent-session-dir`；metadata-only 输出会直接带有 `sourceScope=["ima"]`、`materializationTarget=candidates` 的完整 `session.json`。
采集完成后只交付已验证的 `sanitized/items/<article-name>-<item-id>/index.md`，然后停止。
