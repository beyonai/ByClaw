# byclaw-super 业务源码

该目录相当于普通项目的 `src/`，保存 Fastify HTTP 层和 Composition Root。它不是独立
workspace package，不包含 `package.json`、独立依赖或独立 `.env`。

所有命令和环境配置都位于项目根目录：

```bash
cp .env.example .env
pnpm dev
```

应用启动时装配内存存储、Pi Leader、Connector Registry、OpenClaw Connector，以及
位于 `worker/` 的 by-framework 入站 Worker。Worker 属于业务入口，不属于 Connector 包。

## API

- `POST /v1/runs`
- `GET /v1/runs/:runId/events`
- `GET /health`
- `GET /ready`

除 HTTP 外，应用默认把 `BYCLAW_WORKER_AGENT_TYPE`（缺省 `BY_MAESTRO`）注册到
by-framework。AskAgent 会进入与 HTTP 相同的 Token、Agent Catalog 和 Run 创建链路；
Resume 只完成子 Agent 回调，不会创建重复 Run。设置 `BYCLAW_WORKER_ENABLED=false` 可关闭。

Run 创建请求体只包含 `message`，返回 `202` 并在后台执行。创建与订阅请求都必须
携带 `Beyond-Token`。
SSE 支持 `Last-Event-ID` 回放，连接断开不会取消任务。
对外流式事件使用 ByClaw 的 `reasoningLog*`、`answer*` 和 `appStreamResponse` 格式。

## 安全边界

- `userCode` 从验签后的 Token 中读取，不接受请求体覆盖；
- Agent 列表由 ByClaw BE `discover` 接口提供，只保留 `usesPermissions=true` 的记录；
- ByClaw BE 地址优先读取 Redis `byai_gateway:sd:instances:ByaiService`，没有有效实例时回退 `BYCLAW_BE_BASE_URL`；
- Pi 的 `delegateAgent` 在执行前仍会服务端校验 Agent ID；
- 创建与订阅 API 都要求通过请求头传入 `Beyond-Token`，本服务按 ByClaw 登录 JWT 公钥验签后再转发给 Connector；
- `Beyond-Token` 不写入 Run、Delegation、事件或日志；
- 当前服务不运行 Shell、CLI 或不可信代码。
- Worker 结构化日志不输出任务正文和 `Beyond-Token`。

## 状态

当前完成 HTTP/SSE 与 `BY_MAESTRO` Worker 两种入站方式的纯文本内存闭环。
PostgreSQL、Artifact 和进程恢复属于下一里程碑。
