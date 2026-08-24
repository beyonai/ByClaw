# IMA 采集桥接

IMA 采集意图由 `knowledge-collection` 统一编排。笔记和一般 IMA 读取使用已安装的 `ima-openapi-cli@0.1.3`；指定知识库的文章详情列表优先使用 `bycli ima knowledge <knowledgeBase> -f json`。
加载并遵循 `ima-skill`；除上述只读文章列表例外外，所有业务调用只能通过通用 `exec` 执行 `ima` CLI，禁止 curl、手写 HTTP 或直接调用上游 API。

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
markdown/items/*.md
sanitized/items/*.md
```

`collection-result.json` 的 `source` 和 `backend` 都写 `ima`，inventory 的 `sourceSkill` 写 `ima-skill`。
执行企业 `search`、`search-all` 或 `resource` 时必须传入已授权 IMA 的 `--parent-session-dir`；metadata-only 输出会直接带有 `sourceScope=["ima"]`、`materializationTarget=candidates` 的完整 `session.json`。
采集完成后只交付已验证的 `sanitized/items/*.md`，然后停止。
