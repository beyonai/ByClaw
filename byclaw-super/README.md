# byclaw-super

基于 Pi SDK 的超级助手编排服务。Leader 通过自然语言理解任务、选择授权数字员工，并通过可插拔 Connector 调度外部 Agent Runtime。

当前首个闭环支持：

- Thread、Run、Delegation 领域模型与同 Thread FIFO；
- `@earendil-works/pi-coding-agent@0.80.10` Leader；
- 只包含 `delegateAgent` 的安全工具集合；
- `@byclaw/connector-openclaw-by-framework`；
- HTTP Thread/Run API、SSE 事件回放、超时与级联取消；
- 内存 Repository 和事件存储。

## Workspace

```text
app/                                      Fastify 服务和 Composition Root
packages/by-conductor/                    编排核心、Pi Leader、Connector SPI
packages/connectors/openclaw-by-framework OpenClaw/by-framework Connector
legacy/fastify-pi-starter/                重构前行为参考，不参与 workspace
```

依赖方向固定为：

```text
app → by-conductor
app → connector-openclaw-by-framework → by-conductor
                                      → by-framework
```

新增 Hermes、Codex 等 Runtime 时，实现新的 `AgentConnector` 包并在 `app` 注册，不修改 Pi Leader。

## Quick start

要求 Node.js 22.19+、pnpm 11、可用 Redis、至少一个已认证 Pi 模型。

```bash
pnpm install
cp app/.env.example .env
pnpm --filter @byclaw/byclaw-super dev
```

`.env` 中的密钥不得提交。默认端口为 `3000`。

创建 Thread：

```bash
curl -X POST http://127.0.0.1:3000/v1/threads \
  -H 'content-type: application/json' \
  -d '{"tenantId":"tenant-1","userCode":"user-1"}'
```

创建 Run：

```bash
curl -X POST http://127.0.0.1:3000/v1/threads/THREAD_ID/runs \
  -H 'content-type: application/json' \
  -H 'Beyond-Token: TOKEN' \
  -d '{
    "message":"请让数据分析专家分析这个问题",
    "agentList":[{
      "agentId":"10003355",
      "agentCode":"data-analyst",
      "agentName":"数据分析专家",
      "description":"负责数据分析"
    }]
  }'
```

订阅返回的 `eventsUrl`：

```bash
curl -N http://127.0.0.1:3000/v1/runs/RUN_ID/events
```

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

真实环境 Smoke Test：

```bash
SMOKE_AGENT_ID=10003355 \
SMOKE_USER_CODE=user-1 \
BEYOND_TOKEN=token \
pnpm --filter @byclaw/byclaw-super smoke
```

## Current limitations

- 数据只保存在当前进程内存中，重启后丢失；
- 尚未接入 `BY_MAESTRO` Worker 入站；
- 尚未实现 PostgreSQL、Artifact、恢复扫描和本地 Spawn Connector；
- HTTP 当前假设由可信业务后端或开发调用方访问，不包含独立鉴权。
