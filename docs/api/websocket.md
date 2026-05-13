# WebSocket 通信

本文档介绍 ByClaw 的 WebSocket 实时通信接口。

## 概述

WebSocket 用于实时对话场景，支持：

- 流式消息接收（逐字显示）
- 实时状态更新
- 多人在线协作

## 连接地址

```
ws://localhost:8082/ws/chat
```

生产环境使用 WSS：

```
wss://your-domain.com/ws/chat
```

## 认证

WebSocket 连接需要在 URL 中携带 Token：

```
ws://localhost:8082/ws/chat?token=YOUR_JWT_TOKEN
```

## 消息协议

### 消息格式

所有消息使用 JSON 格式：

```json
{
  "type": "message_type",
  "data": {}
}
```

### 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| chat | C→S | 发送聊天消息 |
| stream | S→C | 流式响应（内容块） |
| error | S→C | 错误消息 |
| ping | 双向 | 心跳检测 |
| pong | 双向 | 心跳响应 |

## 对话流程

```
客户端                    服务端
   │                        │
   │────── connect ────────▶│
   │                        │
   │◀──── connected ────────│
   │                        │
   │───── chat msg ────────▶│
   │                        │──▶ AI 模型
   │                        │
   │◀───── stream 1 ────────│
   │◀───── stream 2 ────────│
   │◀───── stream N ────────│
   │                        │
   │◀───── stream end ──────│
```

## 消息详情

### 发送消息 (chat)

**客户端 → 服务端：**

```json
{
  "type": "chat",
  "data": {
    "sessionId": "session_123",
    "content": "你好，请介绍一下自己",
    "knowledgeBaseIds": ["kb_1", "kb_2"],
    "model": "gpt-4",
    "temperature": 0.7
  }
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| sessionId | string | 是 | 会话 ID |
| content | string | 是 | 消息内容 |
| knowledgeBaseIds | array | 否 | 关联的知识库 |
| model | string | 否 | 使用的模型 |
| temperature | number | 否 | 温度参数 (0-2) |

### 流式响应 (stream)

**服务端 → 客户端：**

```json
{
  "type": "stream",
  "data": {
    "sessionId": "session_123",
    "messageId": "msg_456",
    "content": "你好",
    "isEnd": false,
    "timestamp": 1704067200000
  }
}
```

**结束标记：**

```json
{
  "type": "stream",
  "data": {
    "sessionId": "session_123",
    "messageId": "msg_456",
    "content": "",
    "isEnd": true,
    "usage": {
      "promptTokens": 10,
      "completionTokens": 100,
      "totalTokens": 110
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| sessionId | string | 会话 ID |
| messageId | string | 消息 ID |
| content | string | 当前块的内容 |
| isEnd | boolean | 是否为最后一块 |
| usage | object | Token 使用情况 |

### 错误消息 (error)

```json
{
  "type": "error",
  "data": {
    "code": 5001,
    "message": "AI 服务暂时不可用",
    "sessionId": "session_123"
  }
}
```

| 错误码 | 说明 |
|--------|------|
| 4001 | 消息格式错误 |
| 4002 | 参数缺失 |
| 4010 | Token 无效或过期 |
| 5001 | AI 服务错误 |
| 5002 | 知识库检索错误 |

### 心跳检测

保持连接活跃：

**客户端发送：**

```json
{
  "type": "ping",
  "data": {
    "timestamp": 1704067200000
  }
}
```

**服务端响应：**

```json
{
  "type": "pong",
  "data": {
    "timestamp": 1704067200000
  }
}
```

建议每 30 秒发送一次心跳。

## 代码示例

### JavaScript

```javascript
class ChatWebSocket {
  constructor(url, token) {
    this.ws = new WebSocket(`${url}?token=${token}`);
    this.messageCallbacks = [];
    
    this.ws.onopen = () => {
      console.log('WebSocket 已连接');
      this.startHeartbeat();
    };
    
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handleMessage(msg);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket 错误:', error);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket 已关闭');
      this.stopHeartbeat();
    };
  }
  
  handleMessage(msg) {
    switch (msg.type) {
      case 'stream':
        this.messageCallbacks.forEach(cb => cb(msg.data));
        break;
      case 'error':
        console.error('收到错误:', msg.data);
        break;
      case 'pong':
        // 心跳响应，无需处理
        break;
    }
  }
  
  sendMessage(content, sessionId, options = {}) {
    const msg = {
      type: 'chat',
      data: {
        sessionId,
        content,
        ...options
      }
    };
    this.ws.send(JSON.stringify(msg));
  }
  
  onMessage(callback) {
    this.messageCallbacks.push(callback);
  }
  
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.ws.send(JSON.stringify({
        type: 'ping',
        data: { timestamp: Date.now() }
      }));
    }, 30000);
  }
  
  stopHeartbeat() {
    clearInterval(this.heartbeatInterval);
  }
  
  close() {
    this.ws.close();
  }
}

// 使用示例
const chat = new ChatWebSocket('ws://localhost:8082/ws/chat', token);

chat.onMessage((data) => {
  if (data.isEnd) {
    console.log('消息完成');
  } else {
    console.log('收到内容:', data.content);
  }
});

chat.sendMessage('你好', 'session_123', {
  knowledgeBaseIds: ['kb_1']
});
```

### Python

```python
import asyncio
import json
import websockets

class ChatWebSocket:
    def __init__(self, url: str, token: str):
        self.url = f"{url}?token={token}"
        self.ws = None
        self.message_handlers = []
    
    async def connect(self):
        self.ws = await websockets.connect(self.url)
        asyncio.create_task(self.receive_loop())
        asyncio.create_task(self.heartbeat_loop())
    
    async def receive_loop(self):
        async for message in self.ws:
            msg = json.loads(message)
            await self.handle_message(msg)
    
    async def handle_message(self, msg):
        msg_type = msg.get('type')
        data = msg.get('data')
        
        if msg_type == 'stream':
            for handler in self.message_handlers:
                await handler(data)
        elif msg_type == 'error':
            print(f"Error: {data}")
    
    async def send_message(self, content: str, session_id: str, **options):
        msg = {
            'type': 'chat',
            'data': {
                'sessionId': session_id,
                'content': content,
                **options
            }
        }
        await self.ws.send(json.dumps(msg))
    
    async def heartbeat_loop(self):
        while True:
            await asyncio.sleep(30)
            await self.ws.send(json.dumps({
                'type': 'ping',
                'data': {'timestamp': asyncio.get_event_loop().time()}
            }))
    
    def on_message(self, handler):
        self.message_handlers.append(handler)
    
    async def close(self):
        await self.ws.close()

# 使用示例
async def main():
    chat = ChatWebSocket('ws://localhost:8082/ws/chat', 'your_token')
    await chat.connect()
    
    async def on_message(data):
        if data.get('isEnd'):
            print('消息完成')
        else:
            print(f"收到: {data.get('content')}")
    
    chat.on_message(on_message)
    await chat.send_message('你好', 'session_123')
    
    # 保持运行
    await asyncio.sleep(60)
    await chat.close()

asyncio.run(main())
```

## 注意事项

1. **自动重连** - 连接断开后应实现自动重连机制
2. **消息顺序** - 流式消息按顺序到达，但需要客户端按序拼接
3. **错误处理** - 妥善处理各种错误情况
4. **资源释放** - 页面关闭或切换时主动关闭 WebSocket
5. **心跳保活** - 定期发送心跳防止连接被中间件断开
