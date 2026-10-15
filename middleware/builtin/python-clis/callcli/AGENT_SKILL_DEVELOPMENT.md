# Agent 基于 callcli 开发业务 Skill 规范

本文档供创建或修改业务 Skill 的 Agent 使用。

平台镜像负责安装：

```bash
callcli --version
```

业务 Skill 只依赖 PATH 中的 `callcli`，不依赖本仓库源码路径、Python 包路径或当前工作目录。

## 1. 核心规则

1. 只通过 `callcli` 调用已授权的 TOOL、TOOLKIT、MCP 和 AGENT，不直接请求资源 URL。
2. Skill 唯一公开入口的第一个参数必须是运行时 `session_id`，并原样传给 `--session-id`。
3. 优先在 Skill 开发时固定 `resource_id` 和 `resource_type`；需要运行时选择时，只能从
   `callcli resource list` 本次返回的候选中选择，不得猜测，也不得默认取第一个资源。
4. 不得让用户或模型提供 endpoint、host、port、MCP Server URL、Redis 地址、Header、Cookie 或 Token。
5. 不得读取、修改、输出或持久化平台鉴权、Redis配置、私有参数或 `session_id`。
6. 每次调用同时检查进程退出码和 JSON `ok`；禁止使用 `|| true` 吞掉失败。
7. 先用 `callcli resource list` 确认当前会话可使用资源，再对唯一候选执行
   `callcli resource describe`；开发参数前先读取本地 `callcli describe` 契约。
8. 复杂输入使用 `--input` JSON 文件或 stdin，禁止使用 `shell=True` 和字符串命令拼接。
9. 不通过真实调用批量试探 action 名称或参数字段；以 describe 返回的 action 和 schema 为准。
10. 参数或 schema 错误最多修正一次；不得原样重试。
11. CLI 默认不自动重试。Skill 只能在 `retryable: true` 且调用明确幂等时有限重试。
12. Agent 调用可能耗时较长，但不得通过重复调用判断其是否仍在运行。
13. `PAGE`、`DOC`、`OBJECT`、`VIEW` 不属于 `callcli` 第一版能力，不得改用相近类型绕过限制。
14. Skill 只公开一个业务入口；不要把通用资源调用器直接暴露给上层 Agent 任意调用。
15. 第一版只支持普通远程 SSE Agent 和 A2A Agent；不得调用 `ASK_PERSONAL`，也不得自行启动 Node
    加载 `index.mjs`。
16. TOOLKIT 和 MCP 每次业务执行都必须按顺序运行 `resource describe → invoke`；不得跳过 describe、
    使用历史缓存的 action/schema，或猜测 action。只有当前 describe 中存在目标 action 才能执行。

## 2. 标准 Skill 结构

```text
business-capability/
├── SKILL.md
├── scripts/
│   └── run.py
└── references/
    └── capability-contract.md
```

一个 Skill 只选择并公开一种入口语言。业务含 JSON 组装、错误映射或条件分支时优先使用 Python。

`capability-contract.md` 记录：

- 固定的 `resource_id`；
- 固定的 `resource_type`；
- 允许使用的 action；
- 每个 action 的输入 schema 摘要；
- Skill 使用的业务字段与远端参数字段映射；
- 是否只读、是否幂等、可能产生的副作用；
- 开发时确认的资源契约版本。

不得记录 URL、Token、Cookie、Redis 配置或开发会话 ID。

若业务明确需要运行时选择资源，文档还必须记录允许的资源业务类型、名称匹配规则、歧义处理和拒绝
边界；不得记录“取第一条”之类依赖排序的规则。

## 3. 开发流程

### 3.1 确认业务边界

开发前明确：

- 用户的哪些意图触发 Skill；
- Skill 允许调用哪个资源和哪些 action；
- 哪些输入必须由用户提供；
- 哪些调用会产生远端副作用；
- 调用能否安全重试；
- 返回数据中哪些字段可以向用户展示；
- 多步骤执行时的停止和补偿策略。

不要为了让 Skill “更通用”而把 `resource_id`、`resource_type` 或 action 全部开放给模型。业务 Skill
应该收敛能力边界。

### 3.2 查看 CLI 静态契约

```bash
callcli --help
callcli invoke --help
callcli describe invoke --format json
callcli describe --all --format json
```

`callcli describe` 在本地运行，不需要 session，也不调用远端资源。不得读取已安装包源码来反推参数；
若 `describe` 或 `--help` 不完整，停止开发并报告 CLI 契约缺口。

### 3.3 发现当前会话可使用资源

```bash
callcli resource list \
  --session-id "$dev_session_id" \
  --keyword "搜索" \
  --resource-type MCP \
  --page-num 1 \
  --page-size 30
```

资源发现由 `callcli` 通过服务发现完成。Agent/Skill 不得：

- 使用 curl 调用 `/listResourceUseAuth`；
- 传入接口 IP、host、port 或 URL；
- 读取或传递 Beyond Token、SSO Token、Cookie、签名或 Redis 配置；
- 添加 `--insecure`；
- 根据 `resourceType=ATOM` 判断它不是 Agent/MCP/Toolkit。

执行路由使用 `resourceBizType`。当前顶层资源目录类型是 `MCP`、`TOOLKIT`、`AGENT`；具体 HTTP
工具通常作为 TOOLKIT 的 action 使用。列表返回零条时停止；返回多条时必须用业务约束继续缩小，
或向用户询问，禁止选择第一条。

固定资源 Skill 也必须在运行时由 `callcli invoke` 重新校验当前会话授权；开发期查询结果不代表永久授权。

### 3.4 查看目标资源契约

使用开发平台提供的临时会话查询：

```bash
callcli resource describe \
  --session-id "$dev_session_id" \
  --resource-id 10001 \
  --resource-type MCP
```

确认：

- 返回的资源 ID 和类型与分配信息完全一致；
- action 名称及大小写；
- input schema 的字段名、类型、必填项和枚举；
- 资源是否为只读、幂等或有副作用；
- 当前会话是否有权使用。

不得将 `dev_session_id` 写入 Skill。无法读取资源描述时，停止开发，不使用猜测参数执行真实请求。

这一步不只是开发期检查。TOOLKIT/MCP 的公开脚本必须在每次运行时重新执行同样的 describe，并从
本次结果确认固定 action 仍存在及 schema 仍兼容，然后才能 invoke。describe 失败、action 缺失或
schema 不兼容时立即停止；禁止用 invoke 的失败响应代替资源描述。

### 3.5 编写唯一公开入口

推荐 Python：

```python
#!/usr/bin/env python3
import json
import subprocess
import sys


RESOURCE_ID = "10001"       # 开发时由平台分配并固定
RESOURCE_TYPE = "MCP"       # TOOL | TOOLKIT | MCP | AGENT
ACTION = "search"           # TOOL/AGENT 不需要 action


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        emit({
            "ok": False,
            "error": {
                "code": "INVALID_ARGUMENT",
                "message": "usage: run.py <session_id> <query>",
            },
        })
        return 2

    session_id, query = argv[1:]
    if not session_id or not query.strip():
        emit({
            "ok": False,
            "error": {
                "code": "INVALID_ARGUMENT",
                "message": "session_id and query are required",
            },
        })
        return 2

    request = {
        "action": ACTION,
        "arguments": {"keyword": query},
    }
    command = [
        "callcli", "invoke",
        "--session-id", session_id,
        "--resource-id", RESOURCE_ID,
        "--resource-type", RESOURCE_TYPE,
        "--input", "-",
        "--format", "json",
    ]
    completed = subprocess.run(
        command,
        input=json.dumps(request, ensure_ascii=False),
        capture_output=True,
        text=True,
        check=False,
    )

    try:
        payload = json.loads(completed.stdout)
    except ValueError:
        emit({
            "ok": False,
            "error": {
                "code": "CALLCLI_PROTOCOL_ERROR",
                "message": "callcli returned invalid JSON",
            },
        })
        return 14

    emit(payload)
    if completed.returncode != 0:
        return completed.returncode
    return 0 if payload.get("ok") is True else 14


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
```

要求：

- 使用 `subprocess.run([...])` 参数数组；
- 禁止 `shell=True`；
- JSON 通过 stdin 传递，不把复杂 JSON 拼进命令字符串；
- 第一个公开运行时参数固定为 `session_id`；
- resource ID/type/action 使用代码中的常量；
- 不输出 stderr 中可能包含的诊断细节给最终用户；
- 使用 `Path(__file__)` 解析 Skill 内文件，不依赖当前工作目录；
- 将 CLI 退出码原样向上传递。

## 4. 按资源类型开发

### 4.1 TOOL Skill

TOOL 没有 action：

```python
request = {
    "arguments": {
        "city": city,
        "date": date,
    }
}

command = [
    "callcli", "invoke",
    "--session-id", session_id,
    "--resource-id", RESOURCE_ID,
    "--resource-type", "TOOL",
    "--input", "-",
]
```

必须严格使用 describe 中的字段名。不要把字段 description、中文展示名或用户说法直接当作 JSON 键。

### 4.2 TOOLKIT Skill

TOOLKIT 可以包含多个子工具，Skill 应固定允许的 action：

```python
ALLOWED_ACTIONS = {"query_order", "cancel_order"}
```

上层业务参数可以决定使用允许集合中的哪一个 action，但不能把未经校验的用户文本直接作为 action。
每次调用前必须执行 `callcli resource describe`，从本次返回的 `actions` 精确匹配允许 action；未匹配
时停止，不直接 invoke。

涉及文件上传时，传递绝对路径并在调用前验证它是可读普通文件。不得创建 dummy 文件探测接口，
也不得重复上传诊断失败。上传成功或失败都可能已经产生远端状态，除非接口具有明确幂等键，否则不自动重试。

### 4.3 MCP Skill

MCP action 必须来自 `resource describe` 返回的工具列表：

```python
RESOURCE_ID = "10001"
RESOURCE_TYPE = "MCP"
ACTION = "search"
```

每次业务请求都重新 describe。只从本次返回的 `tools` 精确匹配 action，并按其 `inputSchema` 组装
参数；不得依赖上一次对话中的工具列表或直接尝试 invoke。

Skill 不直接执行 MCP `initialize`、`tools/list` 或 `tools/call`，不保存 `Mcp-Session-Id`，不拼 JSON-RPC，
也不连接 MCP Server URL。这些全部属于 `callcli`。

参数错误时不得批量尝试相似字段名或其它 action。重新读取一次 describe；如果契约没有变化，报告
Skill 与资源契约不兼容。

### 4.4 AGENT Skill

默认使用非流式 JSON，让 CLI 聚合最终答案：

```python
request = {
    "query": user_query,
    "arguments": {
        "deep_think": True,
    },
}
```

```bash
callcli invoke \
  --session-id "$session_id" \
  --resource-id 10004 \
  --resource-type AGENT \
  --input -
```

不要把同一个用户任务重复提交给 Agent 来查询状态。超时或网络中断时，只有响应明确标记
`retryable: true` 且调用具备业务幂等性时才允许重试。

只有公开入口确实需要实时消费过程时才使用 NDJSON：

```python
process = subprocess.Popen(
    command + ["--stream", "--format", "ndjson"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)
```

逐行解析 JSON，最后必须观察到 `complete` 或 `error`。不得把 `thinking` 当作最终结果，也不得把
stderr 当作业务输出。

如果返回 `UNSUPPORTED_INTERACTIVE_AGENT`，说明资源需要 PAGE/UI 交互。停止并向用户说明当前 Skill
不支持该资源，不得伪造成功或切换到其它资源。

如果返回 `UNSUPPORTED_LOCAL_AGENT`，说明资源是 `ASK_PERSONAL` 本地 JavaScript 智能体。第一版
`callcli` 不支持它；停止并报告能力边界，不得自行调用 Node、导入 `index.mjs` 或改走其它资源。

## 5. 多步骤业务编排

`callcli` 不保证多个资源调用之间的事务性：

```text
验证全部输入
  -> 读取/describe 前置状态
  -> 执行最少数量的调用
  -> 每一步检查退出码和 ok
  -> 失败立即停止
  -> 报告已完成步骤与状态未知步骤
```

多步骤写操作必须在 `SKILL.md` 中定义：

- 执行顺序；
- 幂等键；
- 哪一步开始产生副作用；
- 哪些步骤可安全重试；
- 失败后的人工处理或补偿方式；
- 远端结果未知时如何查询业务状态。

不要自动执行破坏性补偿。CLI 调用与数据库、知识库、文件或消息系统之间没有原子事务。

## 6. 错误处理

| 错误码 | Agent/Skill 行为 |
|---|---|
| `INVALID_ARGUMENT` | 修正 Skill 构造参数，禁止原样重试 |
| `RESOURCE_NOT_FOUND` | 停止，不猜测或切换资源 ID |
| `RESOURCE_FORBIDDEN` | 停止，当前会话无权使用固定资源 |
| `RESOURCE_DETAILS_NOT_FOUND` | 授权存在但缺少执行详情；停止并报告运行时同步问题 |
| `RESOURCE_TYPE_MISMATCH` | 停止并更新 Skill 契约，不跨类型尝试 |
| `UNSUPPORTED_RESOURCE_TYPE` | 停止，不降级到其它调用方式 |
| `ACTION_REQUIRED` | 根据固定业务规则选择 action，不询问模型任意选择 |
| `ACTION_NOT_FOUND` | 重新 describe；仍不存在则停止 |
| `INVALID_PARAMETERS` | 按 input schema 修正一次，不批量试探字段名 |
| `AUTH_EXPIRED` / `SESSION_INVALID` | 停止，不生成新 session，不请求用户提供 Token |
| `TOOL_REQUEST_FAILED` | 报告调用失败；非幂等操作不自动重试 |
| `MCP_DISCOVERY_FAILED` | 报告 MCP 不可用，不改用直接 URL |
| `MCP_CALL_FAILED` | 按 retryable 和幂等性决定是否有限重试 |
| `AGENT_TIMEOUT` | 不重复提交任务；先判断结果是否可能仍在执行 |
| `UNSUPPORTED_INTERACTIVE_AGENT` | 提示需要页面交互并停止 |
| `UNSUPPORTED_LOCAL_AGENT` | 提示 ASK_PERSONAL 不在第一版范围并停止 |
| `OUTCOME_UNKNOWN` | 禁止盲目重试，使用业务幂等键查询状态 |
| `CALLCLI_UNAVAILABLE` | 停止并报告运行时能力缺失 |

## 7. SKILL.md 必须包含的说明

```markdown
## Capability execution

- Invoke only `scripts/run.py` for this business operation.
- Call it as `scripts/run.py <session_id> <business arguments...>`.
- Treat `session_id` as an opaque runtime value; never generate, log, persist, or hard-code it.
- Use only the resource ID, resource type, and actions fixed by this Skill.
- Resolve runtime-selectable resources only from `callcli resource list`; never select the first result implicitly.
- Do not accept resource URLs, MCP Server URLs, Redis configuration, headers, cookies, or tokens.
- Do not invoke `callcli` with a resource selected from unvalidated user text.
- All capability access goes through `callcli`; do not use curl or implement HTTP, MCP, SSE, or A2A directly.
- The command is successful only when it exits with code 0 and returns `ok: true`.
- Do not retry mutations, Agent submissions, or unknown outcomes automatically.
```

`SKILL.md` 还必须说明：

- 触发条件和拒绝边界；
- 唯一公开入口；
- 业务参数及校验；
- 固定资源和允许 action；
- 成功输出；
- 可能错误及处理；
- 哪些调用有副作用并要求用户明确授权；
- 是否允许有限重试及其幂等前提。

## 8. 推荐 SKILL.md 示例

```markdown
---
name: product-search
description: Use when the user asks to search the authorized product catalog.
---

# Product Search

Use only `scripts/run.py`.

## Workflow

1. Obtain `session_id` from the current runtime context.
2. Validate that the user supplied a non-empty product query.
3. Run `scripts/run.py <session_id> <query>` once.
4. Parse its JSON output and require exit code 0 plus `ok: true`.
5. Present only the business fields in `data`.

## Capability execution

- The script uses the fixed MCP resource and fixed `search` action defined by this Skill.
- Never ask for or accept a resource URL, MCP URL, token, header, or Redis configuration.
- Never call the MCP server directly or substitute curl for `callcli`.
- Never retry `INVALID_ARGUMENT`, `ACTION_NOT_FOUND`, or `INVALID_PARAMETERS`.
- Do not expose the runtime session ID in the final response or logs.
```

## 9. 发布前检查

- [ ] Skill 只有一个公开入口。
- [ ] 入口第一个参数是动态 `session_id`。
- [ ] `resource_id`、`resource_type` 和允许 action 已固定。
- [ ] 若允许运行时选资源，候选只来自 `callcli resource list`，并有唯一匹配与歧义处理规则。
- [ ] 未接受 URL、host、port、Token、Header 或 Redis 配置。
- [ ] 使用 `subprocess.run([...])`，没有 `shell=True`。
- [ ] 复杂 JSON 通过 stdin 或文件传递。
- [ ] 同时检查退出码和 `ok`。
- [ ] 未使用 `|| true` 吞掉错误。
- [ ] 已通过 `callcli resource describe` 验证 action 和 schema。
- [ ] 未通过真实写请求试探字段。
- [ ] 未直接实现 HTTP、MCP、SSE 或 A2A。
- [ ] AGENT 资源不是 ASK_PERSONAL；脚本不会启动 Node 或加载 `index.mjs`。
- [ ] 副作用范围和用户授权规则已写入 `SKILL.md`。
- [ ] 非幂等调用、Agent 提交和未知结果不会自动重试。
- [ ] 多步骤失败会报告部分完成状态。
- [ ] 日志和产物中没有 session、Token、Cookie 或私有参数。
- [ ] 测试覆盖成功、参数错误、CLI 协议错误、远端失败、超时和中断。

## 10. 禁止的实现

```python
# 错误：直接请求资源地址
requests.post("http://internal-tool/api", json=payload)

# 错误：shell=True 和字符串拼接
subprocess.run(f"callcli invoke --arguments '{user_json}'", shell=True)

# 错误：允许用户覆盖固定资源
resource_id = sys.argv[2]

# 错误：忽略退出码
payload = json.loads(subprocess.run(command, capture_output=True, text=True).stdout)

# 错误：自己实现 MCP 协议
requests.post(mcp_url, json={"jsonrpc": "2.0", "method": "tools/call"})

# 错误：绕过服务发现直接查询授权接口
subprocess.run(["curl", "http://internal-host/byaiService/auth/privilegeGrant/listResourceUseAuth"])
```
