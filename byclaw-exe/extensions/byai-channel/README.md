# ByAI Channel

OpenClaw 的 Web Channel 插件，支持流式输出配置。

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
      "allowFrom": ["*"]
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
