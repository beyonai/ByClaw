# Byclaw SQLite

本地 OpenClaw 开发插件，只暴露一个统一能力：`sqlExecute`。

它同时提供两种调用入口：

- OpenClaw 工具：通过 Gateway 的 `POST /tools/invoke`
- 直接 HTTP 路由：`POST /plugins/byclaw-sqlite/sqlExecute`

两种入口都会复用同一套 SQLite 执行服务。默认数据库路径为
`$OPENCLAW_STATE_DIR/memory/byclaw.sqlite`；未设置 `OPENCLAW_STATE_DIR` 时使用
`~/.openclaw/memory/byclaw.sqlite`。显式配置 `dbPath` 时，绝对路径直接使用，相对路径按插件目录解析。

## 请求体

```json
{
  "sql": "select name from sqlite_master where type = ?",
  "params": ["table"],
  "mode": "all",
  "maxRows": 50
}
```

字段说明：

- `sql`: 必填，单条 SQL 语句
- `params`: 可选，支持数组参数或命名参数对象
- `mode`: 可选，`auto | all | get | run`
- `maxRows`: 可选，本次请求允许返回的最大行数，最终会受插件全局 `maxRows` 限制

## 直接 HTTP 调用

```bash
curl -sS http://127.0.0.1:18789/plugins/byclaw-sqlite/sqlExecute \
  -H 'Authorization: Bearer dev' \
  -H 'Content-Type: application/json' \
  -d '{
    "sql": "select name from sqlite_master order by name"
  }'
```

## 通过工具调用

```bash
curl -sS http://127.0.0.1:18789/tools/invoke \
  -H 'Authorization: Bearer dev' \
  -H 'Content-Type: application/json' \
  -d '{
    "tool": "sqlExecute",
    "args": {
      "sql": "select name from sqlite_master order by name"
    }
  }'
```
