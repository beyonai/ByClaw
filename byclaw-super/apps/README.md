# byclaw-super service

面向多租户部署的超级助手服务，基于 `@byclaw/by-conductor` 完成单次 Run 编排。

本服务负责：

- HTTP Chat、SSE Chat 和 by-framework 入站；
- tenant/user 身份、Thread、Run 和 FIFO 排队；
- 会话上下文、持久化、恢复、Artifact 和可观测性；
- Pi、OpenClaw 与 by-framework 适配器的最终装配。

## 目录

- `src/adapters/`：出站适配器，本服务调用下游 Runtime / SDK；
  - `pi/`、`openclaw/`、`by-framework/`
- `src/server/`：入站协议（HTTP / SSE / by-framework），别人调用本服务。

## 当前状态

v1 最小骨架：仅有目录边界，暂无入口、路由、Worker、Repository 或 Composition Root。
