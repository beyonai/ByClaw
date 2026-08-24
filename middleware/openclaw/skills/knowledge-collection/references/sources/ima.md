# IMA 采集桥接

IMA 采集意图由 `knowledge-collection` 统一编排，来源执行器固定为已安装的 `ima-openapi-cli@0.1.3`。
加载并遵循 `ima-skill`；所有业务调用只能通过通用 `exec` 执行 `ima` CLI，禁止 curl、手写 HTTP 或直接调用上游 API。

## 来源路由

| 输入或意图 | IMA CLI 能力 |
| --- | --- |
| IMA 笔记搜索、读取 | `ima note search` / `ima note get` |
| IMA 知识库搜索、浏览 | `ima wiki search` / `ima wiki list` |
| 外部网页或微信文章导入 IMA | `ima wiki import-urls --kb <id> <url>` |

## 执行与认证

1. 任何业务调用前先执行 `ima auth check --test --json`，并确认 `checks.token_fetch === true`。
2. 认证失败返回 `auth_required`，提示用户到连接器设置重新连接；不得读取或展示凭据，也不得自动重试写操作。
3. 所有支持 JSON 的命令必须带 `--json`，成功依据退出码和 JSON 结构共同判断。
4. IMA 内容只允许读取、搜索和采集；URL 导入是明确的知识库写操作，必须由用户提供目标 `--kb`，不能把导入结果表述为本地正文已采集。

## 规范化产物

IMA 搜索和 materialize 遵循统一 collection contract：

```text
collection-result.json
raw/
  metadata.json
  note-search.json / wiki-search.json
markdown/items/*.md
sanitized/items/*.md
```

`collection-result.json` 的 `source` 和 `backend` 都写 `ima`，inventory 的 `sourceSkill` 写 `ima-skill`。
URL 导入只保存已脱敏的 CLI 结果和导入元数据，不生成虚假的 Markdown item。
