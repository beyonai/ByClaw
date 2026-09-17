# kbcli 设计：面向 Skill 的知识库命令行运行时

## 1. 目标

`kbcli` 为 Agent 开发的 Skill 提供稳定的知识库命令。Skill 只知道当前运行时的
`session_id`、知识库 `resource_id` 和业务参数，不知道服务实例、IP、端口或用户令牌。
`kbcli` 通过 `by_framework` 服务发现访问 ByAI 后端，并将 Controller 响应统一为 JSON。

CLI 覆盖知识库生命周期、目录浏览与文件管理、Glob、Chunk 检索、文件级检索和元数据检索。
修改与删除命令按当前产品要求单次执行，不提供交互确认或 `--confirm`/`--yes` 参数；是否执行
副作用操作由调用 Skill 在调用前根据用户意图判断。

## 2. 运行时架构

```text
User request
  -> Agent selects a business Skill
  -> Skill public script receives session_id
  -> kbcli validates arguments and paths
  -> by_framework DiscoveryHttpClient resolves ByaiService
  -> /byaiService/datasetController/*
  -> stable JSON on stdout
```

服务实例只能由服务发现选择。CLI 不接受 URL、host、port 或 endpoint 参数。

## 3. 身份与服务发现

所有联网命令都要求 `--session-id <current-session-id>`。平台运行环境负责提供：

| 环境变量 | 用途 |
|---|---|
| `KBCLI_KNOWLEDGE_SERVICE` 或 `BE_DOMAINNAME` | 服务发现名 |
| `BEYOND_TOKEN` | `Beyond-Token` 请求头 |
| `SSO_TOKEN` | 可选 `SSO-TOKEN` 请求头 |
| `SYSTEM_CODE` | 可选 `system-code` 请求头 |
| `REDIS_*` / `DATACLOUD_GATEWAY_REDIS_*` | 服务发现 Redis |

Skill 不得读取、覆盖、输出或持久化这些变量。`session_id` 映射为 `x-session-id` 请求头。

## 4. 命令到接口映射

| CLI | HTTP 接口 |
|---|---|
| `kbcli base list` | `POST /auth/privilegeGrant/listResourceUseAuth` |
| `kbcli base create` | `POST /datasetController/createDataset` |
| `kbcli base update` | `POST /datasetController/updateDataset` |
| `kbcli base delete` | `POST /datasetController/deleteDataset` |
| `kbcli base get` | `GET /datasetController/detail` |
| `kbcli folder create` | `POST /datasetController/createFolder` |
| `kbcli folder rename` | `POST /datasetController/renameFolder` |
| `kbcli folder delete` | `POST /datasetController/deleteFolder` |
| `kbcli item move` | `POST /datasetController/moveKnowledgeItems` |
| `kbcli item list` | `POST /datasetController/queryDirAndFileByLevel` |
| `kbcli item glob` | `POST /datasetController/glob` |
| `kbcli file conflicts` | `POST /datasetController/checkUploadFileConflicts` |
| `kbcli file upload` | `POST /datasetController/uploadFiles` |
| `kbcli file update` | `POST /datasetController/knowledgeItems/update` |
| `kbcli file delete` | `POST /datasetController/removeFile` |
| `kbcli file download` | `GET /datasetController/download` |
| `kbcli file read` | `POST /datasetController/readFile` |
| `kbcli build start` | `POST /datasetController/build` |
| `kbcli build convert` | `POST /datasetController/fileToMarkdown` |
| `kbcli build from-doc` | `GET /datasetController/buildKnowledgeFromDoc` |
| `kbcli build result` | `POST /datasetController/buildResult` |
| `kbcli build status` | `GET /datasetController/fileBuildStatus` |
| `kbcli search chunks` | `POST /datasetController/knowledgeItems/search` |
| `kbcli search files` | `POST /datasetController/knowledgeItems/searchFile` |
| `kbcli search metadata` | `POST /datasetController/knowledgeItems/metadataSearch` |

HTTP 路径包含固定的 `/byaiService` context path，不由 Skill 传入。
`base list` 对外只暴露 `keyword`、`pageNum` 和 `pageSize`；已上架状态、知识库业务类型、权限、
数字员工类型和语言均由 CLI 固定，不属于 Skill 输入契约。

查询单条或全部机器可读契约：

```bash
kbcli describe base get --format json
kbcli describe --all --format json
```

契约查询完全在本地执行，不要求 `session_id`，也不触发服务发现。

## 5. 输入协议

简单命令使用显式参数；结构复杂的 DTO 使用 `--input`：

```bash
kbcli item move --session-id "$session_id" --input ./move.json
printf '%s' "$request_json" | kbcli search metadata --session-id "$session_id" --input -
```

`--input` 接受 JSON 对象文本、JSON 文件路径或 `-`。知识库路径必须以 `/` 开头，且不能包含
`..` 路径段。ID 在输出中保留服务端字符串形式，避免 JavaScript 大整数损失。

目录浏览使用 `item list --resource-id ID --directory PATH`。Glob 使用显式的
`item glob --resource-id ID --path-rule RULE`；`*` 只匹配单层路径，不支持 `**`。
读取 Markdown 使用 `file read --resource-id ID --path PATH`，行范围通过可选的
`--start-line/--end-line` 指定，不再向 Agent 暴露后端 DTO 字段名。

## 6. 输出和退出码

stdout 只输出一个 JSON 对象，诊断信息只能写入 stderr。

```json
{"ok":true,"operation":"knowledge.search.chunks","data":[],"meta":{"backendCode":0,"backendMessage":"ok"}}
```

```json
{"ok":false,"error":{"code":"BACKEND_ERROR","message":"permission denied","retryable":false}}
```

| 退出码 | 含义 |
|---:|---|
| 0 | 成功 |
| 2 | 参数、本地路径或输入文件错误 |
| 11 | 后端业务拒绝或权限错误 |
| 13 | 超时 |
| 14 | 服务发现、网络、协议或运行时错误 |

调用方必须同时检查退出码和 JSON `ok`，不得用 `|| true` 吞掉失败。

## 7. 文件语义

- 上传支持重复 `--file`，使用 multipart 字段 `files`。
- multipart 通过 `DiscoveryHttpClient.upload_multiple` 发送，保留服务发现与节点切换重试；不得向
  普通 `post` 方法传递其不支持的 `files` 参数。
- 更新使用 multipart 字段 `fileContent`，且不会自动触发知识构建。
- 上传的 `--overwrite` 与 `--skip-existing` 互斥。
- 下载默认拒绝覆盖本地文件；`--force` 只控制本地输出覆盖。
- 下载调用服务发现客户端的流式 `download`，保留原始二进制字节。
- 下载先写同目录临时文件；非空校验通过后再原子替换目标，空响应返回 `EMPTY_DOWNLOAD`，避免产生半文件或 0 字节最终文件。

## 8. 边界

`kbcli` 不是跨多个 HTTP 操作的事务管理器。连续创建目录、上传和移动时，中途失败可能留下
已完成的远端操作。业务 Skill 必须定义重试与补偿策略，不得假设 HTTP 操作原子化。

## 9. 安装与验证

```bash
python -m pip install ./middleware/openclaw/kbcli
kbcli --version
python -m unittest discover -s middleware/openclaw/kbcli/tests -v
```

运行环境还必须由平台提供 `by_framework`；它属于 ByClaw 运行时依赖，不由本 wheel 重复打包。
