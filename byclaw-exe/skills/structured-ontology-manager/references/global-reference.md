# 全局参数、认证、输出格式

## 环境变量

以下变量由运行环境（容器 / `.env` 文件）自动注入，Skill 脚本直接读取，无需额外配置。

| 变量 | 用途 | 示例值 |
|------|------|--------|
| `BEYOND_TOKEN` | 门户服务 API 认证 Token | `eyJhbGci...` |
| `USER_CODE` | 当前用户编码 | `adminvip` |
| `BEYOND_SESSION` | 会话 ID | `uuid-xxx` |
| `OPENCLAW_GATEWAY_TOKEN` | SQLite 服务认证 | `ztesoft` |
| `BE_DOMAINNAME` | 门户服务名称（服务发现） | `ByaiService` |
| `REDIS_HOST` | 服务发现 Redis 主机 | `10.10.168.203` |
| `REDIS_PORT` | 服务发现 Redis 端口 | `6379` |
| `REDIS_DATABASE` | 服务发现 Redis DB | `0` |
| `REDIS_PASSWORD` | 服务发现 Redis 密码 | `admin123` |
| `REDIS_USERNAME` | 服务发现 Redis 用户名 | `default` |
| `ONTOLOGY_STORE` | 暂存后端：`redis`（默认）或 `local` | `redis` |
| `ONTOLOGY_WORKSPACE_DIR` | 本地暂存目录（`ONTOLOGY_STORE=local` 时用） | `~/.ontology_workspace` |

> SQLite 服务名不是固定值，而是按用户动态拼接：`BYCLAW_EXE_{USER_CODE}`（如 `BYCLAW_EXE_adminvip`），由 `table_manager.py` 内部自动构造，无需额外配置。

> `DATACLOUD_GATEWAY_REDIS_*` 变量仅供 `model_environment.py` 内部读取模型配置使用，与服务发现无关，Skill 层无需关心。

## 认证方式

所有门户服务请求通过 `Beyond-Token` Header 传递认证 Token，从 `BEYOND_TOKEN` 环境变量读取。

## 服务发现机制

服务发现基于 `by_framework`：
1. `init_redis(REDIS_HOST, REDIS_PORT, ...)` 全局初始化一次
2. `DiscoveryClient(cache_interval=5)` 从 Redis 获取服务实例列表
3. `DiscoveryHttpClient` 按服务名路由请求，自动重试（502/503/504）

## 输出格式

所有脚本统一输出 JSON 到 stdout：

```json
// 成功
{"ok": true, "data": [...]}

// 失败
{"ok": false, "error": "错误描述", "missing": ["缺失字段"]}
```

## session_id 说明

- 多用户场景：`session_id` 来自 Agent 上下文（`BEYOND_SESSION` 或 function 参数中的 `sessionId`）
- 同一用户的多轮对话必须传相同的 `session_id`，否则暂存状态无法关联
- 本地开发（`ONTOLOGY_STORE=local`）：`session_id` 可省略，key 退化为 `entity_code`
