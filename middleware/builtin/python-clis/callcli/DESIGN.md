# callcli 设计：面向 Skill 的统一能力调用运行时

## 1. 目标

`callcli` 为 Agent 开发的业务 Skill 提供稳定的资源发现和调用命令。Skill 只知道当前运行时的
`session_id`、经过授权目录确认的 `resource_id`、资源类型和业务参数，不知道服务实例、IP、端口、
Redis、Cookie、Token 或具体协议。

第一版只支持以下资源：

- `TOOL`：单个 HTTP 工具；
- `TOOLKIT`：包含多个子工具的 HTTP 工具集；
- `MCP`：通过 MCP 协议发现并调用工具；
- `AGENT`：普通远程 SSE 或 A2A 智能体。

第一版不支持 `DOC`、`OBJECT`、`VIEW` 和需要页面交互闭环的 `PAGE` Agent。不得把这些资源静默
降级成 TOOL、MCP 或普通 AGENT 调用。第一版也不支持需要加载 JavaScript `index.mjs` 的
`ASK_PERSONAL` 本地智能体，不引入 Node 执行桥。

`callcli` 参考 `kbcli`、`dbcli` 的外部契约：服务发现、本地 `describe`、stdout 机器可读 JSON、stderr
诊断、稳定退出码、运行时身份显式传递、后端地址和凭证对 Skill 不可见。

## 2. 核心决策

### 2.1 CLI 是独立能力边界，不是 `baiying_call` 的子进程包装

新 CLI 使用独立的 Python Core，现有 TypeScript `baiying_call` 暂时保持不变：

```text
Skill -> callcli -> Python Capability Runtime
OpenClaw -> baiying_call -> existing TypeScript Executor
```

禁止 CLI 通过 OpenClaw Gateway 反向调用 `baiying_call`。Python 实现应依据稳定的调用契约和协议
fixture 实现 TOOL、TOOLKIT、MCP、AGENT，并通过跨实现兼容测试避免与现有 TypeScript 行为无意分叉。
CLI 的协议可以更严格，例如精确 action、精确资源类型和同一 MCP session；不继承旧实现中的兼容性猜测。

### 2.2 全 Python 实现

`callcli` 与 `kbcli`、`dbcli` 一样使用 Python 3.11+、`pyproject.toml` 和 console script 发布。
命令解析使用标准库 `argparse`；HTTP/SSE 使用 `httpx`；JSON Schema 使用 `jsonschema`；服务发现
使用平台提供的 Python `by_framework`。MCP 优先使用平台验证过的 MCP Python SDK；若 SDK 不能
覆盖现有 Legacy SSE，则在 `callcli` 内实现有边界的兼容传输层。

平台镜像将 wheel 安装到 `PATH`。Skill 只依赖命令名，不依赖仓库路径、Python 包路径或当前
工作目录。

### 2.3 精确资源选择

每次联网调用都必须显式传递：

```text
--session-id <current-session-id>
--resource-id <resource-id>
--resource-type TOOL|TOOLKIT|MCP|AGENT
```

CLI 不接受 `resource_name` 作为执行标识，不选择“第一个绑定资源”，不跨类型搜索同 ID 资源，
也不根据请求文本猜测资源。请求类型与实际类型不一致时返回 `RESOURCE_TYPE_MISMATCH`。

资源 ID 在输入输出中始终作为字符串处理。

`resource list` 用于获得当前会话可使用的资源；`resource describe` 和 `invoke` 仍必须传精确 ID。
CLI 不允许仅凭名称直接执行。调用前运行时必须再次确认精确资源仍在当前会话授权目录中，避免使用
过期的开发期授权结果。

## 3. 运行时架构

```text
User request
  -> Agent selects a business Skill
  -> Skill public script receives session_id and business arguments
  -> callcli validates command and loads its local contract
  -> ResourceCatalog discovers currently authorized resources through ByaiService
  -> CapabilityProvider resolves the exact authorized resource
  -> CredentialProvider injects runtime credentials and private parameters
  -> BaiyingCallService normalizes the request
  -> BaiyingExecutor dispatches by exact resource type
       TOOL    -> ToolExecutor -> HTTP JSON
       TOOLKIT -> ToolkitExecutor -> HTTP JSON / multipart
       MCP     -> McpSession -> initialize/list/call
       AGENT   -> AgentExecutor -> SSE/A2A/local module
  -> stable JSON or NDJSON on stdout
```

### 3.1 组件职责

| 组件 | 职责 |
|---|---|
| CLI Parser | 解析命令，读取 JSON 输入，管理退出码和信号 |
| Contract Registry | 提供 `describe` 的本地静态机器可读契约 |
| ResourceCatalog | 通过服务发现调用授权目录，列出并校验当前会话可使用资源 |
| CapabilityRuntime | 校验资源引用，构造通用调用上下文，调用 Executor，规范化响应 |
| CapabilityProvider | 精确解析资源快照，不向 Skill 暴露 Redis |
| CredentialProvider | 加载会话鉴权、资源 Header、私有参数并负责日志脱敏 |
| BaiyingExecutor | 按资源类型分派执行器 |
| ToolExecutor | 调用单 HTTP 工具 |
| ToolkitExecutor | 选择子工具并调用 JSON 或 multipart 接口 |
| McpSession | 在同一 MCP 会话中完成初始化、发现和调用 |
| AgentExecutor | 执行 SSE/A2A/本地 Agent，并产生中立运行时事件 |
| OutputSink | CLI 输出 JSON/NDJSON，OpenClaw 输出 Gateway 事件 |

## 4. 命令契约

### 4.1 本地契约查询

```bash
callcli describe resource list --format json
callcli describe resource describe --format json
callcli describe invoke --format json
callcli describe --all --format json
```

`describe` 完全在本地执行，不需要 `session_id`，不访问 Redis、MCP Server 或远端服务。输出包括
输入 schema、输出 envelope、错误码、资源类型差异和安全说明。

### 4.2 列出当前会话可使用资源

```bash
callcli resource list \
  --session-id "$session_id" \
  --keyword "搜索" \
  --resource-type MCP \
  --page-num 1 \
  --page-size 30
```

不传 `--resource-type` 时，CLI 固定请求所有顶层可调用资源：

```json
{
  "keyword": "",
  "pageNum": 1,
  "pageSize": 30,
  "resourceStatus": "2",
  "resourceBizTypeList": ["MCP", "TOOLKIT", "AGENT"],
  "permission": "",
  "digitalEmployeeType": "",
  "language": "zh-CN"
}
```

该列表接口的顶层业务类型遵循资源中心现有契约，只有 `MCP`、`TOOLKIT`、`AGENT`。独立 `TOOL`
执行能力保留给已经获得精确 TOOL Capability 的兼容场景；普通资源目录中的具体工具通过
`TOOLKIT + action` 暴露，CLI 不向授权接口发送未经后端契约确认的 `TOOL` 过滤值。

接口映射：

```text
POST /byaiService/auth/privilegeGrant/listResourceUseAuth
```

必须通过 `by_framework` 的 `DiscoveryClient + DiscoveryHttpClient` 解析 `ByaiService`，不得接受或
固化原始 URL、IP、端口。服务名由平台运行环境提供，建议优先读取
`CALLCLI_RESOURCE_SERVICE`，兼容回退 `BE_DOMAINNAME`；缺失时返回 `DISCOVERY_UNAVAILABLE`。

请求 Header 由运行时构建：

```text
Accept: application/json
Content-Type: application/json
x-session-id: <session_id>
Beyond-Token: <platform environment>
SSO-TOKEN: <optional platform environment>
system-code: <optional platform environment, normally BYAI>
language: zh-CN
```

浏览器专用的 Origin、Referer、User-Agent、Cookie 和 `x-signature-*` 不属于 Skill 入参。如果部署
环境要求签名，签名必须由平台 HTTP Client/签名组件根据请求即时生成；Skill 和 CLI 参数均不得接受
签名值。不得使用 `--insecure` 绕过 TLS 校验。

CLI 将后端结果归一化，保留授权判断和调用所需字段：

```json
{
  "ok": true,
  "operation": "capability.resource.list",
  "data": {
    "items": [
      {
        "resourceId": "10001683",
        "resourceBizType": "AGENT",
        "resourceType": "ATOM",
        "resourceCode": "846687083037765",
        "resourceName": "示例智能体",
        "resourceDesc": "示例",
        "resourceVersion": "1.0.0",
        "systemCode": "WHALE_AGENT",
        "hostType": "hosted",
        "ownerType": "personal",
        "authStatus": "passed",
        "hasPermission": false
      }
    ],
    "pageNum": 1,
    "pageSize": 30,
    "total": 85,
    "totalPages": 3
  },
  "meta": {"backendCode": 0, "backendMessage": "ok"}
}
```

路由类型必须取 `resourceBizType`，不能取示例中值为 `ATOM` 的 `resourceType`。`resourceType` 作为
原始资源形态保留，不能覆盖业务路由类型。授权接口返回 `code=0` 且 `success=true` 才视为成功；
`authStatus` 非 `passed` 的条目不进入可调用集合。`hasPermission` 的实际业务语义需要后端确认，
在确认前不能仅因其为 `false` 就否定已经 `authStatus=passed` 的条目。

支持 `--all-pages` 由 CLI 顺序获取全部页。普通 `resource list` 不应自动扫完所有页；Skill 应先用
精确关键词和类型缩小范围。列表只做发现，不执行资源。

### 4.3 资源描述

```bash
callcli resource describe \
  --session-id "$session_id" \
  --resource-id 10001 \
  --resource-type MCP
```

该命令解析当前会话有权使用的精确资源，返回名称、描述、类型、子 action 及其输入 schema；
不执行具体 action。

```json
{
  "ok": true,
  "operation": "capability.resource.describe",
  "data": {
    "resourceId": "10001",
    "resourceType": "MCP",
    "resourceName": "search-service",
    "actions": [
      {
        "name": "search",
        "description": "Search content",
        "inputSchema": {
          "type": "object",
          "required": ["keyword"],
          "properties": {"keyword": {"type": "string"}}
        }
      }
    ]
  },
  "meta": {"contractVersion": "1"}
}
```

对 MCP，`resource describe` 可以执行一次协议级 `initialize` 和 `tools/list`，但不得调用任何工具。
TOOL/TOOLKIT/AGENT 的描述优先来自授权资源快照。

### 4.4 调用资源

简单参数可以显式传递：

```bash
callcli invoke \
  --session-id "$session_id" \
  --resource-id 10001 \
  --resource-type MCP \
  --action search \
  --arguments '{"keyword":"新能源汽车"}'
```

复杂请求推荐使用 `--input`：

```bash
printf '%s' "$request_json" | callcli invoke \
  --session-id "$session_id" \
  --resource-id 10001 \
  --resource-type MCP \
  --input -
```

`--input` 接受 JSON 对象文本、JSON 文件路径或 `-`。其业务结构为：

```json
{
  "action": "search",
  "query": "查找新能源汽车相关内容",
  "arguments": {
    "keyword": "新能源汽车"
  },
  "options": {
    "timeoutMs": 30000
  }
}
```

身份和资源引用只允许通过显式 CLI 参数传递，不允许在 `--input` 中覆盖。这避免不可信业务 JSON
改变会话或目标资源。

参数规则：

| 类型 | `query` | `action` | `arguments` |
|---|---|---|---|
| TOOL | 可选 | 禁止 | 按 Tool schema |
| TOOLKIT | 可选 | 多子工具时必填 | 按选中子工具 schema |
| MCP | 可选 | 多子工具时必填 | 按 MCP Tool schema |
| AGENT | 必填 | 禁止 | 可选扩展参数 |

`--arguments` 与 `--input` 互斥。`--query`、`--action` 可用于简单请求，但不得与 `--input` 中的
同名字段同时出现。

### 4.5 Agent 流式输出

默认模式等待完成后输出单个 JSON。需要过程事件时使用：

```bash
callcli invoke \
  --session-id "$session_id" \
  --resource-id 10004 \
  --resource-type AGENT \
  --query "分析这个问题" \
  --stream --format ndjson
```

每行是一个独立 JSON：

```json
{"event":"start","operation":"capability.invoke","target":{"resourceId":"10004","resourceType":"AGENT"}}
{"event":"delta","data":{"text":"正在分析"}}
{"event":"complete","data":{"text":"最终结果"}}
```

最后一行必须是 `complete` 或 `error`。Skill 若不需要实时展示，应使用默认 JSON 模式，避免自行
聚合流事件。

## 5. 统一输出与退出码

非流式 stdout 只输出一个 JSON 对象，诊断只能写 stderr：

```json
{"ok":true,"operation":"capability.invoke","data":{},"target":{"resourceId":"10001","resourceType":"MCP","action":"search"},"meta":{"durationMs":238}}
```

```json
{"ok":false,"operation":"capability.invoke","error":{"code":"INVALID_ARGUMENT","message":"action is required","retryable":false},"target":{"resourceId":"10001","resourceType":"MCP"}}
```

| 退出码 | 含义 |
|---:|---|
| 0 | 成功 |
| 2 | 参数、JSON、输入文件或本地文件错误 |
| 3 | 资源不存在、未授权、不支持或类型不匹配 |
| 4 | action 不存在或 arguments 不符合 schema |
| 5 | 会话或远端鉴权失败 |
| 11 | 远端业务拒绝或工具返回业务失败 |
| 13 | 超时 |
| 14 | 服务发现、Redis、网络、协议或运行时错误 |
| 15 | 调用被取消 |

调用方必须同时检查退出码和 JSON `ok`，不得使用 `|| true`。流式模式必须同时检查进程退出码和
最后一个事件。

## 6. Capability 解析

定义严格的 Provider 接口：

```ts
interface CapabilityProvider {
  resolve(input: {
    sessionId: string;
    resourceId: string;
    resourceType: SupportedResourceType;
  }): Promise<Capability>;
}
```

生产环境使用组合 Provider。授权目录是“能否使用”的权威来源，Redis/资源详情是“如何执行”的
Capability 来源：

```text
listResourceUseAuth 精确授权确认
  -> Redis/资源详情加载 Capability
  -> 校验 ID 与 resourceBizType 一致
  -> 执行
```

其职责是：

1. 通过服务发现调用授权目录并精确确认 ID；
2. 使用精确 `<PREFIX>_<resource_id>` 查找资源执行详情；
3. 校验详情的资源 ID、类型与授权目录一致；
4. 将原始资源转换为内部 Capability；
5. 解析 Header 中的凭证占位符；
6. 返回 `RESOURCE_NOT_FOUND`、`RESOURCE_FORBIDDEN`、`RESOURCE_DETAILS_NOT_FOUND` 或
   `RESOURCE_TYPE_MISMATCH`。

不允许像现有兼容逻辑一样遍历所有类型寻找同 ID，也不允许使用最小 Stub 尝试执行。

测试和本地开发可显式启用 `FileCapabilityProvider`，但生产命令不向 Skill 暴露
`--capability-file`、Redis URL、服务地址或 Header 参数。

## 7. 四类执行器设计

### 7.1 TOOL

复用现有 `executeTool`：

1. 按 `input_schema` 校验 `arguments`；
2. 解析私有参数占位符；
3. 合并平台鉴权和资源 Header；
4. JSON POST 到资源 URL；
5. JSON 响应解析失败时保留文本；
6. 401/403 映射为稳定鉴权错误。

必须删除任何按固定地址注入硬编码 Token 的逻辑，凭证只能来自 `CredentialProvider`。

### 7.2 TOOLKIT

复用现有 `executeToolkit`：

1. 根据 `action` 精确匹配子工具；
2. 多 action 且缺少 `action` 时返回 `ACTION_REQUIRED`；
3. 禁止模糊包含匹配，避免自动调用错误工具；
4. 按子工具 schema 校验 `arguments`；
5. 二进制 schema 使用 multipart，其余使用 JSON；
6. 本地文件必须是绝对路径、普通文件且可读。

### 7.3 MCP

将发现和执行抽成单个 `McpSession`：

```ts
interface McpSession {
  initialize(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
```

Streamable HTTP 必须在 `initialize` 后保存服务端返回的 `Mcp-Session-Id`，并在
`notifications/initialized`、`tools/list`、`tools/call` 中复用。Legacy SSE 通过同一 SSE 会话完成
初始化、通知和调用。`AbortSignal` 必须贯穿整个生命周期。

`action` 只允许对 `tools/list` 返回的名称进行大小写敏感精确匹配。调用前使用实时 schema 校验
arguments。

### 7.4 AGENT

Python Agent 执行器将传输与输出拆开：

```python
class AgentEventSink(Protocol):
    async def emit(self, event: AgentRuntimeEvent) -> None: ...
```

- `CliAgentEventSink`：输出 NDJSON 或在内存中聚合最终文本；
- 普通 Agent：POST SSE 请求并转换为统一事件；
- A2A Agent：读取 Agent Card，发送 `message/stream`，转换 task/message/status/artifact；
- `ASK_PERSONAL`：返回 `UNSUPPORTED_LOCAL_AGENT`，不加载 `index.mjs`，不启动 Node；
- `documentDriven` 本地智能体随 `ASK_PERSONAL` 一并排除。

CLI 不读取 OpenClaw chat history。若业务 Agent 需要历史，应由公开协议显式支持历史输入，或由远端
按 `session_id` 管理上下文，禁止 CLI 隐式读取另一个 Agent 的会话。

`PAGE` Agent 返回 `UNSUPPORTED_INTERACTIVE_AGENT`，不伪装成成功或等待状态。

## 8. 身份、鉴权和日志

所有联网命令要求 `--session-id`。平台运行环境负责提供资源发现和鉴权所需环境变量、Redis 配置、
`Beyond-Token`、SSO Token、系统编码及用户私有参数。

Skill 不得读取、设置、输出或持久化这些变量。CLI 不接受以下参数：

```text
--url --endpoint --host --port --redis-url --token --cookie --authorization --header
```

资源发现请求的网络重试只覆盖连接失败和 HTTP 502/503/504，最多三次；后端业务拒绝、401/403、
参数错误不重试。授权结果可在单进程内短暂缓存，但 `invoke` 不能依赖跨进程缓存，也不能只相信 Skill
固定的资源 ID。

日志规则：

- stdout 只输出协议数据；
- stderr 只输出必要诊断；
- 默认不打印完整请求参数和完整响应；
- Authorization、Cookie、Token、Session、私有参数值必须脱敏；
- `--debug` 仍不得解除凭证脱敏；
- `session_id` 不写入持久日志。

## 9. 超时、取消和重试

- CLI 收到 SIGINT/SIGTERM 时触发统一 `AbortController`；
- HTTP、MCP、SSE、A2A 和本地 Agent 都必须接收同一个 `AbortSignal`；
- 默认 TOOL/TOOLKIT/MCP 超时 30 秒，AGENT 超时 10 分钟；
- 参数错误、schema 错误、鉴权错误不得重试；
- CLI 自身不自动重试调用；
- Skill 只能在 `retryable: true` 且操作已知只读或幂等时有限重试；
- 传输失败时若远端执行状态未知，错误必须包含 `outcomeUnknown: true`。

## 10. 建议代码结构

```text
middleware/openclaw/callcli/
├── DESIGN.md
├── AGENT_SKILL_DEVELOPMENT.md
├── pyproject.toml
├── src/callcli/
│   ├── __init__.py
│   ├── __main__.py
│   ├── cli.py
│   ├── contracts.py
│   ├── errors.py
│   ├── serialization.py
│   ├── service_client.py
│   ├── resource_catalog.py
│   ├── capability_resolver.py
│   ├── credentials.py
│   ├── runtime.py
│   ├── http.py
│   ├── sse.py
│   ├── a2a.py
│   ├── mcp.py
│   ├── output_sink.py
│   └── executors/
│       ├── base.py
│       ├── tool.py
│       ├── toolkit.py
│       ├── mcp.py
│       └── agent.py
└── tests/
    ├── test_cli.py
    ├── test_contracts.py
    ├── test_resource_catalog.py
    ├── test_tool_executor.py
    ├── test_toolkit_executor.py
    ├── test_mcp_executor.py
    └── test_agent_executor.py
```

`callcli` 不直接导入 `baiying-enhance` TypeScript 源码，也不执行其构建产物。两套实现共享版本化
JSON fixture 和协议测试数据，而不是建立跨语言源码依赖。

## 11. 实现步骤

### 阶段一：锁定契约

1. 建立 `contracts.py` 和 `callcli describe`；
2. 实现 `ResourceCatalog` 和 `callcli resource list`；
3. 建立统一成功/错误 envelope；
4. 建立退出码映射；
5. 为分页、字段归一化、参数互斥、资源类型和 JSON 输入编写测试。

### 阶段二：实现 Python Core

1. 实现 `CapabilityRuntime`、CredentialProvider 和严格 CapabilityResolver；
2. 复用 `kbcli/dbcli` 的 Python 服务发现初始化与 HTTP Client 模式；
3. 建立与现有 `baiying_call` 相同输入资源的 JSON fixture；
4. 对齐成功 envelope、主要错误码、Header 合并和参数 schema 行为。

### 阶段三：TOOL、TOOLKIT、MCP

1. 接入三个现有执行器；
2. 删除硬编码鉴权；
3. TOOLKIT action 改为精确匹配；
4. 建立同会话 MCP 生命周期；
5. 覆盖 schema、鉴权、协议、超时和取消测试。

### 阶段四：AGENT

1. 引入 Python `AgentEventSink` Protocol；
2. 实现 JSON 聚合与 NDJSON 流；
3. 支持普通远程 SSE 和 A2A；
4. 明确拒绝 PAGE 和 ASK_PERSONAL；
5. 验证 CLI 无 Node 运行时依赖。

### 阶段五：发布和示例 Skill

1. 构建 `byclaw_callcli-*.whl`；
2. 平台镜像通过 pip 安装 `callcli` 到 PATH；
3. 增加一个固定 MCP 资源的示例 Skill；
4. 验证 Skill 不依赖仓库路径和当前工作目录。

## 12. 验证要求

- `describe` 无网络执行；
- `resource list` 通过服务发现访问授权接口，不接受原始 endpoint；
- 只使用 `resourceBizType` 进行执行路由；
- `invoke` 会重新确认当前会话对精确资源的授权；
- stdout 严格为单 JSON 或 NDJSON，不混入日志；
- 所有失败都有稳定错误码和退出码；
- 精确资源 ID/type 校验；
- TOOL/TOOLKIT/MCP schema 校验；
- MCP session ID 在发现和调用间保持一致；
- Agent 最后一条事件必为 `complete` 或 `error`；
- ASK_PERSONAL 返回 `UNSUPPORTED_LOCAL_AGENT`，且不会启动 Node 子进程；
- SIGINT、SIGTERM 和超时能取消底层请求；
- 日志不存在凭证和私有参数明文；
- Skill 只使用 PATH 中的 `callcli`；
- 原有 `baiying_call` 行为测试不回退。
- Python CLI 与 TypeScript 实现的共享协议 fixture 兼容。
