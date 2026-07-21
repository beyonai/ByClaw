# @byclaw/by-conductor

通用 Agent 编排引擎，负责一次 Execution 内的 Catalog、Context、Kernel、Delegation、取消、预算和规范化事件。

本包不处理多租户、HTTP/SSE、by-framework 入站、Thread 队列、数据库或部署生命周期。

## 当前状态

v1 最小骨架：仅保留包入口 `src/index.ts` 与两个边界目录：

- `src/domain/`：Agent / Context / Execution 等领域模型（按需生长）；
- `src/ports/`：AgentKernel / RuntimeConnector / Transport 等外部能力端口（按需生长）。

暂无可调用实现，也未导出任何 API。
