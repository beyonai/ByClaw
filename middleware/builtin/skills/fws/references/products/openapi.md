# 原生 OpenAPI

当现有 `lark-cli <service> +shortcut` 和 API Commands 都不能覆盖需求时，使用 `lark-cli api` 调用飞书原生 OpenAPI。

## 使用边界

先确认现有命令不可用：

```bash
lark-cli <service> --help
lark-cli schema --format json
```

只有确实没有合适命令时，才查官方 OpenAPI 文档并用 raw API。仍然禁止 `curl` 或手写 HTTP 客户端；调用必须通过 `lark-cli api`。

## 文档入口

| 品牌 | 入口 |
|------|------|
| 飞书 | `https://open.feishu.cn/llms.txt` |
| Lark | `https://open.larksuite.com/llms.txt` |

默认使用飞书中文文档；用户明确是海外 Lark 租户时用 Lark 文档。

## 调用流程

1. 通过 `lark-cli <service> --help` 确认 shortcut/API command 不覆盖。
2. 查询官方文档入口，定位模块和具体 API。
3. 提取 HTTP 方法、路径、路径参数、query、body、响应字段、scope 和错误码。
4. 需要 user scope 时先走授权；bot scope 让用户去开发者后台开通。
5. 用 `lark-cli api` 调用。

```bash
# GET
lark-cli api GET /open-apis/calendar/v4/calendars --format json

# POST
lark-cli api POST /open-apis/im/v1/messages \
  --params '{"receive_id_type":"open_id"}' \
  --data '{"receive_id":"ou_xxx","msg_type":"text","content":"{\"text\":\"Hello\"}"}' \
  --as bot --format json
```

## 安全规则

- POST/PUT/PATCH/DELETE 前确认用户意图；删除、撤回、权限变更等高风险操作必须明确确认。
- 不猜 API 路径和参数；必须来自官方文档或 `schema`。
- 调用失败时输出完整错误，不要自行换 API 碰运气。
