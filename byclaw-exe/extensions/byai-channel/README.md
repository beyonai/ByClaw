# ByAI Channel

OpenClaw 的 Web Channel 插件，支持流式输出配置。

维护该模块前请先阅读 [`MAINTAINER_GUIDE.md`](./MAINTAINER_GUIDE.md)，其中说明 SDK 入站、agent events、hooks、native subagent、delegated work 和业务会话完成判定之间的关系。本 README 主要保留部署、配置和外部接入说明。

## 打包为 dist

和 `baiying-enhance` 一样，`byai-channel` 通过 esbuild 产出可分发的 `dist/index.js`：

```bash
npm install
npm run build
```

`openclaw` 扩展入口为 `./dist/index.js`。

## 运行日志

正常日志保留请求接收、OpenClaw运行、终态写入和异常等关键摘要，Gateway 链路按 `requestId` 检索，`sessionId` / `traceId` 辅助定位；Webhook使用已有 `requestId`。不逐条打印agent event，不打印问题/回答正文、注入的系统提示词、媒体文本或完整Redis配置；消息只记录长度，正常文本去重保持静默。

root lifecycle terminal只表示该OpenClaw run结束，dispatch返回和SDK完成门通过也有各自含义，不能当作前端已收到终态。`channel.final_written` 记录实际 XADD 回复，前端收到及应用由 FE 独立上报，不能互相替代。需要检查完整模型输入时，使用下面默认关闭的Context Snapshot，不在常驻日志中dump正文。

## 配置说明

### 在 openclaw.json 中配置

```json
{
  "channels": {
    "byai-channel": {
      "enabled": true,
      "webhookPath": "/webhook/byai-channel",
      "streamEnabled": true,
      "sessionKeyPerSessionId": false,
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "telemetry": {
        "enabled": true,
        "consoleEnabled": false,
        "redisEnabled": true,
        "logIntervalMs": 30000
      }
    }
  },
  "plugins": {
    "entries": {
      "byai-channel": {
        "enabled": true
      }
    }
  }
}
```

### 配置项说明

| 配置项          | 类型    | 默认值                  | 说明                                      |
| --------------- | ------- | ----------------------- | ----------------------------------------- |
| `enabled`       | boolean | true                    | 是否启用该 channel                        |
| `webhookPath`   | string  | "/webhook/byai-channel" | Webhook 接收消息的路径                    |
| `streamEnabled` | boolean | true                    | 是否启用流式输出                          |
| `sessionKeyPerSessionId` | boolean | false | SDK 入站时是否按 `agent + sessionId` 生成独立 `sessionKey` |
| `dmPolicy`      | string  | "open"                  | 消息策略: open/allowlist/pairing          |
| `allowFrom`     | array   | []                      | 允许发送消息的用户列表，\* 表示允许所有人 |
| `telemetry`     | object  | Redis 开启，console 关闭 | 输出运行态 busy snapshot，供外部 controller 判断是否续期容器 |
| `contextSnapshot.enabled` | boolean | false | 是否在 `llm_input` hook dump 最终模型输入上下文 |
| `contextSnapshot.fileName` | string | `llm_input_snapshots.json` | 写入 `.openclaw/agents/<agentId>/sessions/` 下的 JSON 文件名，每次触发都会覆写 |
| `contextSnapshot.maxStringChars` | number | `200000` | 单个字符串字段最大保留字符数 |
| `contextSnapshot.maxArrayItems` | number | `200` | 单个数组最大保留元素数 |
| `contextSnapshot.includeHistoryMessages` | boolean | true | 是否写入历史消息 |
| `contextSnapshot.includeTools` | boolean | true | 是否写入工具定义 |

### Telemetry 运行态输出

`telemetry` 会监听 agent run、tool call、subagent 和 agent event stream，默认通过 Redis 发布到
`byai_gateway:registry:worker:stats:openclaw`。如需本地日志调试，可显式设置
`consoleEnabled: true` 输出 `[openclaw-busy-state]` JSON 行。该输出只包含运行态计数、原因和 lease 建议，
不会包含 transcript、用户消息正文、工具参数或凭据。

### Context Snapshot

`contextSnapshot` 默认关闭。开启后，插件会在 OpenClaw 的 `llm_input` hook 中捕获即将提交给 LLM 的最终输入快照，并写入当前 agent 的 sessions 目录：

```text
~/.openclaw/agents/<agentId>/sessions/llm_input_snapshots.json
```

对于 main agent，默认路径类似：

```text
~/.openclaw/agents/main/sessions/llm_input_snapshots.json
```

线上如果 `.openclaw/agents/main/sessions` 挂载到 MinIO 卷，同样可以被外部读取。
文件只保留最近一次 `llm_input` 快照，每次触发都会直接覆写，避免历史文件增长和磁盘占用问题。

示例配置：

```json
{
  "channels": {
    "byai-channel": {
      "contextSnapshot": {
        "enabled": true,
        "maxStringChars": 200000,
        "maxArrayItems": 200,
        "includeHistoryMessages": true,
        "includeTools": true
      }
    }
  },
  "plugins": {
    "entries": {
      "byai-channel": {
        "hooks": {
          "allowConversationAccess": true
        }
      }
    }
  }
}
```

文件内容是一个 JSON snapshot，包含：

- `runId`
- `sessionId`
- `sessionKey`
- `agentId`
- `provider` / `model`
- `byai.sessionId`
- `byai.traceId`
- `systemPrompt`
- `prompt`
- `historyMessages`
- `tools`
- `sizes`

## Hook 文件目录约定

`before_prompt_build` 会注入文件路由规则，兼容用户在聊天中的目录说法：

- `会话目录`、`session`、`.session`、`.sessions` 统一指当前会话的 `/.sessions/<sessionId>/`；在沙箱绝对路径中对应 `/by/.sessions/<sessionId>/`。
- `共享目录`、`shared`、`.shared` 统一指 `/.shared/`；在沙箱绝对路径中对应 `/by/.shared/`。
- `.session` 是兼容别名，BE 实际目录名为 `.sessions`。插件会强制禁止误用 `/session`、`/.session`、`/shared` 等平行目录，并要求文件写入后按完整绝对路径复核。

### 与配置热重载协作

SDK 模式下，`ByaiSdkApp` 不缓存启动时传入的 `OpenClawConfig`。每次收到 `AskAgentCommand` 并调用 `deliverReplyToAgentViaSdk` 前，都会通过 `getByaiRuntime().config.current()` 读取当前运行时配置。

这对 `baiying-enhance` 的数字员工模型热切换很关键：百应侧修改数字员工 `prologue.modelId` 后，`baiying-enhance` 会把最新 `agents.list[].model.primary` 与 `models.providers.baiying-m-*` 热写回 OpenClaw；`byai-channel` 后续入站消息会使用热重载后的 agent/model 定义，而不是继续使用 worker 启动时的旧配置。

## Session 单写者与 Takeover 防护

OpenClaw embedded run 在模型 I/O 前会短暂释放 session transcript 写锁，并在重抢锁时校验 `.jsonl` 指纹。若同一 `sessionKey` 上并发触发第二次 `dispatchReplyFromConfig`，可能触发：

`EmbeddedAttemptSessionTakeoverError: session file changed while embedded prompt lock was released`

`byai-channel` 在 SDK 入站路径做了两层防护（仅改本插件，不改 OpenClaw）：

1. **Session 入站闸门**（`session-dispatch-gate.ts`）：同一 `sessionKey` 的 `deliverReplyToAgentViaSdk` 严格 FIFO 串行；后续消息会排队，日志可见 `session dispatch dequeued`。
2. **Lifecycle 收尾等待**（`session-dispatch-settle.ts`）：`dispatchReplyFromConfig` 返回后仍等待 root lifecycle / 子 agent / outbound 完成，再释放闸门，避免“dispatch 已返回但 transcript 仍被占用”时启动下一条入站。
3. **Prompt 注入快照**（`prompt-injection-snapshot.ts`）：在 dispatch 前预构建 `appendSystemContext`，`before_prompt_build` 优先读内存快照，避免在 hook 阶段做额外副作用。

`before_dispatch` 仍负责一次性同步 `USER.md`（写盘）；`before_prompt_build` 只拼接系统上下文，不写 session transcript。

**残余风险**：其他插件若在锁释放窗口写入 transcript 且不被 OpenClaw 视为 benign/owned，仍可能 takeover。本方案保证 **byai-channel 不再主动制造同 session 并发 dispatch**。

## Webhook 接口格式

### 发送消息到 OpenClaw

**请求**

```http
POST /webhook/byai-channel
Content-Type: application/json
Authorization: Bearer <gateway-token>

{
  "requestId": "unique-request-id",
  "sessionId": "session-123",
  "userId": "user-456",
  "message": "你好，请帮我写一段代码",
  "callbackUrl": "http://your-backend.com/api/byai/callback"
}
```

**字段说明**

| 字段          | 必填 | 说明                        |
| ------------- | ---- | --------------------------- |
| `requestId`   | 是   | 请求唯一标识                |
| `sessionId`   | 否   | 会话 ID，默认等于 requestId |
| `userId`      | 否   | 用户 ID，默认 "anonymous"   |
| `message`     | 是   | 用户消息内容                |
| `callbackUrl` | 是   | 回调地址，用于接收 AI 回复  |

**响应**

```json
{
  "ok": true,
  "requestId": "unique-request-id"
}
```

### 回调接口（需实现）

你的后端需要实现一个回调接口，OpenClaw 会通过 POST 请求将 AI 回复推送给你：

```http
POST <callbackUrl>
Content-Type: application/json

{
  "requestId": "unique-request-id",
  "sessionId": "session-123",
  "message": "AI 的回复内容",
  "messageId": "msg-123",
  "done": false
}
```

**回调字段说明**

| 字段        | 说明                                  |
| ----------- | ------------------------------------- |
| `requestId` | 对应请求的 ID                         |
| `sessionId` | 会话 ID                               |
| `message`   | AI 回复内容（流式输出时，分多次推送） |
| `messageId` | 消息 ID                               |
| `done`      | 是否完成，true 表示回复结束           |

## Java 后端接入示例

### 1. 添加依赖 (pom.xml)

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-websocket</artifactId>
    </dependency>
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <optional>true</optional>
    </dependency>
</dependencies>
```

### 2. 配置文件 (application.yml)

```yaml
server:
  port: 8080

byai:
  openclaw:
    gateway-url: http://localhost:18789
    webhook-path: /webhook/byai-channel
    gateway-token: your-gateway-token
```

### 3. 创建配置类

```java
package com.example.byai.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenClawConfig {

    @Value("${byai.openclaw.gateway-url}")
    private String gatewayUrl;

    @Value("${byai.openclaw.webhook-path}")
    private String webhookPath;

    @Value("${byai.openclaw.gateway-token}")
    private String gatewayToken;

    public String getFullWebhookUrl() {
        return gatewayUrl + webhookPath;
    }

    public String getGatewayToken() {
        return gatewayToken;
    }
}
```

### 4. 创建 WebSocket 配置

```java
package com.example.byai.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic", "/queue");
        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws/byai")
                .setAllowedOriginPatterns("*")
                .withSockJS();
    }
}
```

### 5. 创建消息 DTO

```java
package com.example.byai.dto;

import lombok.Data;

@Data
public class ChatRequest {
    private String sessionId;
    private String message;
}

@Data
public class OpenClawRequest {
    private String requestId;
    private String sessionId;
    private String userId;
    private String message;
    private String callbackUrl;
}

@Data
public class OpenClawCallback {
    private String requestId;
    private String sessionId;
    private String message;
    private String messageId;
    private boolean done;
}
```

### 6. 创建服务类

```java
package com.example.byai.service;

import com.example.byai.config.OpenClawConfig;
import com.example.byai.dto.ChatRequest;
import com.example.byai.dto.OpenClawCallback;
import com.example.byai.dto.OpenClawRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Service
@RequiredArgsConstructor
public class ByaiService {

    private final OpenClawConfig openClawConfig;
    private final SimpMessagingTemplate messagingTemplate;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    // 存储活跃的会话
    private final Map<String, SessionContext> activeSessions = new ConcurrentHashMap<>();

    public String sendMessage(ChatRequest request) {
        String requestId = java.util.UUID.randomUUID().toString();
        String callbackUrl = "http://localhost:8080/api/byai/callback";

        // 保存会话上下文
        SessionContext context = new SessionContext();
        context.setRequestId(requestId);
        context.setSessionId(request.getSessionId());
        context.setWebSocketSessionId(request.getSessionId());
        activeSessions.put(request.getSessionId(), context);

        // 构建请求
        OpenClawRequest openClawRequest = new OpenClawRequest();
        openClawRequest.setRequestId(requestId);
        openClawRequest.setSessionId(request.getSessionId());
        openClawRequest.setUserId("user-" + request.getSessionId());
        openClawRequest.setMessage(request.getMessage());
        openClawRequest.setCallbackUrl(callbackUrl);

        try {
            // 发送请求到 OpenClaw
            String url = openClawConfig.getFullWebhookUrl();
            restTemplate.postForObject(url, openClawRequest, Map.class);
            log.info("Sent message to OpenClaw, requestId: {}", requestId);
        } catch (Exception e) {
            log.error("Failed to send message to OpenClaw", e);
            throw new RuntimeException("Failed to send message", e);
        }

        return requestId;
    }

    public void handleCallback(OpenClawCallback callback) {
        log.info("Received callback: requestId={}, done={}", callback.getRequestId(), callback.isDone());

        SessionContext context = activeSessions.get(callback.getSessionId());
        if (context != null) {
            // 通过 WebSocket 推送到前端
            messagingTemplate.convertAndSendToUser(
                context.getWebSocketSessionId(),
                "/queue/messages",
                callback.getMessage()
            );

            if (callback.isDone()) {
                activeSessions.remove(callback.getSessionId());
            }
        }
    }

    @lombok.Data
    private static class SessionContext {
        private String requestId;
        private String sessionId;
        private String webSocketSessionId;
    }
}
```

### 7. 创建 Controller

```java
package com.example.byai.controller;

import com.example.byai.dto.ChatRequest;
import com.example.byai.dto.OpenClawCallback;
import com.example.byai.service.ByaiService;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequiredArgsConstructor
public class ByaiController {

    private final ByaiService byaiService;

    /**
     * WebSocket 消息处理
     */
    @MessageMapping("/chat")
    public void handleChatMessage(@Payload ChatRequest request,
                                   SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        request.setSessionId(sessionId);
        byaiService.sendMessage(request);
    }

    /**
     * HTTP 发送消息（可选）
     */
    @PostMapping("/api/byai/chat")
    public Map<String, String> chat(@RequestBody ChatRequest request) {
        String requestId = byaiService.sendMessage(request);
        return Map.of("requestId", requestId);
    }

    /**
     * OpenClaw 回调接口
     */
    @PostMapping("/api/byai/callback")
    public void handleCallback(@RequestBody OpenClawCallback callback) {
        byaiService.handleCallback(callback);
    }
}
```

### 8. 配置 RestTemplate

```java
package com.example.byai.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

@Configuration
public class RestTemplateConfig {

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}
```

## 前端接入（WebSocket）

### React 示例

```jsx
import { useEffect, useRef, useState } from "react";
import SockJS from "sockjs-client";
import { Client } from "@stomp/stompjs";

function ChatComponent() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const clientRef = useRef(null);

  useEffect(() => {
    // 连接 WebSocket
    const client = new Client({
      webSocketFactory: () => new SockJS("http://localhost:8080/ws/byai"),
      onConnect: () => {
        setConnected(true);
        // 订阅个人消息队列
        client.subscribe("/user/queue/messages", (message) => {
          const content = message.body;
          setMessages((prev) => [...prev, { role: "assistant", content }]);
        });
      },
      onDisconnect: () => {
        setConnected(false);
      },
    });

    client.activate();
    clientRef.current = client;

    return () => {
      client.deactivate();
    };
  }, []);

  const sendMessage = () => {
    if (!input.trim()) return;

    setMessages((prev) => [...prev, { role: "user", content: input }]);

    // 通过 WebSocket 发送消息
    clientRef.current.publish({
      destination: "/app/chat",
      body: JSON.stringify({ message: input }),
    });

    setInput("");
  };

  return (
    <div>
      <div>
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role}>
            {msg.content}
          </div>
        ))}
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={(e) => e.key === "Enter" && sendMessage()}
      />
      <button onClick={sendMessage} disabled={!connected}>
        发送
      </button>
    </div>
  );
}

export default ChatComponent;
```

## 完整流程图

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│   前端      │     │   Java 后端     │     │   OpenClaw  │
│  (React)   │     │  (SpringBoot)   │     │  (Gateway)  │
└─────┬───────┘     └────────┬────────┘     └──────┬───────┘
      │                       │                    │
      │  1. WebSocket 发送消息 │                    │
      │──────────────────────>│                    │
      │                       │                    │
      │                       │  2. HTTP POST       │
      │                       │  (转发到 webhook)  │
      │                       │───────────────────>│
      │                       │                    │
      │                       │                    │  3. 处理消息
      │                       │                    │  (调用 AI)
      │                       │                    │
      │                       │  4. POST 回调      │
      │                       │<───────────────────│
      │                       │                    │
      │  5. WebSocket 推送    │                    │
      │<──────────────────────│                    │
      │                       │                    │
      │        ... (流式输出重复步骤 4-5) ...       │
      │                       │                    │
      │                       │  6. done=true     │
      │                       │<───────────────────│
      │  7. 完成              │                    │
      │<──────────────────────│                    │
```

## 注意事项

1. **callbackUrl 必须可访问**: OpenClaw 需要能访问到你配置的回调地址
2. **流式输出**: 当 `streamEnabled: true` 时，AI 的回复会分多次推送，每次推送 `done: false`，最后一条 `done: true`
3. **Session 管理**: 建议在服务端维护 session 映射关系
4. **安全**: 生产环境请添加适当的认证和授权机制

关键链路日志使用 `chat_chain` 标记和 metadata 中的 `requestId`：worker 接收、OpenClaw dispatch/lifecycle、终态 XADD 实际回复。终态写入日志观察 SDK 原有 pipeline，不改变命令、返回值或异常；pipeline 单命令错误会记录 failed，但保留 SDK 原有处理语义。完整排查说明见仓库 `docs/architecture/chat-request-logging-implementation.md`。

## 上下文溢出自动恢复

SDK 会话在发送前上下文溢出，或必需的原生压缩超时后，可额外恢复最多 **3 次**。触发事实包括明确的 `(precheck)`、`Preflight compaction required but failed` 超时，以及关联当前 dispatch 的根 lifecycle / `isError` 回复载荷中的溢出。`memory_flush_failed` 不代表压缩失败，不单独触发恢复。普通网络错误、鉴权错误和明确的 mid-turn precheck 不触发重放；已执行工具或输出正文的业务也不重放。

每次恢复先提示“正在自动压缩上下文（第 N/3 次恢复）”，在同一会话的 dispatch lease 内调用公开的 `sessions.compact` 语义摘要接口（不传 `maxLines`）。仅在 `ok=true && compacted=true`、且有效的 token 统计未显示压缩无效时，重发原问题和附件。`tokensBefore=0` 表示缺少压缩前用量样本，不据此认定压缩变大。最后由 OpenClaw 的发送前检查校验系统提示、工具定义、保留历史、新问题及输出预留是否满足对话模型窗口；若仍是预检查溢出，进入下一次恢复。没有可压缩历史、鉴权拒绝等明确无效的失败提前结束，不必耗满 3 次。

只在实际观察到原生压缩或发送前失败后启动恢复计时。原生压缩等待使用运行时 `compaction.timeoutSeconds` 加 30 秒收尾宽限，并受从首次观测起 10 分钟的恢复预算约束；中止后再等待原 dispatch 真正退出，最多 30 秒。没有退出就结束本地等待并保留操作保护，不能开始第二个压缩。该预算限制恢复操作，不限制恢复成功后的正常工具执行或长回答；用户取消立即停止等待和后续重发。

压缩 RPC 超时或连接断开属于结果不确定。插件不启动第二次压缩或重发，并按实际 OpenClaw `sessionKey` 阻止后续请求与旧操作重叠。仍在等待的原调用明确返回后自动解锁；如果 RPC 已拒绝且无法确认服务端终态，则不按固定时间自动解锁，须由管理员确认后台操作已结束后重启执行进程。热重载插件不会清除保护。此保护为进程内状态，不代替跨进程会话路由/串行化；新建百应对话也须映射到不同 OpenClaw session 才能绕开原会话。普通会话只增加内存查表，不轮询网关、不读取历史；新压缩的保护记录最多 256 条，取消时已在运行的原生操作仍须保留保护。

恢复期间保持 SDK 完成门关闭；无业务在途的失败由 SDK 统一结束，不再空等不存在的恢复事件。已有子任务、委派任务、模型回退及输出截断续写仍遵守原有完成条件。旧 dispatch 的迟到回调不会清理新请求。

用户错误统一通过 `context-errors.ts` 转换，覆盖 lifecycle、agent_end、SDK error metadata 和抛给任务框架的异常。原始错误只留服务端诊断，不用匹配普通正文的方式误改助手对错误文本的讨论。终态建议为：

- 恢复失败：“本次对话内容整理未能完成，暂时无法继续回答。历史记录已保留。建议新建对话后重新提问；如果问题依赖之前的讨论，请补充必要的背景和关键条件。”
- 有明确本次输入/附件过大证据：“本次提交内容过多，请减少附件或拆分问题后重试。可以先提交一个问题、一个附件或相关章节，其余内容分次提供。”普通历史超限不能归入此类。
- 后台操作尚未确认结束：告知暂时无法继续，建议稍后重试或新建对话，持续出现时联系管理员；保留原历史。

国际化沿用 channel 现有的 `zh_CN` / `en_US` 文案和语言解析：优先非空 `LANG`，否则使用 `metadata.language`，缺省/不支持的语言回退中文。恢复第 1～3 次、重发、三种失败建议及会话保护分支均传递解析后的语言。SDK error metadata 和抛给 framework 的公开异常仅显示对应语言的文案，不附加 `ByaiContextError:` 技术前缀；错误分类仍使用稳定的 code/kind。

本次只调整百应插件，没有修改 OpenClaw 源码、直接改写 transcript 或引入自定义压缩引擎。D0.4.2 已有的模型窗口同步、适用模型的思考参数及压缩超时配置继续生效。压缩仍由原生引擎执行：上述保护不能保证持续过慢或不可用的模型恢复成功，也不凭空扩大模型上下文窗口。

运行环境须提供 OpenClaw 2026.7.1 的公共 `sessions.compact` 接口。Redis worker 不处于网关请求上下文，或进程内官方插件信任门在派发前明确拒绝百应插件时，通过公开 `callGatewayFromCli` 使用宿主现有网关连接和鉴权配置。恢复统计记录次数、耗时和 token 数，并保留错误诊断；不额外记录问题、摘要或凭据。

### 验证状态与验收范围

2026-09-22 本地最终回归：`npm run build` 通过；channel 完整套件 364 项，359 项通过。其余 5 项在未修改的 D0.4.2 `187b739a5` 上复现：answer-text-ledger 1 项、remote-task-watch.batch 1 项、session-context.overflow 3 项，本次没有新增失败。中英文进度、失败建议、语言透传及 SDK 错误输出等 8 个定向套件共 98 项全部通过。

回归同时覆盖取消、串行化、子任务和委派，以及原生压缩卡住后安全退出、后台未退出时禁止重入、错误仅经回复载荷返回、压缩后正常长回答不被误中断、重放时发现本次附件过大仍保留对应建议。本轮仅验证本地代码，尚未部署或改动线上配置。

以下为 2026-09-21 的既有隔离环境验收记录，不能替代上述新代码的线上验收：

当前状态为**分项验证通过，真实环境完整成功链路待验收**。OpenClaw 2026.7.1 与 `qwen3-max` 的隔离沙箱已验证：溢出后依次提示第 1/3、2/3、3/3 次恢复，明确压缩失败后只结束一次请求；另一个虚构历史会话通过真实 `sessions.compact` 生成摘要，压缩后的续问仍正确返回历史中的项目编号和负责人标识。测试仅使用虚构内容。

三次恢复用例的本次问题本身超过窗口，且没有可压缩历史，因此验证的是失败分支，没有实际重发问题。独立的语义压缩和压缩后续问成功，也不能替代“历史过大 → 溢出 → 自动压缩成功 → 自动重发原问题 → 正常答案”的端到端证明。该完整成功分支及原问题、附件、业务标识的保留目前由集成测试覆盖；发布验收仍须使用与故障场景一致的模型、受控超长历史及普通短问题验证，并核对原压缩超时场景是否改善。

定向测试覆盖恢复上限、取消、未知 RPC 结果不重入、有工具执行或正文输出时禁止重放、迟到旧 run 排除、公开网关传输兼容和缺失 token 样本。本轮未完成原线上同模型长会话的完整验收，也未发布新执行镜像。两个插件需一起构建发布；临时沙箱加载测试包不代表正式环境已更新。
