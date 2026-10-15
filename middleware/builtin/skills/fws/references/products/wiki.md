# 知识库 Wiki

用于飞书知识空间、Wiki 节点、成员管理、节点移动/复制/删除和知识库组织。

## 身份选择

Wiki 多为用户资源，默认 `--as user`。用户明确要求应用视角时才用 `--as bot`。

部门成员管理存在限制：`--as bot` 下不要用部门 ID 添加知识空间成员；应说明需要 `--as user` 或管理员处理。

## 常用命令

```bash
# 列出知识空间
lark-cli wiki +space-list --as user --format json

# 查看节点
lark-cli wiki +node-get --url "<wiki_url>" --as user --format json

# 列出节点
lark-cli wiki +node-list --space-id <space_id> --as user --format json

# 创建节点
lark-cli wiki +node-create --space-id <space_id> --title "新页面" --as user --format json

# 列出成员
lark-cli wiki +member-list --space-id <space_id> --page-all --as user --format json
```

## 成员管理

添加成员前先解析成员类型：
- 用户：`contact +search-user` 获取 `open_id`。
- 群：`im +chat-search` 获取 `chat_id`。
- 应用：使用 app id。
- 部门：先通过原生 contact API 查 `open_department_id`，且默认要求 user 身份。

## 路由边界

- 上传文件到知识库节点：`drive +upload --wiki-token`。
- 编辑文档正文：`docs`。
- 表格/Base 内容操作：`sheets` / `base`。
- Wiki 节点、空间成员、知识库结构：本产品。

## 危险操作

删除知识空间、删除节点、移除成员、批量移动节点前确认。删除空间时必须解析真实 `space_id`，并让用户确认候选。
