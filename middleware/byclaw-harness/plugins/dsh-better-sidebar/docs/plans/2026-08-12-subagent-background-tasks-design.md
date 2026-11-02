# 任务管理页后台命令区块（查看输出 + 强制终止）设计

> 2026-08-12 · v0.8.0

## 目标

任务管理页（当前树的主代理拓扑，原「子代理」页）在拓扑树下方同页显示**当前树全部会话**（主代理 + 子代理）的后台任务：

- 点击任务行，输出显示在**侧边栏底部共享 Dock**（sticky 终端式，滚动时保持可见；运行中每 2s 轮询，页面不可见时暂停；自动跟随底部）；
- 运行中的任务行带两击确认的终止按钮；
- **不破坏模型契约、不修改 DSH 源码**（本仓库规则：对官方源码 checkout 零写入，挂载只走 cordis.patch.yml + profile 机制）：输出查看是**模型已读输出的回放**，绝不推进 `task_output` 的读取游标。

## 数据流

```
bash/tool  run_in_background → ctx.tasks.start（owner = 执行 agent）
api-proxy  session/tasks 帧（TaskView[]，无输出）→ 客户端 tasksBySession 镜像
SubagentView 读镜像 → collectTreeTasks(树内会话) → 行渲染（单 Dock，选中行）
点行 → POST /sidebar/api/tasks.output（事件回放）→ 扫描属主会话 events 里
        task_output 的 tool/call + tool/result 对 → 模型已读文本
终止 → POST /sidebar/api/tasks.kill → ctx.tasks.kill（DSH 现成 API）
```

## 关键决策

1. **输出 = 会话事件回放，零 DSH 写入**：`TaskService.read()` 是单一消费游标——UI 直接读会偷走模型 `task_output` 的字节（或读到空）。而 DSH 源码禁止修改，所以 `tasks.output` **不碰注册表**：扫描属主会话的 append-only 事件日志，取 `task_output` 调用的 `tool/call`（`arguments.task_id` 配对）与其 `tool/result`（finalize 后的文本，即模型实际收到的内容）按序拼接；`"(no new output)"` 增量与错误结果跳过；`read: false` 表示模型尚未读过。模型游标天然不被触碰。
   - 语义代价（用户已确认接受）：面板只在模型读过之后才有内容——没有实时流。
2. **列表不新增路由**：任务清单由 harness 的 `session/tasks` 推送镜像提供；只加 `tasks.output`（回放）与 `tasks.kill`（注册表原生 `kill`）两个路由（信任围栏与其余路由一致）。注册表缺席时 kill 降级 503（output 不需要注册表）。
3. **终止的访问围栏**：caller 由请求的 `sessionId` 现场解析 `ctx.agents.get(sessionId)`，注册表按 owner session id 拒绝 foreign 任务；未知/foreign 统一映射 404 `task-error`。
4. **展示范围 = 整棵树**：与页面作用域一致（拓扑即当前树）；树跨多会话时行尾显示属主标题。
5. **单共享 Dock（大量任务的形态）**：行内展开会让列表随任务数膨胀、排序变化时面板跳动；改为一个底部 sticky Dock + 单一轮询实例，行保持紧凑、排序变动不惊吓，选中行高亮。
6. **两击确认终止**：首次点击进入「再次点击确认」态（3s 自动解除），防止误杀长任务。
7. **输出上限**：路由按 `readLimit`（默认 512KB）截断并置 `truncated` 标记。

## 实施偏差

- 曾实现 harness 侧非消费 peek 缝隙（`BashProcess.peekOutput` / `TaskService.peek`），因「禁止修改 DSH 源码」规则**整体回退**（harness 提交已 reset，checkout 恢复纯净快照），改用事件回放。
- 宿主不新增 `@deepseek-ai/*` 依赖（`ctx.tasks`/`ctx.agents` 走结构性镜像 + 运行时 `ctx.get`，可选服务降级 503）；`ctx.sessions.get(id).events` 为只读访问。

## 验证

- 插件单测：tasks-routes（回放拼接/过滤/read 标志/截断/404/503 降级）；subagent-tasks 纯函数；jsdom 视图（行渲染、单 Dock 切换、关闭、两击终止、read:false 提示、大量任务、隐藏不轮询、镜像清空 hook 顺序回归 #300）。
- 集成（真实 dsh web）：启动 `run_in_background` bash → 模型 `task_output` 读取 → `/sidebar/api/tasks.output` 返回模型已读内容 → `/sidebar/api/tasks.kill` 后进程退出、任务结算 `killed (signal: SIGTERM)`。
