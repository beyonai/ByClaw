# AGENTS.md

本文件只约束 `apps/byclaw-super`。

## 服务边界

- 三种入站协议必须复用同一个 SubmitMessage/Run 应用链路；
- 同一 Thread 同时只能有一个活动 Run，后续消息按 FIFO 排队；不同 Thread 可以并发；
- 所有状态和查询必须保留 tenant/user 边界；
- PiSession 只属于一次 Execution Attempt，不能作为权威会话存储；
- HTTP/by-framework 类型只能出现在相应入站适配器；
- 服务通过 `@byclaw/by-conductor` 公开 API 执行编排，不导入其内部源码。

## 出站 / 入站

- `src/server/` 处理别人调用本服务（入站：HTTP / SSE / by-framework）；
- `src/adapters/by-framework/` 处理本服务调用下游 Runtime（出站）；
- 两个方向的命令、事件和生命周期不得混用；
- Pi SDK 与 OpenClaw 适配代码位于 `src/adapters/pi/`、`src/adapters/openclaw/`。

## 当前阶段

v1 最小骨架。未经明确要求，不实现路由、Worker、Repository、调度器或 Composition Root；新增文件只写职责注释或最小入口。当某个适配器接缝需要独立发布时，再从目录提升为包。
