# AGENTS.md

本文件只约束 `@byclaw/by-conductor`。

## 边界

- Domain 不得依赖 Pi SDK、Fastify、by-framework、OpenClaw SDK、Redis 或数据库 SDK；
- 核心处理一次 Execution，不管理 tenant/user、长期 Thread 或服务级 Run 队列；
- 业务数据加载与持久化不属于本包；
- Runtime 选择必须通过端口/Connector，不能在核心中添加 Runtime `if/else`；
- 所有外部能力通过 `src/ports/` 暴露；
- 公开类型通过 `src/index.ts` 导出，其他包不得导入本包内部路径。

## 当前阶段

v1 最小骨架。未经明确要求，不实现类型、接口、状态机或业务逻辑；新增文件只写职责注释或最小入口。
