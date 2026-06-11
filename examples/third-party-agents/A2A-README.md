# 接入 A2A 数字员工

本文说明如何把一个外部的 **A2A（Agent-to-Agent）协议** 数字员工接入 Byclaw（鲸智百应）平台。平台侧由 [`A2aRouteService`](../../byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/route/A2aRouteService.java) 负责路由，本文档描述它对你（A2A 服务端）的契约要求。

## 一、整体流程

```
Byclaw 网关                          你的 A2A 数字员工
    │                                      │
    │  1. GET  {agentSseUrl}  拉取 Agent Card
    │ ───────────────────────────────────▶ │
    │ ◀─────────────────────────────────── │  返回 Agent Card JSON（含 url 字段）
    │                                      │
    │  2. POST {card.url}  JSON-RPC message/stream
    │ ───────────────────────────────────▶ │
    │ ◀─────────────────────────────────── │  3. 返回 SSE 流（text/event-stream）
    │     逐行解析并转写给前端              │
```

1. 网关用 GET 请求拉取 **Agent Card**（地址来自平台配置的 `agentSseUrl`）。
2. 从 Card 的 `url` 字段拿到 **JSON-RPC 端点**，发起 `message/stream` 调用。
3. 你以 SSE 流式返回响应，网关把每条事件映射成内部事件转写给客户端。

## 二、平台侧配置

在「智能体管理」中创建一个外部智能体，关键字段：

| 字段 | 取值 | 说明 |
|------|------|------|
| `createType` | `FROM_THIRD` | 标记为第三方接入 |
| `integrationType` | `A2A` | 走 A2A 路由 |
| `agentSseUrl` | 你的 Agent Card 地址 | 网关 GET 这个地址拿 Card |

三者缺一不会进入 A2A 路由。`agentSseUrl` 为空会直接报错 `route.a2a.sse.url.empty`。

### 透传的请求头

网关只会把以下请求头透传到你的服务（GET Card 与 POST RPC 都带），其余一律丢弃：

```
beyond-token
sso-token
cookie
system-code
```

需要鉴权时，请基于这几个头实现。

### Query 参数继承

如果 `agentSseUrl` 上带有 query string（如 `?tenant=xxx&token=yyy`），网关会把这些参数**原样拼接**到 Card 返回的 `url` 上再发起 RPC 调用。因此你可以在 Card URL 上携带租户、鉴权等上下文，无需在 Card 的 `url` 里重复声明。

## 三、Agent Card（第 1 步响应）

GET 请求需返回一个 JSON 对象，**至少包含 `url` 字段**，指向你的 JSON-RPC 端点：

```json
{
  "name": "我的数字员工",
  "description": "...",
  "url": "https://your-host/a2a/rpc",
  "version": "1.0.0",
  "capabilities": { "streaming": true }
}
```

- `url` 缺失 → 报错 `route.a2a.card.url.missing`。
- 返回非 JSON / HTTP 非 2xx → 报错 `route.a2a.card.fetch.failed` / `route.a2a.card.invalid.json`。

## 四、JSON-RPC 请求（第 2 步）

网关向 `card.url` 发起 POST，请求头：

```
Content-Type: application/json
Accept: text/event-stream
```

请求体为标准 JSON-RPC 2.0：

```json
{
  "jsonrpc": "2.0",
  "id": "<uuid>",
  "method": "message/stream",
  "params": {
    "message": {
      "messageId": "<uuid>",
      "role": "user",
      "kind": "message",
      "contextId": "<uuid>",
      "parts": [
        { "kind": "text", "text": "Here is the conversation history: ..." },
        { "kind": "text", "text": "用户本轮输入" },
        { "kind": "file", "file": { "uri": "https://.../a.pdf", "name": "a.pdf" } }
      ]
    }
  }
}
```

`parts` 数组的组成顺序：

1. **历史上下文**（可选）：当存在多轮历史时，作为第一个 `text` part，格式为
   `Here is the conversation history: \nFor context:\n[user] said: ...\n[assistant] said: ...\n`（最多 10 轮）。
2. **本轮用户文本**：第二个 `text` part。
3. **附件**（可选）：每个文件一个 `file` part，含 `file.uri` 与 `file.name`。

## 五、SSE 响应（第 3 步）

返回 `Content-Type: text/event-stream`。约定：

- **每个 `data:` 行是一个完整的 JSON-RPC 响应**（不要把一个 JSON 拆到多行 `data:`，除非用空行分隔事件）。
- 以**空行**作为一个事件的结束分隔。
- `event:` 行和 `:` 注释行会被忽略。
- 发送 `data: [DONE]` 表示流结束（也可直接关闭连接）。

### 响应体的 kind 映射

网关读取 `result.kind`，映射为内部事件：

| `result.kind` | 取文本来源 | 内部呈现 |
|---------------|-----------|----------|
| `task` | `result.status.message.parts[].text` | 思考过程（reasoning log，contentType `3005`） |
| `message` | `result.parts[].text` | 正文回答（answer，`1002`） |
| `status-update` | `result.status.message.parts[].text` | 正文回答；`state=auth_required` 时为 `4003` |
| `artifact-update` | `result.artifact.parts[].text` | 正文回答（`1002`） |

> 若响应未携带 `kind`，网关会按结构推断：含 `artifact` → `artifact-update`；含 `history` → `task`；含 `status.state` → `status-update`；含 `parts`+`role` → `message`。建议**始终显式带上 `kind`**。

只有 `kind=text` 的 part 会被提取文本，其余 part 忽略。

### 流式正文示例

```
data: {"jsonrpc":"2.0","id":"1","result":{"kind":"status-update","status":{"state":"working"}}}

data: {"jsonrpc":"2.0","id":"1","result":{"kind":"message","role":"agent","parts":[{"kind":"text","text":"你好"}]}}

data: {"jsonrpc":"2.0","id":"1","result":{"kind":"message","role":"agent","parts":[{"kind":"text","text":"，世界"}]}}

data: [DONE]
```

### 错误

在 JSON-RPC 响应里返回 `error` 即可，网关会转成 error 事件：

```json
{ "jsonrpc": "2.0", "id": "1", "error": { "code": -32000, "message": "出错原因" } }
```

## 六、OpenAI Chat Completions 兼容模式

为方便复用已有的 OpenAI 风格服务，网关在解析不出 A2A 结构时，会尝试按 OpenAI 流式 chunk 解析：

```
data: {"choices":[{"index":0,"delta":{"content":"片段"}}]}

data: [DONE]
```

- 只要 `choices[].delta.content` 存在，就作为正文（`1002`）输出。
- chunk 里的 `error` 字段也会被转成错误事件。

即：你既可以走标准 A2A JSON-RPC，也可以直接返回 OpenAI 兼容的 SSE chunk。

## 七、超时与限制

| 项 | 值 |
|----|----|
| 连接超时 | 30s |
| 读超时（流式总时长） | 600s |
| 写超时 | 30s |

请确保你的服务在 600s 内完成整段流式输出，并尽量持续推送以避免读超时。

## 八、接入自查清单

- [ ] 智能体已配置 `createType=FROM_THIRD`、`integrationType=A2A`、`agentSseUrl`
- [ ] `agentSseUrl` GET 可返回包含 `url` 的 Agent Card
- [ ] RPC 端点支持 POST JSON-RPC `message/stream`，返回 `text/event-stream`
- [ ] 鉴权基于透传的 `beyond-token` / `sso-token` / `cookie` / `system-code` 实现
- [ ] 响应每个 `data:` 行是完整 JSON-RPC，并显式带 `kind`
- [ ] 结束时发送 `[DONE]` 或关闭连接
- [ ] 单次会话流式输出在 600s 内完成
