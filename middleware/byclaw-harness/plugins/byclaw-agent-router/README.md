# byclaw-agent-router

运行时默认输出 INFO 日志，无需额外开关。搜索 `[byclaw-agent-router]`，用同一个 `requestId` 关联 `jev_request`（完整路由请求参数）、`jev_response`（校验后的选择、置信度、概率和用量）及 `decision`（最终员工／专家组 ID、名称、类型，或未委派原因）。`startup` 显示启用状态、Gateway 入口、JEV 模型及 key 是否配置；`skipped` 显示关闭、空任务或无候选。日志包含任务正文与候选描述，不包含 Gateway key、鉴权头或未经校验的上游错误正文。

`@byclaw/byclaw-agent-router` 根据用户意图，从调用方提供的授权数字员工和专家组中选择执行目标。超级助手先调用 `byclaw_route_task(task)`，integration 将最新授权候选交给 Jev，返回选中的 `template_id`；再由超级助手调用 `byclaw_instantiate_template(template_id, task)` 启动员工。启动工具只校验先前选择，不再调用 Jev、不替换目标。选择绑定当前 Agent 和相同任务，只能使用一次；重新选人替换上一次选择，失败则清除旧选择，重启后需重新选人。缺少选择、修改任务或 ID 不匹配时拒绝启动。超级助手指 ByClaw 默认主助手会话，或员工编码为 `${USER_CODE}_main` 的根会话，身份来自宿主绑定，不按显示名称或任务文本判断。其通用委派工具不能绕过选人；直接选中的普通数字员工、专家组及子 agent 保留既有协作流程，不强制调用 Jev。网页员工预设、入站指定员工和重启恢复均使用同一身份规则。

```sh
BYCLAW_AGENT_ROUTER_ENABLED=true
BYCLAW_JEV_API_KEY=<Vercel AI Gateway key>
BYCLAW_JEV_BASE_URL=https://ai-gateway.vercel.sh/typesafe
BYCLAW_JEV_MODEL=typesafe-ai/jev
BYCLAW_JEV_TIMEOUT_MS=15000
```

连接配置与 `byclaw-model-router` 共用 `@byclaw/jev-client`；可用 `AI_GATEWAY_API_KEY` 代替专用 key。模型协议为 TypeSafe-compatible Choice，实际请求路径为 `/typesafe/v1/systemone`。不再读取 `TYPESAFE_API_KEY`。路由开关仅使用 `BYCLAW_AGENT_ROUTER_ENABLED`。修改环境变量后重启 Worker。默认关闭。

只发送自包含任务和候选名称、能力描述；不发送整个会话或生成模型凭据。key 缺失、API 失败、超时或非法选择时拒绝启动员工，由父 agent 澄清、报告阻塞或重试，不接管复杂任务。显式入站员工和专家团内部权限继续由 integration 校验。模型选择及模型失败回退属于 `byclaw-model-router`。

官方入口说明：https://vercel.com/changelog/ai-gateway-now-supports-typesafe-clients-and-http-api-for-jev

验证：`node --test plugins/byclaw-agent-router/tests/*.test.js`。

选人工具使用简洁中文描述，明确“只选人、不启动、同一任务、每次重新选择”的新调用协议；这是面向中文业务的描述调整，不表示平台兼容性已验证。
