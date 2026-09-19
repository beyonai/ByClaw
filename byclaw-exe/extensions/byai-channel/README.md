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
