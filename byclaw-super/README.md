# byclaw-super

基于 Pi SDK 的超级助手编排服务。Leader 通过自然语言理解任务、选择授权数字员工，并通过可插拔 Connector 调度外部 Agent Runtime。

当前首个闭环支持：

- PostgreSQL 持久化 Session、Run、Delegation、RunEvent、Worker binding 和 Pi checkpoint；
- 多实例 Run claim、Session lease、heartbeat 与 fencing token；
- 同 Session FIFO、不同 Session 并行及非终态 Run 接管；
- `@earendil-works/pi-coding-agent@0.80.10` Leader；
- Pi 原生 header + append-only entries 恢复、自动 compaction 和有界 Session cache；
- 只包含 `delegateAgent`、`askUserQuestion` 的安全工具集合；
- `@byclaw/connector-openclaw-by-framework`；
- OpenClaw externalRef + Redis Stream cursor 恢复；
- 专用数据库表短期保存执行凭证，Run 终态立即删除；
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

## 上下文工程

Leader 的基础 system prompt 只保存稳定的 Supervisor 职责和安全边界。运行期上下文由
[`packages/by-conductor/src/context`](packages/by-conductor/src/context) 中的
`ContextCompiler` 按固定顺序编译，当前初版包含：

1. `SupervisorPolicyProcessor`：规范化并校验稳定的 Leader system prompt；
2. `AuthorizedAgentsProcessor`：把本次 Run 冻结的授权 Agent 快照编码成动态数据区；
3. `ContextCleanupProcessor`：清理空区段并稳定最终格式。

Pi 的 `before_agent_start` 钩子负责调用编译器。稳定规则始终位于最终 prompt 前部，动态授权
数据位于尾部；Agent 的 Connector、执行目标和调用凭证不会进入模型上下文。真正的 Agent
授权仍由 `DelegationService` 根据 `Run.agentList` 强制校验，prompt 只帮助模型选择，不能替代
服务端授权。

每个 Run 调用 Pi 前还会根据同一份授权快照重算活动工具：`askUserQuestion` 始终可用；
没有授权 Agent 时不向模型暴露 `delegateAgent`，存在授权 Agent 时才启用它。工具可见性
用于避免无效调用，`DelegationService` 的执行期校验仍是最终安全边界。

编译结果同时返回 SHA-256 指纹、字符数、粗略 token 估算及各 processor 耗时，不保存完整
prompt。后续 Session 记忆、Skill、附件和 Step 状态应通过新增 processor 扩展，不在
`pi-leader.ts` 中继续拼接字符串。Pi transcript、checkpoint 和 compaction 仍由 Pi 原生机制负责。

## Agent 能力路由卡 API

前端创建或编辑 Agent 时，可以调用无状态能力卡接口：

```http
POST /v1/agent-capability-cards/compile
Beyond-Token: TOKEN
Content-Type: application/json
```

```json
{
  "locale": "zh-CN",
  "agent": {
    "name": "经营分析助手",
    "description": "分析销售、收入和客户转化数据",
    "instructions": "根据经营数据定位指标异常并输出结论",
    "skills": [
      {
        "code": "sql-analysis",
        "name": "SQL 数据分析",
        "description": "查询和分析结构化数据"
      }
    ],
    "inputTypes": ["自然语言问题", "指标", "时间范围"],
    "outputTypes": ["分析结论", "异常说明"],
    "constraints": ["不能修改生产数据"]
  }
}
```

接口复用 Leader 已认证的 Pi 模型，但使用独立无状态调用，不创建 Session、Run 或 checkpoint。
模型只生成结构化草稿；服务端负责字段校验、长度限制、SHA-256 来源指纹、质量信息和不超过
500 字符的确定性 `routingText`。响应结构版本当前固定为
`byclaw.agent-capability-card/v1`。本服务不保存能力卡，调用方确认后应将完整响应随 Agent
配置保存到 ByClaw BE。

请求必须包含 Agent 名称，并至少提供 description、instructions、skills、tools、
knowledgeDomains 或 examples 中的一项。`Beyond-Token` 只用于鉴权，不进入模型输入和响应。

## 用户交互

Leader 和 Connector 共用 `interaction.requested` / `interaction.responded` 领域事件：

- Leader 可调用 `askUserQuestion`，每次提出 1～4 个结构化问题并暂停工具调用；
- OpenClaw Connector 会识别 by-framework `reasoningLogDelta + contentType=3013`，
  转成相同的内部交互事件；
- by-framework 入站 Worker 继续向现有前端输出 `3013` 固定表单，不要求模型生成 HTML；
- 前端提交 `RESUME` 后，Super 根据事件 metadata 中的 `parent_run_id` 和
  `interaction_id` 恢复 Leader，或转发给原来的子 Agent；
- 直接使用 HTTP/SSE 的客户端可调用交互响应接口，不依赖 by-framework。

Leader system prompt 要求只在短澄清会实质改变结果、且采用默认值有风险时提问；只问消除
歧义所需的最少问题，同一时刻只允许一个未解决交互，提问后必须等待工具结果。submit、skip、
cancel 等生命周期动作只由 UI/runtime 发出。

## 环境配置

本项目只读取根目录这一份运行配置：

```text
byclaw-super/.env
```

外层 `ByClaw/.env` 不属于本服务，`app/` 下也不需要创建 `.env`。初始化配置：

```bash
cp .env.example .env
```

稳定默认值统一定义在 [`app/config/config-defaults.ts`](app/config/config-defaults.ts)，同名环境变量优先。
`.env` 只需保存没有安全默认值的必填项，以及当前部署确实不同的配置：

```dotenv
# PostgreSQL 账号
DB_USER=
DB_PASS=

# 默认 Pi 模型的凭证
OPENAI_API_KEY=

# 只在部署值与代码默认值不同时填写，例如：
# PORT=10001
# REDIS_HOST=10.0.0.10
# REDIS_USERNAME=
# REDIS_PASSWORD=
# DB_EVENT_LISTEN_ENABLED=false
# DB_MIGRATE_ON_START=true
```

完整的可选变量示例见 [`.env.example`](.env.example)。数据库密码和模型密钥等安全配置
不设代码默认值。其他稳定参数均采用“环境变量优先，代码常量兜底”的规则。

创建 Session/Run、查询、取消和订阅 SSE 都必须通过请求头传入 `Beyond-Token`。为了让其他实例
在故障接管后继续执行非终态 Run，Token 会写入专用凭证表；只有持有当前 Session lease 和有效
fencing token 的实例才能读取，并在 Run 终态或凭证过期后删除。Token 不写入 Run、Event、Pi
Session 或日志。
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

要求 Node.js 22.19+、pnpm 11、PostgreSQL、可用 Redis，以及至少一个
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
数据库或 Worker 初始化失败时进程不会假装启动成功。生产建议由独立 release job 执行
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
    "message":"请让数据分析专家分析这个问题",
    "thinkingLevel":"high"
  }'
```

`thinkingLevel` 是单次 Run 参数，可选值为 `off`、`minimal`、`low`、`medium`、`high`、
`xhigh`、`max`，未传时为 `off`。它应随创建 Run 的 POST 请求发送；SSE 订阅 URL
不接收该参数。

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
    "message":"继续刚才的话题，展开第二点",
    "thinkingLevel":"off"
  }'
```

同一 `sessionId` 的 Run 会复用同一个 Pi LeaderSession，并按 FIFO 执行；每轮都返回新的
`runId` 和 `eventsUrl`。同一用户可以创建多个互不共享普通上下文的 Session。

读取 Session 历史消息：

```bash
curl 'http://127.0.0.1:3000/v1/sessions/SESSION_ID/messages?limit=50' \
  -H 'Beyond-Token: TOKEN'
```

```json
{
  "sessionId": "SESSION_ID",
  "items": [
    {
      "id": "RUN_ID:user",
      "runId": "RUN_ID",
      "runStatus": "COMPLETED",
      "role": "user",
      "content": "请分析这个问题",
      "createdAt": 1753330000000
    },
    {
      "id": "RUN_ID:assistant",
      "runId": "RUN_ID",
      "runStatus": "COMPLETED",
      "role": "assistant",
      "content": "分析结果如下……",
      "createdAt": 1753330010000
    }
  ],
  "nextCursor": null
}
```

`limit` 表示对话轮次（Run）数量，默认 50、最大 100；每轮最多返回一条 user 和一条
assistant 消息。首屏返回最近一页，但 `items` 内保持时间正序。`nextCursor` 非空时，把它原样
放入 `before` 查询更早历史。进行中的 Run 只返回 user 消息和 `runStatus`，实时输出继续订阅
该 Run 的 SSE。历史内容来自 `byai_super_runs.input/final_answer`，不会把 Pi tool/compaction entries
直接暴露给前端。

创建 Run 的 HTTP 请求负责发起调度；SSE 是单向结果流。订阅返回的 `eventsUrl`：

```bash
curl -N --no-buffer \
  http://127.0.0.1:3000/v1/runs/RUN_ID/events \
  -H 'Beyond-Token: TOKEN'
```

当 SSE 收到 `interaction.requested` 投影出的 `contentType=3013` 表单后，可直接提交：

```bash
curl -X POST \
  http://127.0.0.1:3000/v1/runs/RUN_ID/interactions/INTERACTION_ID/respond \
  -H 'content-type: application/json' \
  -H 'Beyond-Token: TOKEN' \
  -d '{
    "action":"submit",
    "answers":{"实现方式":"方案 B"},
    "text":"采用方案 B"
  }'
```

`action` 可为 `submit`、`skip` 或 `cancel`。接口只接受仍处于 pending 状态、且属于当前鉴权
用户 Run 的交互；重复提交返回 `409 INTERACTION_NOT_PENDING`。

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
subAgentStart
subAgentProgress
subAgentOutputDelta
subAgentEnd
subAgentError
answerStart
answerDelta
answerEnd
appStreamResponse
```

`subAgent*` 事件使用 `delegationId` 作为 `messageId`、Run ID 作为
`queryMessageId/traceId`。子 Agent 文本增量会先和 Delegation cursor/累计输出在同一
PostgreSQL 事务持久化，再通过 SSE 推送，因此支持 `Last-Event-ID` 跨实例回放；子 Agent
输出不会拼入 Leader 的 `answerDelta`。

## by-framework 入站调用

当前服务启动后会在同一个 Redis 中注册逻辑 Agent 类型 `BY_SUPER`。上游通过
by-framework 投递时需要满足：

- `targetAgentType` 等于 `BYCLAW_WORKER_AGENT_TYPE`；
- ByClaw BE 中默认超级助手资源 `{userCode}_main` 的 `worker_agent_type` 为 `BY_SUPER`；
- `content` 是任务文本，也兼容 BaiYing message 数组；
- `metadata` 或 `extraPayload` 中必须包含 `Beyond-Token`；
- 单次 Run 的 `thinkingLevel` 放在 `extraPayload`，未传时为 `off`；
- 上游与本服务连接同一个 Redis/database。

示例：

```ts
await client.sendMessage({
  targetAgentType: "BY_SUPER",
  sessionId,
  content: "请分析这个问题",
  metadata: { "Beyond-Token": token },
  extraPayload: { thinkingLevel: "high" },
});
```

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
pnpm test:e2e
pnpm build
```

`pnpm test:e2e` 会在随机本地端口启动轻量测试服务，通过真实 HTTP、SSE 和 RS256
`Beyond-Token` 验签覆盖健康检查、Session/Run 主链路、事件回放及跨用户隔离。
数据库、模型和 Agent Catalog 在第一版使用确定性内存替身，因此本地运行不要求 Docker
或外部服务；真实 PostgreSQL 与外部依赖仍由集成测试和部署环境 Smoke Test 验证。

服务启动后可执行真实 Redis + OpenClaw Worker Smoke Test：

```bash
BEYOND_TOKEN=token \
pnpm smoke
```

## Current limitations

- `Beyond-Token` 按已确认的部署安全边界明文短期保存在专用数据库表中；数据库访问控制、
  审计和备份保护由部署环境负责；
- OpenClaw 使用稳定 `delegationId` 作为 message/trace ID 并支持 cursor resume，但
  by-framework 是否对重复 `sendMessage` 做原子去重仍需在真实环境验证；进程恰好在外部接收任务、
  数据库保存 externalRef 之前宕机，仍存在重复投递窗口；
- QUEUED/RUNNING 的双实例竞争已有数据库集成覆盖；WAITING_AGENT/SYNTHESIZING 的真实
  kill/failover、LISTEN 重连和真实 Pi/OpenClaw 恢复仍需部署环境验收；
- Artifact 内容持久化和本地 Spawn Connector 尚未实现；
- HTTP 不接 ByClaw Java session；Agent 使用权限以 ByClaw BE `discover` 返回的
  `usesPermissions` 为准。
