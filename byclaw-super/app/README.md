# byclaw-super service

Fastify 部署单元与 Composition Root。它装配内存存储、Pi Leader、Connector Registry 和 OpenClaw Connector。

## API

- `POST /v1/threads`
- `POST /v1/threads/:threadId/runs`
- `GET /v1/runs/:runId`
- `GET /v1/runs/:runId/events`
- `POST /v1/runs/:runId/cancel`
- `GET /health`
- `GET /ready`

Run 创建返回 `202` 并在后台执行。SSE 支持 `Last-Event-ID` 回放，连接断开不会取消 Run。

## 安全边界

- `agentList` 被视为可信上游已经过权限过滤的快照；
- Pi 的 `delegateAgent` 在执行前仍会服务端校验 Agent ID；
- `Beyond-Token` 只转发给 Connector，不写入 Run、Delegation、事件或日志；
- 当前服务不运行 Shell、CLI 或不可信代码。

## 状态

当前完成首个纯文本内存闭环。`BY_MAESTRO` 入站、PostgreSQL、Artifact 和进程恢复属于下一里程碑。
