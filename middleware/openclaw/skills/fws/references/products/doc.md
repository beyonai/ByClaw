# 云文档 Docs

用于飞书云文档（Docx/Doc）的创建、读取和正文编辑。

## 身份选择

文档通常是用户资源，默认 `--as user`。只有用户明确要求应用身份或 bot 创建资源时才用 `--as bot`。

## 常用命令

```bash
# 读取文档
lark-cli docs +fetch --doc "<doc_url_or_token>" --doc-format markdown --as user --format json

# 创建文档
lark-cli docs +create --content '<title>标题</title><p>正文</p>' --as user --format json

# 追加/替换/局部编辑
lark-cli docs +update --doc "<doc_url_or_token>" --command append --content '<p>补充内容</p>' --as user --format json
```

## 路由边界

- 复制文档、移动文档、导入/导出、评论、权限：走 `drive`。
- 文档正文读取/编辑：走 `docs`。
- 文档中嵌入 sheets/base 时，提取 token 后切到 `sheets` 或 `base`。
- 文档素材预览/下载可用 `docs +media-preview` / `docs +media-download`。

## 编辑规则

- 精准编辑前先读取当前内容或 block id。
- 执行 `overwrite`、`block_replace`、`block_delete` 后，旧 block id 可能失效；需要继续编辑时重新 fetch。
- 用户明确给 Markdown 文件或说导入 Markdown 时用 Markdown；否则复杂局部编辑优先用 XML/结构化内容。
- 不要通过 fetch + create 复制文档；复制资产走 `drive files copy`。

## 危险操作

覆盖、删除块、回滚版本、删除封面/素材前确认。
