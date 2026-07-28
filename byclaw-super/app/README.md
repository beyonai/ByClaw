# byclaw-super 业务源码

该目录相当于普通项目的 `src/`，保存 Fastify HTTP 层和 Composition Root。它不是独立
workspace package，不包含 `package.json`、独立依赖或独立 `.env`。

所有命令和环境配置都位于项目根目录：

```bash
cp .env.example .env
pnpm dev
```

应用启动时装配 PostgreSQL 持久化 adapter、Pi Leader、
Connector Registry、OpenClaw Connector，以及位于 `worker/` 的 by-framework 入站 Worker。
Worker 属于业务入口，不属于 Connector 包。生产 Composition Root 不使用内存 Repository。

首次部署先运行：

```bash
pnpm db:migrate
```

应用启动会校验 schema 版本，并在配置启用时建立 RunEvent `LISTEN/NOTIFY` 连接；不支持
`LISTEN` 的兼容数据库可显式使用轮询。`/ready` 同时聚合数据库、listener/poller、Pi、
Connector 与 Worker。迁移建议由独立 release job 执行，生产环境保持
`DB_MIGRATE_ON_START=false`。

## API

- `POST /v1/sessions`
- `POST /v1/sessions/:sessionId/runs`
- `GET /v1/sessions/:sessionId/messages`
- `GET /v1/runs/:runId`
- `POST /v1/runs/:runId/cancel`
- `GET /v1/runs/:runId/events`
- `POST /v1/agent-capability-cards/compile`
- `PUT /v1/agents/:agentId/capability-card`
- `GET /health`
- `GET /ready`

除 HTTP 外，应用默认把 `BYCLAW_WORKER_AGENT_TYPE`（缺省 `BY_SUPER`）注册到
by-framework。AskAgent 会进入与 HTTP 相同的 Token、Agent Catalog 和 Run 创建链路；
Resume 只完成子 Agent 回调，不会创建重复 Run。同一 owner scope 下的 by-framework
`sessionId` 会复用内部 Session。设置 `BYCLAW_WORKER_ENABLED=false` 可关闭。

`POST /v1/sessions` 接收必填 `message` 和可选的单次 Run 参数 `thinkingLevel`，返回
`sessionId + runId`。`thinkingLevel` 支持 `off|minimal|low|medium|high|xhigh|max`，
默认 `off`。后续向
`POST /v1/sessions/:sessionId/runs` 提交新消息，会复用同一个 Pi LeaderSession 并返回新的
`runId`。`GET /v1/sessions/:sessionId/messages` 从 Run 的 `input/finalAnswer` 返回前端历史，
支持 `limit` 和不透明 `before` 游标；不直接暴露 Pi 原生 entries。创建、追加、历史查询、
Run 查询、取消与订阅都必须携带 `Beyond-Token`。
SSE 支持 `Last-Event-ID` 回放，连接断开不会取消任务。
by-framework AskAgent 使用 `extraPayload.thinkingLevel` 传入同一参数，不从环境变量读取。
服务会通过 Run 找到 Session，并在存储层按验签 JWT 中的 `userCode` 查询 owner；
V1 不使用 tenantId、namespace 或 System-Code。不存在或越权统一返回 404。
对外流式事件使用 ByClaw 的 `reasoningLog*`、`subAgent*`、`answer*` 和
`appStreamResponse` 格式。OpenClaw 文本增量通过持久
`delegation.output.delta` 事件映射为 `subAgentOutputDelta`，不会混入 Leader 最终回答。

## 安全边界

- Session owner V1 只使用验签 JWT 的 `userCode`，不接受请求体覆盖；
- Agent 列表由 ByClaw BE `discover` 接口提供，只保留 `usesPermissions=true` 的记录；
- ByClaw BE 地址优先读取 Redis `byai_gateway:sd:instances:ByaiService`，没有有效实例时回退 `BYCLAW_BE_BASE_URL`；
- Pi 的 `delegateAgent` 在执行前仍会服务端校验 Agent ID；
- 所有 Session/Run API 都要求通过请求头传入 `Beyond-Token`，本服务按 ByClaw 登录 JWT 公钥验签后再转发给 Connector；
- `Beyond-Token` 明文只写入专用短期凭证表，不写入 Run、Delegation、事件、Pi entries
  或日志，且只有当前 lease/fencing owner 可以读取；
- 当前服务不运行 Shell、CLI 或不可信代码。
- Worker 结构化日志不输出任务正文和 `Beyond-Token`。

## 状态

当前已完成 HTTP/SSE 与 `BY_SUPER` Worker 双入口、PostgreSQL 真相源、Pi 原生 checkpoint、
持久 Worker binding、多实例 Run lease/fencing、短期凭证和 OpenClaw cursor resume。
上线前仍需完成真实 PostgreSQL + Pi + OpenClaw 的分阶段 kill/failover 验收。Artifact
内容持久化属于后续里程碑。
