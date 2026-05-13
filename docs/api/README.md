# API 文档

本文档介绍 ByClaw 的 API 接口。

## API 概述

ByClaw 提供以下类型的 API：

- **REST API** - 标准的 HTTP API 接口
- **WebSocket API** - 实时通信接口（对话流式响应）

## 基础信息

| 项目 | 说明 |
|------|------|
| 基础 URL | `http://localhost:8086` (开发环境) |
| 协议 | HTTP/HTTPS |
| 数据格式 | JSON |
| 字符编码 | UTF-8 |

## 认证方式

ByClaw 使用 JWT (JSON Web Token) 进行认证。

详细说明请参考 [认证文档](./authentication.md)。

## 快速开始

### 1. 获取 Token

```bash
curl -X POST http://localhost:8086/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your_password"
  }'
```

响应：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 7200
  }
}
```

### 2. 调用 API

```bash
curl -X GET http://localhost:8086/api/user/info \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

### 3. WebSocket 连接

```javascript
const ws = new WebSocket('ws://localhost:8082/ws/chat?token=YOUR_TOKEN');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'chat',
    content: '你好'
  }));
};

ws.onmessage = (event) => {
  console.log('收到消息:', event.data);
};
```

## 接口分类

| 分类 | 说明 | 路径前缀 |
|------|------|---------|
| 认证 | 登录、登出、刷新 Token | `/api/auth/*` |
| 用户 | 用户信息、权限 | `/api/user/*` |
| 对话 | 会话管理、消息 | `/api/chat/*` |
| 知识库 | 知识库、文档管理 | `/api/knowledge/*` |
| 数字员工 | Agent 管理 | `/api/agent/*` |
| 文件 | 文件上传下载 | `/api/file/*` |
| 系统 | 配置、健康检查 | `/api/system/*` |

## 详细文档

- [认证授权](./authentication.md) - JWT 认证流程详解
- [WebSocket 通信](./websocket.md) - 实时对话接口

## OpenAPI/Swagger

开发环境启动后，可访问 Swagger UI：

```
http://localhost:8086/swagger-ui.html
```

或获取 OpenAPI JSON：

```
http://localhost:8086/v3/api-docs
```

## 错误码

| 错误码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

## SDK

目前提供以下 SDK：

- [Java SDK](../development/backend/) (内部使用)
- Python SDK (规划中)
- JavaScript SDK (规划中)

## 注意事项

1. 所有请求都需要携带有效的 Token（除登录等开放接口外）
2. Token 过期后需要使用 Refresh Token 刷新
3. WebSocket 连接需要先获取 Token 后在 URL 中传递
4. 文件上传有大小限制，请参考具体接口文档
