# byclaw-super

基于 Pi SDK 的超级助手编排服务。Leader 通过自然语言理解任务、选择授权数字员工，并通过可插拔 Connector 调度外部 Agent Runtime。

当前首个闭环支持：

- PostgreSQL 持久化 Session、Run、Delegation、RunEvent、Worker binding 和 Pi checkpoint；
- 多实例 Run claim、Session lease、heartbeat 与 fencing token；
- 同 Session FIFO、不同 Session 并行及非终态 Run 接管；
- `@earendil-works/pi-coding-agent@0.80.10` Leader；
- Pi 原生 header + append-only entries 恢复、自动 compaction 和有界 Session cache；
- 只包含 `delegateAgent` 的安全工具集合；
- `@byclaw/connector-openclaw-by-framework`；
- OpenClaw externalRef + Redis Stream cursor 恢复；
- KMS envelope encryption 短期保存执行凭证，Run 终态立即删除；
- 默认注册为 by-framework `BY_SUPER` Worker，可通过 by-framework 发起入站任务；
- HTTP Run API、数据库 SSE 事件回放、超时与级联取消。

## 项目结构

```text
app/                                      byclaw-super 业务应用源码（相当于 src）
app/worker/                               by-framework 入站 Worker 适配与生命周期
packages/by-conductor/                    编排核心、Pi Leader、Connector SPI
packages/connectors/openclaw-by-framework OpenClaw/by-framework Connector
packages/storage-postgres/                PostgreSQL migration 与持久化 adapter
legacy/fastify-pi-starter/                重构前行为参考，不参与 workspace
```

根目录 `byclaw-super` 本身就是可启动的业务应用包。`app/` 只是源码目录，不是独立
workspace package，因此其中没有 `package.json`，所有应用依赖和启动脚本都由根目录
`package.json` 管理。`packages/*` 仍是可独立构建的内部库包。

依赖方向固定为：

```text
app → by-conductor
app → storage-postgres → by-conductor
app → connector-openclaw-by-framework → by-conductor
                                      → by-framework
```

新增 Hermes、Codex 等 Runtime 时，实现新的 `AgentConnector` 包并在 `app` 注册，不修改 Pi Leader。
by-framework Worker 是业务入口，因此实现在 `app/worker`；Connector 仍只负责访问外部
Agent Runtime，二者不会放进同一个包。

## 环境配置

本项目只读取根目录这一份运行配置：

```text
byclaw-super/.env
```

外层 `ByClaw/.env` 不属于本服务，`app/` 下也不需要创建 `.env`。初始化配置：

```bash
cp .env.example .env
```

主要变量：

```dotenv
# HTTP 服务
HOST=0.0.0.0
PORT=3000
CORS_ORIGIN=*
LOG_LEVEL=info

# PostgreSQL 是唯一生产真相源
DB_TYPE=postgresql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=postgres
DB_SCHEMA=byai
DB_USER=
DB_PASS=
DB_SSL=false
# 标准 PostgreSQL 保持 true；不支持 LISTEN 的兼容库可设为 false，SSE 使用数据库轮询
DB_EVENT_LISTEN_ENABLED=true
DB_MIGRATE_ON_START=false

# 多实例执行与 Pi cache
RUN_LEASE_MS=30000
RUN_QUEUE_POLL_MS=500
RUN_CREDENTIAL_MAX_TTL_MS=7200000
RUN_CREDENTIAL_CLEANUP_INTERVAL_MS=60000
# 每个并发进程必须唯一；默认使用 hostname + pid
# BYCLAW_INSTANCE_ID=
PI_SESSION_CACHE_MAX_ENTRIES=100
PI_SESSION_CACHE_IDLE_TTL_MS=1800000

# 生产必须由部署环境提供真实 KMS adapter 模块
KMS_ADAPTER_MODULE=
KMS_KEY_ID=

# 必须与 OpenClaw byai-channel 使用同一个 Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DATABASE=0
# REDIS_USERNAME=
# REDIS_PASSWORD=

DELEGATION_TIMEOUT_MS=1800000

# 默认把当前服务注册为 by-framework Worker
BYCLAW_WORKER_ENABLED=true
# 逻辑路由名：上游发任务时使用该 targetAgentType
BYCLAW_WORKER_AGENT_TYPE=BY_SUPER
# 可选实例 ID；不配置时为 byclaw-super-{hostname}
# BYCLAW_WORKER_ID=
BYCLAW_WORKER_MAX_CONCURRENCY=10

# Beyond-Token 认证，默认使用父项目 ByClaw 后端的 login.jwt.public-Key
# 如果父项目覆盖了该公钥，这里也要同步覆盖
# LOGIN_JWT_PUBLIC_KEY=

# ByClaw BE 兜底地址：Redis 没有有效 ByaiService 实例时使用
BYCLAW_BE_BASE_URL=http://127.0.0.1:8086
BYCLAW_BE_TIMEOUT_MS=10000

# Pi Leader 模型
PI_PROVIDER=zhipu
PI_MODEL=glm-5.2
OPENAI_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
OPENAI_API_KEY=
```

创建 Session/Run、查询、取消和订阅 SSE 都必须通过请求头传入 `Beyond-Token`，Token 不保存为服务端
环境变量或业务记录。它只会以 KMS envelope encryption 密文短期保存，并在 Run 终态删除。
`userCode` 从验签后的 Token claim 中读取；授权 Agent 列表由服务携带同一
Token 调用 ByClaw BE 获取，调用方不再传入这两个字段。

父项目 ByClaw 的认证逻辑是：后端优先读取 session；没有 session 时读取请求头
`beyond-token`，再用 `JwtTokenFilter` 通过 `JwtService.verifyJwt` 按 RS256 公钥验签。
本服务没有 Java session，因此只走 `Beyond-Token` JWT 验签，并要求 Token 中必须
包含 `userCode`。然后调用 `/byaiService/api/v2/digitEmploy/discover`，只把返回结果中
`usesPermissions=true` 的数字员工注入本次 Run。

ByClaw BE 地址优先从当前 Redis 读取：

```text
Hash key: byai_gateway:sd:instances:ByaiService
Hash field: ByaiService:{instanceId}
```

服务会根据实例的 `protocol`、`host`、`port`、`path_prefix` 组装地址；多个实例按
`weight` 轮询。Hash 为空、实例数据无效、Redis 异常或读取超时时，回退到
`BYCLAW_BE_BASE_URL`。

## 本地启动

要求 Node.js 22.19+、pnpm 11、PostgreSQL、可用 Redis、KMS adapter，以及至少一个
已认证 Pi 模型。首次部署先执行 migration：

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

`pnpm dev` 会先构建内部 packages，再从 `app/index.ts` 启动业务服务。因为命令始终
从项目根目录执行，`dotenv` 会固定读取根目录 `.env`。默认启动顺序是先把
`BYCLAW_WORKER_AGENT_TYPE` 注册为 by-framework Worker，再监听 HTTP `3000` 端口；
启动会校验 schema，并在启用时建立 PostgreSQL LISTEN 连接，再启动 Run claim、Worker 和 HTTP。
数据库、KMS 或 Worker 初始化失败时进程不会假装启动成功。生产建议由独立 release job 执行
`pnpm db:migrate`，应用设置 `DB_MIGRATE_ON_START=false`。

检查服务与依赖：

```bash
curl http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/ready
```

`/ready` 会同时返回 PostgreSQL schema、事件 listener、Pi、Connector 和 Worker 健康状态。
正常时可看到类似：

```json
{
  "worker": {
    "enabled": true,
    "healthy": true,
    "workerId": "byclaw-super-hostname",
    "agentType": "BY_SUPER"
  }
}
```

生产方式启动：

```bash
pnpm build
pnpm start
```

## HTTP/SSE 调用

创建一个 Session，并原子创建首个 Run：

```bash
curl -X POST http://127.0.0.1:3000/v1/sessions \
  -H 'content-type: application/json' \
  -H 'Beyond-Token: TOKEN' \
  -d '{
    "message":"请让数据分析专家分析这个问题"
  }'
```

返回示例：

```json
{
  "sessionId": "SESSION_ID",
  "runId": "RUN_ID",
  "status": "QUEUED",
  "eventsUrl": "/v1/runs/RUN_ID/events"
}
```

要在同一个 Session 中继续对话，使用响应中的 `sessionId` 创建新的 Run：

```bash
curl -X POST http://127.0.0.1:3000/v1/sessions/SESSION_ID/runs \
  -H 'content-type: application/json' \
  -H 'Beyond-Token: TOKEN' \
  -d '{
    "message":"继续刚才的话题，展开第二点"
  }'
```

同一 `sessionId` 的 Run 会复用同一个 Pi LeaderSession，并按 FIFO 执行；每轮都返回新的
`runId` 和 `eventsUrl`。同一用户可以创建多个互不共享普通上下文的 Session。

创建 Run 的 HTTP 请求负责发起调度；SSE 是单向结果流。订阅返回的 `eventsUrl`：

```bash
curl -N --no-buffer \
  http://127.0.0.1:3000/v1/runs/RUN_ID/events \
  -H 'Beyond-Token: TOKEN'
```

`runId` 只定位一次执行，不是授权凭证。服务会从 Run 找到 Session，并将 Session 的
`userCode` 与当前验签身份比较。V1 不使用 `tenantId`、`namespace` 或 `System-Code`
参与授权。资源不存在或属于其他用户时
统一返回 404，避免泄露 ID 是否真实存在。取消和查询使用：

```text
GET  /v1/runs/:runId
POST /v1/runs/:runId/cancel
```

SSE 事件使用 ByClaw 现有思考模型格式：

```text
reasoningLogStart
reasoningLogDelta
reasoningLogEnd
answerStart
answerDelta
answerEnd
appStreamResponse
```

## by-framework 入站调用

当前服务启动后会在同一个 Redis 中注册逻辑 Agent 类型 `BY_SUPER`。上游通过
by-framework 投递时需要满足：

- `targetAgentType` 等于 `BYCLAW_WORKER_AGENT_TYPE`；
- `content` 是任务文本，也兼容 BaiYing message 数组；
- `metadata` 或 `extraPayload` 中必须包含 `Beyond-Token`；
- 上游与本服务连接同一个 Redis/database。

Worker 会复用 HTTP API 的同一条 `RunIngressService` 链路：Token 验签、从 Token 获取
`userCode`、查询授权 Agent Catalog、创建内部 Run，再把简化思考进度和 Leader 回答映射为
by-framework 的 `reasoningLog*`、`answerDelta` 和终态事件。子 Agent 返回的 `Resume`
只结束原子会话，不会重复创建 Run。

同一个调用者作用域中的 by-framework `sessionId` 会映射到同一个内部 Session，因此连续
AskAgent 可以保留上下文；binding key 包含 `ownerVersion + userCode`，不同用户即使使用相同
外部 `sessionId` 也不会碰撞，映射和 Pi 上下文都会跨实例、跨重启保留。

`BYCLAW_WORKER_AGENT_TYPE` 同时会注入 OpenClaw Connector 作为 `sourceAgentType`，因此
修改逻辑路由名后，OpenClaw 的 Resume 仍能正确回到当前服务。`BYCLAW_WORKER_ID` 是具体
进程实例 ID，同一 Redis 中必须唯一；通常无需手工配置，Kubernetes hostname 默认即可。

如只想使用 HTTP/SSE 而不注册 Worker，可设置：

```dotenv
BYCLAW_WORKER_ENABLED=false
```

## 日志

应用使用 Fastify/Pino 输出 JSON 结构化日志，日志级别由根 `.env` 的 `LOG_LEVEL` 控制：

```dotenv
LOG_LEVEL=debug
```

Worker 日志会记录 `workerId`、`agentType`、`messageId`、`sessionId`、`traceId` 和内部
`runId`，不会记录任务正文或 `Beyond-Token`。本地直接运行 `pnpm dev` 即可在终端查看。

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

服务启动后可执行真实 Redis + OpenClaw Worker Smoke Test：

```bash
BEYOND_TOKEN=token \
pnpm smoke
```

## Current limitations

- 本地 macOS 可显式使用 `./keychain-kms-adapter.js`，KEK 保存在登录钥匙串且生产模式拒绝启动；
  生产部署仍需提供实现 `createKeyEncryptionService({keyId})` 的真实云厂商/公司 adapter；
- OpenClaw 使用稳定 `delegationId` 作为 message/trace ID 并支持 cursor resume，但
  by-framework 是否对重复 `sendMessage` 做原子去重仍需在真实环境验证；进程恰好在外部接收任务、
  数据库保存 externalRef 之前宕机，仍存在重复投递窗口；
- QUEUED/RUNNING 的双实例竞争已有数据库集成覆盖；WAITING_AGENT/SYNTHESIZING 的真实
  kill/failover、LISTEN 重连和真实 Pi/OpenClaw 恢复仍需部署环境验收；
- Artifact 内容持久化和本地 Spawn Connector 尚未实现；
- HTTP 不接 ByClaw Java session；Agent 使用权限以 ByClaw BE `discover` 返回的
  `usesPermissions` 为准。
