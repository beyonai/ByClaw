# 认证授权

本文档详细介绍 ByClaw 的认证机制。

## 认证流程

```
┌─────────┐     用户名/密码      ┌─────────┐
│  客户端  │ ─────────────────▶ │  服务端  │
└─────────┘                     └────┬────┘
                                     │
                                     ▼ 验证凭据
                               ┌─────────┐
                               │ 生成 JWT │
                               └────┬────┘
                                     │
    Token ◀─────────────────────────┘
┌─────────┐
│  客户端  │
└─────────┘
```

## JWT Token 结构

ByClaw 使用 JWT (JSON Web Token) 进行认证，包含两个 Token：

- **Access Token** - 访问令牌，有效期较短（默认 2 小时）
- **Refresh Token** - 刷新令牌，有效期较长（默认 7 天）

### Token 载荷

```json
{
  "sub": "user_id",
  "username": "admin",
  "role": "admin",
  "iat": 1704067200,
  "exp": 1704074400
}
```

| 字段 | 说明 |
|------|------|
| sub | 用户 ID |
| username | 用户名 |
| role | 用户角色 |
| iat | 签发时间 |
| exp | 过期时间 |

## 认证接口

### 登录

```http
POST /api/auth/login
Content-Type: application/json
```

**请求体：**

```json
{
  "username": "admin",
  "password": "your_password",
  "captcha": "1234",
  "captchaKey": "uuid"
}
```

**响应：**

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 7200,
    "tokenType": "Bearer"
  }
}
```

### 刷新 Token

```http
POST /api/auth/refresh
Content-Type: application/json
```

**请求体：**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**响应：**

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

### 登出

```http
POST /api/auth/logout
Authorization: Bearer {token}
```

**响应：**

```json
{
  "code": 200,
  "message": "success"
}
```

### 获取验证码

```http
GET /api/auth/captcha
```

**响应：**

```json
{
  "code": 200,
  "data": {
    "captchaKey": "uuid",
    "captchaImage": "data:image/png;base64,..."
  }
}
```

## 使用 Token

### 在请求头中携带

```http
GET /api/user/info
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### 代码示例

#### cURL

```bash
curl -X GET http://localhost:8086/api/user/info \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### JavaScript

```javascript
fetch('http://localhost:8086/api/user/info', {
  headers: {
    'Authorization': 'Bearer ' + token
  }
});
```

#### Python

```python
import requests

headers = {
    'Authorization': f'Bearer {token}'
}

response = requests.get(
    'http://localhost:8086/api/user/info',
    headers=headers
)
```

#### Java

```java
HttpClient client = HttpClient.newHttpClient();

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("http://localhost:8086/api/user/info"))
    .header("Authorization", "Bearer " + token)
    .build();

HttpResponse<String> response = client.send(request, 
    HttpResponse.BodyHandlers.ofString());
```

## Token 刷新策略

### 前端自动刷新

```javascript
// 请求拦截器
axios.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config;
    
    // Token 过期
    if (error.response.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      // 刷新 Token
      const refreshToken = localStorage.getItem('refreshToken');
      const response = await axios.post('/api/auth/refresh', {
        refreshToken
      });
      
      // 更新 Token
      const { token } = response.data.data;
      localStorage.setItem('token', token);
      
      // 重试原请求
      originalRequest.headers['Authorization'] = 'Bearer ' + token;
      return axios(originalRequest);
    }
    
    return Promise.reject(error);
  }
);
```

## 权限控制

ByClaw 使用 RBAC (Role-Based Access Control) 权限模型。

### 角色定义

| 角色 | 权限 |
|------|------|
| admin | 系统管理员，所有权限 |
| user | 普通用户，基础功能 |
| guest | 访客，只读权限 |

### 接口权限

```java
@PreAuthorize("hasRole('admin')")
@GetMapping("/admin/users")
public Result<List<UserVO>> getAllUsers() {
    // 只有管理员可访问
}

@PreAuthorize("hasAnyRole('admin', 'user')")
@GetMapping("/knowledge/list")
public Result<List<KnowledgeVO>> getKnowledgeList() {
    // 管理员和普通用户可访问
}
```

### 数据权限

通过注解控制数据访问范围：

```java
@DataScope(deptAlias = "d", userAlias = "u")
public List<User> selectUserList(User user) {
    // 根据用户数据权限返回数据
}
```

## 安全建议

1. **HTTPS** - 生产环境必须使用 HTTPS
2. **Token 存储** - 避免存储在 LocalStorage，考虑使用 HttpOnly Cookie
3. **Token 过期** - 设置合理的过期时间
4. **并发登录** - 限制同一账号的并发登录数
5. **登录失败** - 实现登录失败锁定机制

## 常见问题

**Q: Token 过期了怎么办？**

A: 使用 Refresh Token 调用 `/api/auth/refresh` 获取新的 Access Token。

**Q: Refresh Token 也过期了怎么办？**

A: 需要重新登录获取新的 Token 对。

**Q: 如何安全地存储 Token？**

A: 
- Access Token 存储在内存中
- Refresh Token 存储在 HttpOnly Cookie 中
- 或者两者都存储在内存中，页面刷新时重新登录
