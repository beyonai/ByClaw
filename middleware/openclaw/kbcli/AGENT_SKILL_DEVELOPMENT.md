# Agent 基于 kbcli 开发知识库 Skill 规范

本文档供创建或修改业务 Skill 的 Agent 使用。

平台镜像构建时安装 CLI：

```bash
python -m pip install ./middleware/openclaw/kbcli
kbcli --version
```

业务 Skill 只依赖 PATH 中的 `kbcli` 命令，不依赖本仓库源码路径或当前工作目录。

## 核心规则

1. 只通过 `kbcli` 操作知识库，不在 Skill 中直接调用 HTTP、拼接 Controller URL 或使用 `curl`。
2. Skill 的唯一公开入口第一个参数必须是运行时 `session_id`，并原样传给 `--session-id`。
3. 不得让用户或模型提供 endpoint、host、port、服务名或认证令牌；服务实例由 CLI 发现。
4. 不得读取、修改、输出或持久化 token、`SYSTEM_CODE` 或 Redis 配置。
5. 每次调用都检查进程退出码和 JSON `ok`；禁止 `|| true`。
6. 修改和删除当前为单次执行。Agent 不得添加或猜测不存在的 `--confirm`、`--yes`、
   `--endpoint` 参数。
7. 复杂请求使用 JSON 文件或 stdin，避免 shell 字符串拼接和转义错误。
8. 远端知识库路径始终以 `/` 开头，不把本机绝对路径当作远端路径。
9. 不把 `session_id`、文件正文、检索敏感条件或完整响应写入持久日志。
10. 不自动重试修改和删除；读取请求仅在错误明确标记 `retryable: true` 时有限重试。
11. 浏览目录必须使用 `kbcli item list`；`item glob` 仅用于用户明确要求的路径模式匹配。
12. 不得通过真实请求猜测字段名、枚举或路径语法；先读取 `describe`，参数错误最多修正一次。
13. 不读取已安装包源码来反推 CLI 入参；`describe` 或 `--help` 不完整时停止并报告契约缺口。
14. 上传前只校验本地路径可读，不创建测试文件、不检查魔数来代替上传，也不重复执行上传来诊断传输层。

## 标准 Skill 结构

```text
knowledge-business/
├── SKILL.md
├── scripts/
│   └── run.py
└── references/
    └── requests.md
```

只公开一个业务入口，不同时提供多个语言的等价入口。

## 开发流程

### 1. 固定业务边界

确认 Skill 允许操作的知识库、远端目录、操作类型、多步骤失败补偿和敏感数据返回范围。不要猜测
知识库 ID。若绑定固定知识库，将平台分配的 `resource_id` 固定为字符串常量；若允许用户选择，
公开入口必须显式接收并校验 `resource_id`。

### 2. 查看 CLI 契约

```bash
kbcli --help
kbcli search --help
kbcli search chunks --help
kbcli describe search chunks --format json
```

不存在 `kbcli config`、`kbcli service` 或 endpoint 参数。不要自行探测服务地址。
`describe` 是本地静态契约查询，不需要 `session_id`，也不会发起服务调用。开发脚本读取某个命令
的返回字段前必须先查询其契约，不能通过真实写请求试探输出，也不能从输入 DTO 猜测输出字段。

查询当前用户可用的知识库：

```bash
kbcli base list --session-id "$session_id" --keyword "人事" --page-num 1 --page-size 20
```

CLI 内部固定筛选已上架状态和 `KG_DOC`、`KG_QA`、`KG_TERM`。Skill 不能覆盖这些值；确有业务
需要调整固定筛选时，应修改 CLI 契约，不得由业务 Skill 传入隐藏字段。

### 3. 编写公开入口

推荐 Python 参数数组调用，禁止 `shell=True`：

```python
command = [
    "kbcli", "search", "chunks",
    "--session-id", session_id,
    "--resource-id", "2001",
    "--query", query,
    "--top-k", "5",
    "--mode", "mixedRecall",
]
result = subprocess.run(command, capture_output=True, text=True, check=False)
payload = json.loads(result.stdout)
if result.returncode != 0 or payload.get("ok") is not True:
    raise RuntimeError("kbcli failed")
```

`--mode` 只接受 `mixedRecall`、`fullTextRecall`、`embedding`，默认使用
`mixedRecall`。`INVALID_ARGUMENT` 表示请求参数有误，禁止使用相同参数重试。

浏览目录和按模式匹配：

```bash
kbcli item list --session-id "$session_id" --resource-id 2001 --directory /
kbcli item list --session-id "$session_id" --resource-id 2001 \
  --directory /Product --keyword "架构"
kbcli item glob --session-id "$session_id" --resource-id 2001 \
  --path-rule "/Product/*.md"
kbcli file read --session-id "$session_id" --resource-id 2001 \
  --path "/Ability/MCP 协议服务.md"
kbcli file read --session-id "$session_id" --resource-id 2001 \
  --path "/Ability/MCP 协议服务.md" --start-line 1 --end-line 100
```

`item glob` 的 `--path-rule` 是单个字符串，`*` 只匹配单层路径，不支持 `**`。如果目标是查看某个
目录下有哪些文件或子目录，不得使用 Glob 试探，直接执行一次 `item list`。

`file read` 使用显式的 `--resource-id`、`--path` 和可选行范围。不要传 `--input`，也不要猜测
`filePath`、`directoryPath` 等后端 DTO 字段。不传行号表示读取完整文件；大文件应按行分页读取，
根据返回的 `reachedEof` 决定是否继续。

上传使用显式参数，并且一次用户授权只执行一次：

```bash
kbcli file upload --session-id "$session_id" --resource-id 2001 \
  --directory /reports --file /absolute/local/report.xls
```

文件扩展名与内容格式不一致可以在成功结果后提示用户，但不能据此跳过用户明确要求的上传。上传失败时
按结构化错误停止，不得创建 dummy 文件探测，也不得为了定位 CLI 问题重复写入；传输失败可能对应
远端状态不确定。

构建、转换及结果查询：

```bash
kbcli build start --session-id "$session_id" --resource-id 2001 --path /reports/report.xls
kbcli build convert --session-id "$session_id" --file ./report.xls --output ./report.md
kbcli build from-doc --session-id "$session_id" --resource-id 2001 \
  --directory /reports --doc-name report.md --doc-file ./report.md
kbcli build status --session-id "$session_id" --resource-id 2001 --path /reports/report.md
kbcli build result --session-id "$session_id" --resource-id 2001 --path /reports/report.md
```

`convert` 仅生成本地 Markdown；`from-doc` 入库并立即构建；普通 `file upload` 不等于构建。
`start`、`from-doc` 是写操作，不自动重试；需要观察进度时查询 `status`，需要 Markdown、分块、
向量及检索摘要时查询 `result`。

完整可运行入口见 `examples/byai-knowledge-agent/scripts/run.py`。

### 4. 修改和删除

修改与删除不需要 CLI 二次确认，直接调用：

```bash
kbcli file update --session-id "$session_id" --resource-id 2001 \
  --path /policies/leave.md --file ./leave.md
kbcli file delete --session-id "$session_id" --resource-id 2001 \
  --path /policies/obsolete.md
```

Agent 只能在用户请求明确包含对应副作用时调用，不得因“清理”“同步”等模糊请求扩大删除范围。
成功后如需强校验，使用 `file read`、`item list`、精确的 `item glob` 或 `base get` 验证。

### 5. 多步骤业务

```text
验证本地输入 -> 读取确认前置状态 -> 执行最少写操作 -> 检查每一步 -> 读取验证最终状态
```

一步失败立即停止。若已有操作成功，在结果中列出已完成步骤和待处理补偿，不要自动执行高风险
反向操作。

## 错误处理

| 错误码 | Agent 行为 |
|---|---|
| `INVALID_ARGUMENT` | 修正 Skill 构造的参数；不要原样重试 |
| `OUTPUT_EXISTS` | 选择新输出路径；用户允许覆盖时才加 `--force` |
| `BACKEND_ERROR` | 报告业务错误，不自动重试写操作 |
| `DISCOVERY_UNAVAILABLE` | 报告服务发现不可用，不改用直连 URL |
| `SERVICE_UNAVAILABLE` | 只读可有限重试；写操作报告状态不确定 |
| `PROTOCOL_ERROR` | 停止并报告 CLI/后端契约不兼容 |
| `EMPTY_DOWNLOAD` | 报告远端返回空文件；不自动重试，最终输出不会生成或覆盖 |

同一次只读命令只有在 `retryable: true` 时才允许有限重试；`INVALID_ARGUMENT`、HTTP 400、契约中
明确禁止的枚举或通配符均不得通过变换字段名批量试探。

下载成功必须同时满足退出码为 0、`ok: true`、`data.size > 0` 且输出文件存在。CLI 使用流式下载并
在同目录临时文件验证后原子替换；空响应返回 `EMPTY_DOWNLOAD`，不会留下 0 字节最终文件。Agent
不得将空下载直接断言为后端故障，也不得自行删除其它会话文件。

## 交付检查

- 公开入口只接受业务参数与 `session_id`；
- 无 endpoint、token、Redis 或服务发现配置；
- 所有调用使用参数数组并检查退出码与 `ok`；
- 修改、删除范围精确，不由通配符推导删除目标；
- 测试覆盖成功、参数错误、后端失败和部分完成场景；
- `SKILL.md` 明确哪些用户意图会产生副作用。
