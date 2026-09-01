---
name: project-cloud-knowledge
description: 读写项目云盘知识库中的目录与文件。用于列出/创建/重命名/删除目录，以及冲突检查、上传、下载、删除文件。用户提到「项目云盘知识库」「云盘」「cloudResourceId / cloud_resource_id」时使用。
metadata:
  openclaw:
    requires:
      bins: [node]
byclaw_managed: true
---

# 项目云盘知识库

这是平台底层能力，所有百应数字员工都可使用，不要求员工单独绑定。

项目云盘知识库对应项目的 `cloudResourceId`（会话/项目上下文里的 `cloud_resource_id`），底层走知识库文件接口，但目标必须是项目云盘知识库资源，不要当成普通知识库管理。

## 资源标识解析

优先从可信上下文或 `project-context` 返回的 `project.cloudResourceId`（兼容 `cloud_resource_id`）读取，传给 `--resource-id`。

```xml
<project_context>{"project_id":20014944,"workspace":"/by/projects/20014944"}</project_context>
```

```bash
node <project-context目录>/scripts/project-context.mjs basic --project-id 20014944
# 使用返回 JSON 中 project.cloudResourceId
```

没有项目云盘知识库资源 ID 时，先向用户说明当前项目未初始化项目云盘知识库或上下文缺失；不要猜 ID，也不要用普通知识库 `resourceId` 冒充。

## 命令

```bash
node scripts/project-cloud-knowledge.mjs list --resource-id 9001 --directory-path /
node scripts/project-cloud-knowledge.mjs mkdir --resource-id 9001 --directory-path / --directory-name 制度
node scripts/project-cloud-knowledge.mjs rename-dir --resource-id 9001 --directory-path /制度 --directory-name 制度文档
node scripts/project-cloud-knowledge.mjs delete-dir --resource-id 9001 --directory-path /制度文档
node scripts/project-cloud-knowledge.mjs list --resource-id 9001 --directory-path /制度/人事
node scripts/project-cloud-knowledge.mjs check --resource-id 9001 --directory-path /制度/人事 --file-name 考勤制度.pdf
node scripts/project-cloud-knowledge.mjs upload --resource-id 9001 --directory-path /制度/人事 --file /tmp/考勤制度.pdf --overwrite
node scripts/project-cloud-knowledge.mjs upload --resource-id 9001 --directory-path /笔记 --file-name note.md --text "# 纪要"
node scripts/project-cloud-knowledge.mjs download --resource-id 9001 --file-path /制度/人事/考勤制度.pdf --output /tmp/考勤制度.pdf
node scripts/project-cloud-knowledge.mjs remove --resource-id 9001 --file-path /制度/人事/考勤制度.pdf
```

- `list`：列出指定目录下的子目录和文件（单层，不递归）；`--directory-path` 默认 `/`。结果中的 `fileName` / `directoryPath` 已含远端路径，不要自行重复拼接。
- `mkdir`：在父目录下创建子目录；`--directory-path` 为父目录，`--directory-name` 为新目录名，可选 `--directory-description`。
- `rename-dir`：重命名目录；`--directory-path` 为现有目录完整路径，`--directory-name` 为新名称。不可操作根目录 `/`。
- `delete-dir`：删除目录；`--directory-path` 为待删目录完整路径。执行前应取得用户确认。不可操作根目录 `/`。
- `check`：上传前检查目标目录下同名冲突；`--file-name` 可重复。
- `upload`：上传一个或多个本地文件（`--file` 可重复），或用 `--file-name` + `--text` 写入文本内容。默认不覆盖；传 `--overwrite` 覆盖，`--skip-if-duplicate` 跳过重复；传 `--check-conflicts` 时先检查冲突，有冲突则不上传并返回路径。
- `download`：按项目云盘知识库内完整路径下载到 `--output`；响应为文件流，脚本落盘后返回 JSON 元数据。
- `remove`：按项目云盘知识库内完整路径删除文件；执行前应取得用户确认。

输出为单行 JSON。直接依据返回数据回答用户。修改目录后可用 `list` 核对结果。

## 路径约定

- 目录根路径为 `/`。
- `list` / `check` / `upload` / `mkdir` 的 `--directory-path`：`list`/`check`/`upload` 是目标目录；`mkdir` 是父目录。
- `rename-dir` / `delete-dir` 的 `--directory-path` 是目录完整路径。
- `download` / `remove` 的 `--file-path` 是文件完整路径，如 `/制度/人事/考勤制度.pdf`。

## 安全约束

- 只能用本脚本访问项目云盘知识库，不要自行拼 `curl`，不要读取或展示 token、Cookie、签名盐和服务地址。
- 接口会校验当前登录用户权限；无权访问时不要绕过。
- 删除、覆盖、目录重命名操作需用户明确授权。
- 不要把宿主机真实密钥、token 写入项目云盘知识库。

## 常见失败码

| 错误码 | 含义 |
|---|---|
| `CLOUD_DISK_COMMAND_INVALID` | 未知命令 |
| `CLOUD_DISK_RESOURCE_ID_MISSING` | 缺少项目云盘知识库 resourceId |
| `CLOUD_DISK_INPUT_INVALID` | 参数非法 |
| `CLOUD_DISK_FILE_MISSING` | 本地文件不存在 |
| `CLOUD_DISK_AUTH_CONTEXT_UNAVAILABLE` | 运行环境没有登录态 |
| `CLOUD_DISK_AUTH_REJECTED` | 登录态过期或被拒绝 |
| `CLOUD_DISK_ACCESS_DENIED` | 当前用户无权访问 |
| `CLOUD_DISK_BACKEND_UNREACHABLE` | 后端不可达 |
| `CLOUD_DISK_BACKEND_TIMEOUT` | 后端超时 |
| `CLOUD_DISK_BACKEND_REJECTED` | 业务拒绝 |
| `CLOUD_DISK_RESPONSE_INVALID` | 响应无法解析 |
