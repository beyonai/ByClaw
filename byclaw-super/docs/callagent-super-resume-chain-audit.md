# callAgent → 子 Agent → ResumeCommand → Super 恢复：函数级核对

核对日期：2026-09-24。依据：当前工作区 TypeScript 源码，以及本地安装的 `@byclaw/by-framework@1.6.0` JavaScript 实现。**不是生产环境运行记录。**

本次整理沿实际调用顺序列出业务函数、框架入口、持久化和控制分支。表中省略纯日志格式化与普通字符串工具；改变派发、等待、恢复、结束行为的辅助函数单独列出。子 Agent 可以是 Code、OpenClaw 或其他实现，本文核对到共同的框架协议和返回入口，不把某一个子 Agent 的内部模型实现假定成所有员工的实现。

工作区已有两项未提交修改：删除 Leader 模型配置指纹生成/比较；Resume 遇到 `run.failed` 时明确输出失败终态。审计后补充了第三项修复：第二次回调允许从与缓存相等的挂起边界继续读取。最新验证见第 14 节；前面的失败过程保留为修复前证据。

## 1. 先看本次发现：第二次回调存在独立的确定性缺陷

**审计时确认：仅删除模型指纹不足以解决第二次回调。修复前另有一条路径会直接返回缓存的 WAITING_AGENT，根本不订阅第二次恢复后的事件。此缺陷现已修复并经过链路回归，见第 14 节。**

涉及三处函数：

1. [RunService.#resumeBoundaryEventId](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:697)：按本次 `delegationId` 查对应的 `run.suspended`，把该事件 ID 返回为 `afterEventId`。若回调极快、还没有 suspended，才回退到 `delegation.started`。
2. [ByClawSuperGatewayWorker.#forwardRunEvents](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:833)：所有 Resume 共用 `${run.id}:super-summary` 这份转发缓存。上次读到 `run.suspended` 时保存该事件 ID 和 `WAITING_AGENT` 结果。
3. 修复前同一函数只在 `options.afterEventId > saved.afterEventId` 时把缓存的等待结果视为需要继续。**正常的第二次回调，两个值恰好相等。**

具体过程，事件编号仅为示例：

| 时刻 | 数据库/转发动作 | 关键数值 |
|---|---|---|
| 第一个员工回调 | 从员工一的挂起边界恢复，Leader 调度员工二 | 第一次 Resume 从事件 10 后读取 |
| 员工二已派发 | 第一次 Resume 读到员工二的 `run.suspended`，退出并缓存等待结果 | `saved.afterEventId = 12`，`saved.result.status = WAITING_AGENT` |
| 第二个员工回调 | `#resumeBoundaryEventId` 找到员工二的这条挂起事件 | `options.afterEventId = 12` |
| 检查是否继续 | `12 > 12` 为 false | `continuingResume = false` |
| 提前返回 | `if (saved?.result && !continuingResume)` 直接返回旧结果 | 不调用 `streamEvents`，不消费新的 `run.completed` / `run.failed` |

第二次回调可以已经成功写入 Delegation，Run 也可能已经在后台执行或完成；用户流却没有人转发最终事件。因此，“业务恢复了”和“用户对话结束了”在这里会分离。这个条件不依赖多实例、模型配置更新或者指纹。

### 本地复现证据和验证范围

修复前的测试 [continues a later Resume...](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/test/by-framework-worker.test.ts:241) 使用 `afterEventId: 10 → 20`，而第一次恢复实际保存的挂起 ID 是 `12`，因此绕过了相等边界。

本次复制该测试到临时文件，仅将第二个 `afterEventId` 改为 `12`，并改用独立的 `delegation-2` 回调。期望仍为 `COMPLETED`，结果为：

```text
AssertionError: expected 'WAITING_AGENT' to be 'COMPLETED'
Expected: "COMPLETED"
Received: "WAITING_AGENT"
```

这是实际 Worker/Resume handler/转发缓存代码的单元级复现，RunService 事件源为测试替身。另用真实 RunService + 内存仓库/队列 + callback Connector 替身执行两次委派，断言第二次 resumeDelegation 返回的 afterEventId 等于第二次 run.suspended.eventId，该测试通过；PostgreSQL 路径也使用同一个 #resumeBoundaryEventId 函数。没有使用生产 Redis/PostgreSQL，也没有证明所有生产卡住案例都经过此分支。两个临时测试已删除；后续已补充永久回归测试并修复，见第 14 节。

**需要纠正之前的结论：**465 个测试通过只说明那些测试场景通过，未覆盖这个相等边界。原日志中的指纹失败及其错误重试是另一条已经确认的故障链，不能把它当成所有“第二次回调不结束”的唯一解释。

## 2. 先区分三种“等待”

| 对象 | 等待什么 | 子 Agent 工作期间的状态 |
|---|---|---|
| `callAgent(...)` 的 Promise | 路由准备、可用性检查、发布受理 | 发布成功即返回 `QUEUED`，不等最终回答 |
| 本次 `processCommand(...)` | 转发当前 Run attempt 的事件 | 收到 `run.suspended` 后返回 `WAITING_AGENT`；本次调用结束并可 ACK |
| PostgreSQL 的 Run / Delegation | 外部子 Agent 的独立终态回调 | Run 为 `WAITING_AGENT/CONNECTOR_WAITING`；Delegation 保留 `RUNNING` 和 externalRef |

员工完成后，控制流里新增一条 `ResumeCommand`。Worker 再次调用 `processCommand`，它通过 Delegation 找回原 Run；不是恢复原 JavaScript 调用栈。

这里使用的是底层 `dispatch/dispatch_ask_agent.callAgent`，不是 `AgentContext.callAgent`。底层接口不替当前 Super 的 AgentContext 设置 suspended 标记；Super 通过数据库挂起异常和返回 `AgentTaskResult(WAITING_AGENT)` 实现自己的等待协议。

## 3. ID 如何贯穿一轮调用

假设外部会话 `S`、trace `T`、最初用户消息 `M`、内部 Run `R`、本次委派 `D`：

| 位置 | messageId | parentMessageId | 其他关联 |
|---|---|---|---|
| 最初进入 Super 的 Ask | `M` | 入口传入值 | `Run.ingressContext.parentMessageId = M`；外部会话为 `S` |
| Super 展示委派根卡片 | `D` | 展示层设置 | 委派根 orderId 为 `D` |
| `ByFrameworkConnector.start` 发给子 Agent 的 Ask | `D:request` | **`D`** | `sessionId = S`（正常外部入口）；`traceId = T`；metadata 带 `parent_run_id = R`、`delegation_id = D` |
| 子 Agent 框架生成的 Resume | **`D`** | **`D:request`** | source 为子 Agent 类型，target 为 `BY_SUPER`，继承 metadata |
| Super 恢复后的汇总正文 | `R:super-summary:answer` | `-1` | 所有 Resume 共用此汇总节点，以及 `R:super-summary` 转发缓存 |

代码：[子请求组装](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/connectors/by-framework-common/src/index.ts:105)、[SDK enqueueAgentReturn](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/worker.js:514)。

**这里没有把原始 Super 消息 `M` 作为子请求的 parentMessageId。** 回调目标是委派根 `D`；业务上靠 `delegation_id` 找原 Run，最终靠 `#markOriginalExecutionFinished` 再同步原始 execution。SDK 按 `D` 查 execution，查不到会使用其 fallback（已有 ID、traceId 或生成 ID）；不能保证总是接回原始 execution，也不能笼统地说必定生成独立 execution ID。能确定的是：回调有新的命令处理上下文。

## 4. 入站与首次 Leader 执行

| 顺序、函数 | 做什么 | 校验、失败或分支 |
|---|---|---|
| [ByFrameworkWorkerRuntime.start](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-runtime.ts:91) | 启动 Runner、确认在线、启动持久取消同步及超时结果投递循环 | 启动超时或 Runner 退出会影响 readiness |
| [ByFrameworkRecoveringRunner.poll / recoverPending](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-recovering-runner.ts:38) | 读新的控制消息；每 5 秒尝试接管符合条件的 pending | 默认闲置至少 30 秒；其他健康 Worker 的 pending 不抢；已有传输租约的不处理 |
| [ByFrameworkRecoveringRunner.processAndAck](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-recovering-runner.ts:78) | 以 targetAgentType/sessionId/messageId 建 Redis 传输租约；续租；设置 AsyncLocalStorage delivery scope；调用父类 | 租约未拿到就退出，留 pending；失去租约中止当前投递；本函数不是业务 Run 租约 |
| [SDK WorkerRunner.processAndAck](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/runner.js:605) | 处理控制命令、Resume gate、注入会话历史、查/建 execution、写 RUNNING、调用 worker.handleMessage；返回后写结果状态再 XACK | 普通 Ask 的已终态重投跳过；Resume 不因 execution 曾终态而跳过；抛异常时不会走到 ACK |
| [SDK GatewayWorker.handleMessage](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/worker.js:96) | 创建 AgentContext、恢复 Resume metadata、调用 hooks、处理取消、执行业务 processCommand；处理回传和流终止 | 有上游、是否 suspended、是否终态、是否已结束流，共同决定是否发回调/结束帧 |
| [ByClawSuperGatewayWorker.processCommand](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:624) | Ask 交 `#askCommandHandler.handle`；Resume 交 `#resumeCommandHandler.handle` | 未知命令抛错；异常统一进入 `#handleCommandFailure` |
| [ByFrameworkAskCommandHandler.handle / #parseCommand](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:239) | 解析正文、附件、模型覆盖、来源 Agent、Token；恢复投递可复用原 Run/owner | 缺 Beyond-Token 报错；恢复的专家团身份不匹配报错；取消预检查 |
| [#createRun](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:330) | 传外部 session/message/trace、sourceAgentId、relModelId、metadata 给 ingress | 来源 Agent 是本轮入口，不是下一位被委派员工 |
| [RunIngressService.createIngressRun / createSessionRun](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/ingress/run-ingress-service.ts:132) | 鉴权；加载编排、员工授权列表和上下文；排除自身；建立 Run 快照；执行凭证单独保存 | 普通 Super 员工列表加载失败可降级为空；专家团运行配置失败阻断 |
| [loadRunOrchestration / loadLeaderModel](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/ingress/run-ingress-service.ts:493) | 专家团用专家团运行配置；普通 Super 按入口资源确定 Leader 模型；优先尝试 relModelId | 覆盖模型解析失败会回退入口资源模型；没有 sourceAgentId 或 resolver 则用默认路径 |
| [ByClawBeResourceModelResolver.resolve / resolveByModelId / resolveLeaderModelSelection](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/business/resource-model-binding.ts:32) | 资源详情 `prologue.modelId` 或直接模型 ID → Redis 配置 → `{modelId, defaultThinkingLevel?}` | 资源或模型记录不合法报错；**旧 SHA-256 计算已删除** |
| [RunService.createIngressRun / #createSessionRun](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:388) | 原子解析外部会话绑定、消息去重、创建 Run 和执行凭证；调用 #scheduleRun | 同一外部消息复用已有 Run；本轮 agentList/ingressContext 持久化 |
| [Ask handler #registerRun / #executeRun](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:361) | 注册 Redis 取消路由；监控取消；进入 #forwardRunEvents 转发事件 | 事件投递错误会包装成可重试投递；并非等待某个 callAgent Promise |

### Run 领取与 Leader 创建：首次和回调后都会走

| 函数 | 做什么 | 会停止执行的条件 |
|---|---|---|
| [RunService.#scheduleRun / #kickPersistentQueue](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:902) | Run 行作为队列；通知并领取可执行 Run；无持久队列时才走内存 #pump | 同进程同一 Run 旧调用栈未退出时不重叠启动；持久队列错误记录后等下一次轮询 |
| [PostgresRunExecutionQueue.claimNext](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/storage-postgres/src/postgres-database.ts:985) | 按 Session 排序并领取；校验前面没有未结束 Run；获得 Session lease；增加 attemptNo/fencingToken；更新 baseContextRevision | 有有效 lease 或更早未结束 Run 时不能领取；单实例同样使用这些检查 |
| [RunService.#executeClaim](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:930) | 启动数据库续租；按 lease 读取执行凭证和 metadata；写 `run.attempt`；调用 #execute；finally 释放 lease | 缺凭证写 `EXECUTION_CREDENTIAL_MISSING`；lease 丢失只停本次 attempt；取消走取消终态 |
| [RunService.#execute](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:1056) | 读取 Session；调用 leaders.create(session.id, latestLeaderModel(run))；检查上下文 revision；恢复 Delegation；构造 LeaderRunInput | Session 不存在、上下文 revision 不一致、模型创建失败都可能变成 run.failed |
| [LazyPiLeaderFactory.create / #factoryForModel](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/runtime/lazy-pi-leader-factory.ts:26) | 每次 attempt 创建模型工厂和 Pi Leader session | 没配置模型 resolver 时报错；当前没有按指纹复用旧工厂 |
| [createOrchestration 中的 modelConfig 回调](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/runtime/index.ts:195) | 按本轮固定的模型资源 ID 重新读取当前模型配置，组装 PiRuntimeConfig | **旧“重新计算指纹并与入站指纹比较，不同即抛错”在这里，现已删除** |
| [RedisFirstLlmProvider.resolveByModelId / buildRedisProvider](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/llm-provider/redis-llm-provider.ts:87) | HGET `byai:aimodel:config` 的模型 ID field；解析 JSON、解密 Token、规范化模型参数 | 记录缺失、非对象、status 非 1、必要字段缺失、解密失败仍报错；指定 ID 路径不回退默认模型 |
| [RedisFirstLlmProvider.resolve](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/llm-provider/redis-llm-provider.ts:66) | 无固定模型选择时，从 `byai:aimodel:typelist` 的 `LLM` 列表选默认模型 | 此默认路径读取失败会回退环境模型；与指定 ID 路径行为不同 |
| [PiLeaderSessionFactory.create(config)](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/pi-leader.ts:74) / [createPiModelRuntime](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/pi-model-provider.ts:64) | 注册当前 Provider、选择可用模型；建立缓存目录 | 目标模型不可用/认证配置不可用时报错 |
| [PiLeaderSessionFactory.create(sessionId)](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/pi-leader.ts:112) | 新建 attempt 临时目录；从 PostgreSQL 读取 **committed** checkpoint；无 checkpoint 才创建空会话 | 不从先前内存对象接着 await；不调用 loadWorking 恢复挂起时的 pending transcript |
| [materializePiSessionCheckpoint / validatePiSessionCheckpoint](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/pi-session-checkpoint.ts:86) | 校验版本、checksum、树结构，重建 JSONL，再 SessionManager.open | SDK 版本要求当前代码的 0.80.10；会话格式、checksum、结构不兼容均拒绝；与模型指纹是独立机制 |
| [PiLeaderSession.create](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/pi-leader-session.ts:81) | 注册 delegateAgent 等工具；注入上下文编译、请求适配；向 createAgentSession 显式传 selected model 与 sessionManager | 恢复 checkpoint 后仍显式使用当前选出的模型 |

## 5. Leader 发起委派，到 callAgent 发布完成

| 顺序、函数 | 输入与动作 | 返回/校验 |
|---|---|---|
| [PiLeaderSession.run](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/pi-leader-session.ts:488) | 设置 activeInput；应用本轮 thinkingLevel/可用工具；同步群聊记忆；必要时压缩上下文；session.prompt | 同一 Leader 已有 active run 会拒绝；模型/持久化错误可中止；结束无正文会失败 |
| [delegateAgent.execute](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/pi-leader-session.ts:96) | 工具参数 agentId/task/expectedOutput/attachmentIds → activeInput.delegate | `executionMode: sequential`；当前按单活动委派设计；没有用 SDK task group 并行调两个员工 |
| [RunService.#execute 中 delegate 回调](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:1302) | 暂停本 attempt 的 Leader 增量入库；合并 Run/tool abort signal；校验附件选择；加入项目上下文；调用 DelegationService.execute | 未知 attachmentId 报错；可接管错误使 Run controller abort；callback 挂起后不会走 SYNTHESIZING 返回分支 |
| [DelegationService.execute / #execute](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/delegation-service.ts:140) | 检查 agentId 在本轮授权快照内；找 Connector；按 agentId/task/expectedOutput 和 recoverDelegationId 匹配历史委派 | 未授权、Connector 不存在、不支持附件、指定恢复对象找不到会失败；允许 reuseCompleted 时复用匹配终态结果 |
| 同一 #execute：创建/恢复 Delegation | 新委派先落 `QUEUED` 和 `delegation.started`；已有 externalRef 调 connector.resume，否则 connector.start | 先落委派后发外部请求；持久化版本和 Run lease 限制写入 |
| [CodeByFrameworkConnector 构造器](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/connectors/code-by-framework/src/index.ts:14) / [OpenClawByFrameworkConnector 构造器](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/connectors/openclaw-by-framework/src/index.ts:14) | Code 路由 `BYCLAW_CODE_${userCode}`；OpenClaw 优先员工配置 targetAgentType，否则 `BYCLAW_EXE_${userCode}` | 目标员工资源 ID 另放 extraPayload.agent_id，不等同于路由类型 |
| [ByFrameworkConnector.start](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/connectors/by-framework-common/src/index.ts:105) | 组装 child session、trace、`D:request`、metadata、附件正文；调用 #callAgent | `waitForReply: true`、parentMessageId=D、`WAKE_AND_WAIT`、availabilityTimeoutMs=60000；返回 FAILED 则抛错 |
| [createIdempotentCallAgent](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/connectors/by-framework-common/src/idempotent-dispatch.ts:48) | 项目自定义包装：固定 messageId、路由和 execution ID；已保存路由直接走恢复发布；否则调用 SDK callAgent | 禁止 QUEUE_ONLY/WAKE_AND_QUEUE；取消 tombstone 阻止发布；历史 execution 冲突保守拒绝 |
| 同一包装中的 SDK deps 替换 | execution.init 先缓冲；bus.publish 固定路由、初始化 registry，再发布 | **主动去掉 SDK waitIndex 依赖**，不登记第二套回调等待索引；回调结算以 PostgreSQL 为准 |
| [SDK callAgent](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/dispatch/dispatch_ask_agent.js:37) | 解析 ID；buildAskAgentPublishArtifacts；availability.prepare；execution.init；publishWithExecutionRecord | 可用性拒绝返回 FAILED；成功返回 QUEUED/runtimeHint；不监听子 Agent 的最终回答 |
| [SDK buildAskAgentPublishArtifacts](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/dispatch/ask_agent_build.js:34) | 创建 AskAgentCommand、执行记录和目标 ctrl stream；waitForReply=true 时保留 sourceAgentType | 回调方向依赖 sourceAgentType；本项目另外覆盖发布和执行记录持久化 |
| createIdempotentCallAgent.publish + INITIALIZE_EXECUTION/PUBLISH_ONCE Lua | registry 先用 HSETNX 初始化；目标 ctrl stream 内原子执行“检查取消、检查 receipt、XADD、写 receipt” | registry 与 ctrl stream 不同 slot，所以不是一个跨 slot 事务；路由/receipt 没有自动 TTL；Redis 结果不确定时抛 ConnectorDispatchUncertainError，保留可恢复状态 |
| ByFrameworkConnector.start 返回 | `{completionMode: callback, ref, cancel}`；ref 带 childSessionId/messageId/trace/targetAgentType 等 | 这个返回仅代表派发已受理 |
| [ByFrameworkConnector.resume](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/connectors/by-framework-common/src/index.ts:236) | 从 externalRef 重建 callback 句柄和取消能力 | 校验 childSessionId/targetAgentType；不重新发布 Ask，也不读取子 Agent 结果流 |

注意：Connector 传的 60000ms 是等待目标可用的上限请求，不是子任务完成超时。SDK [clampInlineWait](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/dispatch/dispatch_ask_agent.js:24) 还会把它限制为 Worker online lease TTL 的三分之一；SDK 默认 TTL 为 15 秒，即默认限制到 5 秒，可受其环境配置影响。

## 6. 派发之后，原 processCommand 怎么退出

| 顺序、函数 | 持久化/控制动作 | 结果 |
|---|---|---|
| [DelegationService.#execute callback 分支](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/delegation-service.ts:413) | 校验返回 completionMode 与 Connector 声明一致；登记取消句柄；保存 externalRef，Delegation 变 RUNNING；停止 first-activity 计时 | 收到受理结果后不再使用事件流 idle timer 等 callback |
| [#checkpointCallbackWait](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/delegation-service.ts:1015) | callbackMs>0 时持久化绝对截止时间；恢复不延长期限 | 默认 callbackMs=0，不建立回调截止时间 |
| DelegationService.#execute | 抛 `DelegationSuspendedError(runId, delegationId)` | 正常控制流程，不是业务失败；极快回调已落终态时也抛挂起异常退出旧栈 |
| [delegateAgent.execute catch](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/pi-leader-session.ts:132) | 保存 suspendedDelegation；abort 当前 Pi turn | 避免模型继续生成假结果 |
| [PiLeaderSession.run 结束检查](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/pi-leader-session.ts:805) | 等待 token/checkpoint 写入；发现 suspendedDelegation 则转抛 LeaderRunSuspendedError | 不返回普通最终回答 |
| [RunService.#execute catch](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:1622) | 丢弃当前 attempt 的 pending checkpoint；调用原子挂起接口 | **本轮被中断的 Pi 工具调用 transcript 不成为 committed 会话** |
| [PostgresRunExecutionQueue.suspendRunForDelegation](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/storage-postgres/src/postgres-database.ts:1166) | 校验 lease、Run version；Run 改 WAITING_AGENT/CONNECTOR_WAITING；同事务追加 run.status 和 run.suspended | 回调已先到或 Run 已非 RUNNING 时不覆盖，避免把 QUEUED 改回等待 |
| RunService.#executeClaim finally | 释放数据库 Session lease，清理本地活动栈/临时 metadata | 子 Agent 继续独立执行 |
| [#forwardRunEvent / #waitingAgentResult](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:990) | 读到 run.suspended，返回 WAITING_AGENT、空 content、null replyData | 没有 FINAL_ANSWER 和 APP_STREAM_RESPONSE；若初始 Ask 先看到 resumed QUEUED，也返回等待让 Resume 接管输出 |
| #forwardRunEvents → SDK handleMessage → processAndAck | 保存转发游标和等待结果；本次 processCommand 返回；框架记状态并 ACK 此控制消息 | **原 Ask 的 Redis 消息已可确认，但用户整轮对话还没完成** |

## 7. 子 Agent 完成，谁生成唤醒消息

| 函数/边界 | 逻辑 | 失败后果 |
|---|---|---|
| 子 Agent 的控制流消费者 → 其业务 processCommand | 消费 `D:request` 并执行员工任务，返回 AgentTaskResult | 具体员工实现取决于部署类型/版本，不能从 Super 源码断言其内部函数 |
| [SDK GatewayWorker.handleMessage 返回处理](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/worker.js:245) | 根据原始 sourceAgentType 及是否真正 suspended 决定回传；终态优先于 suspended | 若子 Agent 使用不同语言/版本，应核对其等价实现；本地 TS SDK 提供这里的协议依据 |
| [resolveReplyCommand](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/worker.js:422) | 子 Agent 自己也经历过 Resume 时，从 execution 快照重建原调用方，避免把结果回给刚完成的下游 | 不直接用本次 Resume.sourceAgentType 猜上游 |
| [enqueueAgentReturn](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/worker.js:514) | 构造 Resume：messageId=D、parentMessageId=D:request、target=BY_SUPER，带 status/replyData/content/metadata | 保留调用时 metadata，再用返回 metadata 覆盖同名项 |
| [persistSingleCallResult](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/worker.js:590) | 非 task-group 调用把结果另存 Redis task_group_results | 备份保存失败只告警，不阻止回调发送 |
| [xaddWithRetry](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/worker.js:549) | 把 Resume 发布到 BY_SUPER ctrl stream，有限次数重试 | 成功路径发布失败会向外抛；SDK 异常/取消路径对回传失败的处理不同，不能保证单靠该步骤永不丢唤醒 |

子 Agent 的 FINAL_ANSWER 展示事件不是 Super 的恢复输入。Super 这里消费的是控制流 Resume 的 **replyData**。COMPLETED 要求 replyData 是字符串，即使 content 有字、replyData 是对象，也会被当前解析器拒绝。

## 8. Super 收到 Resume：检查、结算、重新排队

前半段再次经过 RecoveringRunner.processAndAck → SDK WorkerRunner.processAndAck → GatewayWorker.handleMessage → Super.processCommand。

| 顺序、函数 | 做什么 | 明确分支 |
|---|---|---|
| [SDK consumeWaitEntry](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/liveness/wait_gate.js:154) | Runner 先处理 SDK wait gate | 已消费 marker 可使回调被丢弃并 ACK；未注册等待允许通过。本项目新派发主动不注册 waitIndex，因此通常依靠 PostgreSQL 去重 |
| [SDK restoreInboundMetadata](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/node_modules/@byclaw/by-framework/dist/worker.js:467) | 用 execution 中原 metadata 作为底，再覆盖本次 Resume metadata | 原 execution 查找键是本次 messageId=D，不一定是原始 M |
| [SuppressResumeStatePlugin.onTaskStart](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:196) | 拦掉 SDK 自动 RESUMED 展示帧 | 只影响展示，不负责业务唤醒 |
| [ByFrameworkResumeCommandHandler.handle / classifyResumeCommand](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-resume-command-handler.ts:137) | 有 interaction_id + parent_run_id 优先分流用户交互；否则解析子 Agent 回调 | 无法路由、协议非法分别走失败收口 |
| [parseChildAgentResume / resumeFinalAnswer](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-resume.ts:32) | status 必须 COMPLETED/FAILED/CANCELLED；sourceAgentType 非空；取 metadata.delegation_id 或从 parentMessageId 去掉 :request；严格校验两者对应 | COMPLETED.replyData 必须是 string；FAILED/CANCELLED 也接受带 error/reason 的对象；不是任意 JSON 都能作为成功结果 |
| [DelegationCallbackResumeHandler.handle](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-resume-command-handler.ts:286) | 用 delegationId/status/finalAnswer 调 runService.resumeDelegation，然后分派 settlement outcome | **这里先结算和排队；后面的 authorizeResumeRun 才做访问鉴权**，次序不能描述成“先鉴权再恢复” |
| [RunService.resumeDelegation / #resumeDelegationAtomically](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:607) | 规范化 status；生产 PostgreSQL 使用 queue.settleWaitingCallback；补事件边界；run_resumed 时调度 | 无原子接口才走 #resumeDelegationWithRepository 测试/内存分支，两者不可混说 |
| [PostgresRunExecutionQueue.settleWaitingCallback](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/storage-postgres/src/postgres-database.ts:1380) | 用 D 找 R；锁 Run 事件序列，再锁 Delegation/Run 行；写员工终态和 result，追加 delegation.completed/failed | D 不存在、已结算、超期、Run 不可恢复分别返回不同 outcome |
| 同一数据库事务的 wakeRun 判断 | Run=WAITING_AGENT 且 stage=CONNECTOR_WAITING，或 Run=RUNNING（处理极快回调）时改 QUEUED/CONNECTOR_WAITING；追加 resumed run.status；NOTIFY | 其他可保存阶段只返回 delegation_settled，不启动第二份事件转发；CANCELLING/COMPLETED/FAILED/CANCELLED 不恢复 |
| [#resumeBoundaryEventId / #scheduleQueuedRun](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:697) | 找该 D 的挂起/开始事件 ID；Run 仍 QUEUED 才调度 | 事件 ID 是挂起事件本身，不是“挂起 ID+1”或回调事件 ID |
| [DelegationCallbackResumeHandler.#handleSettlement](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-resume-command-handler.ts:327) | run_resumed → authorizeResumeRun → forwardRun；普通重复回调只返回完成并抑制结束帧；可信 pending 恢复的重复回调重接事件流 | delegation_settled 不重接；not_found/expired/not_resumable 进入 #rejectSettlement，必要时 terminate Run 后输出失败 |
| [authorizeResumeRun](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-resume-command-handler.ts:593) / [RunIngressService.authorizeRun](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/ingress/run-ingress-service.ts:423) | 正常回调要求 Beyond-Token，解析 owner 并查拥有的 Run/Session；可信 pending 恢复可核对外部 session、trace、user 后复用已鉴权持久状态 | 缺 Token/owner 不匹配仍可能阻断转发；此时前面的结算可能已经提交 |

协议解析目前只要求 sourceAgentType 非空，未在 parseChildAgentResume 内把它与所找 Delegation 的目标类型做相等比较；它也没有在该函数内校验 metadata.parent_run_id 与 Delegation 的 runId 一致。实际 Run 以 Delegation 数据库关联为准。这是当前边界描述，不表示生产发生过串单。

## 9. 唤醒后 Leader 实际拿到什么

恢复的 Run 重新经过 claimNext → #executeClaim → #execute → leaders.create；即使单实例也一样。

[RunService.#execute 的恢复分支](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:1127) 按以下次序执行：

1. `attemptNo > 1` 或 executionStage 为 CONNECTOR_WAITING/LEADER_SYNTHESIZING 时，读取该 Run 所有 Delegation 和历史事件。
2. 对尚未终态的 Delegation 按持久化参数恢复：从 delegation.started 重建附件选择，调用 DelegationService.execute，指定 recoverDelegationId。恢复 callback 句柄后如果仍要等，就再次挂起；不会强行让 Leader假设它已完成。
3. 收集所有终态 Delegation 的 agentId/agentName/task/status/result。
4. 用“原始用户输入 + 已完成委派 JSON + 不要重复相同委派、继续缺失工作并总结”的新消息调用 Leader。**回调结果不是注入原 Pi 工具调用 Promise，而是重新组织成一次 prompt。**
5. 从 committed checkpoint 恢复历史；本轮挂起时的 pending checkpoint 已丢弃。结果连续性依赖原始输入、持久委派记录和这个恢复提示。
6. Leader 若调用第二个员工，重复第 5、6 节的派发/挂起过程；若回答完成，进入第 10 节。
7. 若已有 ACTIVE 任务计划，Leader 普通回答之后最多再续跑 3 次；仍 ACTIVE 时尝试结束计划。这是另一项项目级行为，不能把“模型已输出一次答案”等同于 Run 必定已完成。[续跑条件](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:1543)

## 10. 最终回答如何结束用户流

| 函数 | 完成路径 | 失败/特殊路径 |
|---|---|---|
| [RunService.#execute 完成分支](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:1577) | 非空回答 → 构造 COMPLETED/SETTLED Run 和 run.completed；有 checkpoint 时原子 commit | 空回答失败；abort 后即使模型 resolve 也不能写成功 |
| [PostgresLeaderCheckpointStore.commit](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/storage-postgres/src/postgres-database.ts:1887) | 检查 checkpoint、容量、lease、expectedRevision、历史前缀；提交会话 revision、Run 与完成事件 | revision 冲突、前缀不一致、容量超限、过期执行权均拒绝 |
| [RunService.#finishFailed](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:1877) | 写 FAILED/SETTLED 和 run.failed；丢弃 pending checkpoint；同步失败计划 | 可接管错误不走普通失败；已有终态不覆盖；CANCELLING 保留取消意图 |
| [#forwardResumedRun](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:765) | 传 afterEventId 和固定 summaryMessageId 给 #forwardRunEvents；返回后同步原始 execution | 普通转发异常包装 WorkerDeliveryRetryError，保留控制消息 pending |
| [#forwardRunEvents](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:833) | 加载 Redis 缓存；决定复用结果/继续；从 max(请求边界, 已保存游标) 读事件；逐事件保存 state/游标/结果 | **修复前相等边界会误复用 WAITING_AGENT；现已允许相等边界继续读取，见第 14 节**；无终态就结束事件流会抛异常 |
| [RunService.streamEvents](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:599) / [PostgresRunEventStore.stream](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/storage-postgres/src/postgres-database.ts:796) | 从指定事件 ID 之后读取持久事件并等待后续事件 | 它们负责内部 Run 事件，不是子 Agent 展示用 DataStream |
| [#forwardRunEvent](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:917) | 转发委派状态卡；处理 Leader 增量；按 suspended/completed/cancelled/failed 分支返回 | Resume 在 run.attempt 前忽略旧 token；初始 Ask 委派开始后忽略迟到 token；用户交互期间也抑制增量 |
| [ByFrameworkRunPresenter.forwardOwnedEvent](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-run-presenter.ts:37) | delegation.started/completed/failed 和交互事件转换为 Super 展示卡 | 子 Agent 正文流由子 Agent 负责；不能因看见子 Agent 最终正文就认定 Super 已消费回调 |
| [#forwardAnswerDelta / #emitAnswerDelta](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:1024) | 累积 state.answer；写 ANSWER_DELTA；Resume 写固定 Super 汇总节点 | state 会随缓存延续；本次审计未证明跨多次 Resume 的正文累计是否完全符合期望 |
| [#completeForwardedRun / #finishSummaryStream](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:1091) | 释放活动路由；补正文；发 FINAL_ANSWER，再发 APP_STREAM_RESPONSE；context.setStreamFinished(true)；返回 COMPLETED | setStreamFinished 只抑制框架重复结束帧，本身不向前端发结束消息 |
| [#failForwardedRun / #finishFailureStream](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:1160) | **本轮已修改**：Resume 看到 run.failed 时发错误正文、FINAL_ANSWER、APP_STREAM_RESPONSE，返回 FAILED | 兼容旧指纹错误文本；真实 Redis 投递失败仍应留 pending 重投 |
| [#markOriginalExecutionFinished](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:794) | 用 ingressContext.externalSessionId + 原始 parentMessageId=M 查 execution，写 COMPLETED/FAILED/CANCELLED | WAITING_AGENT 不同步终态；缺原始关联/记录时直接返回 |
| SDK WorkerRunner.processAndAck + acknowledgedRedis.xack | 为本次命令记录最终状态，再验证 pending consumer/租约后 ACK | ACK 与业务执行不是一个数据库事务；抛错保留重投 |

## 11. 没有隐藏在主流程描述里的控制层

| 控制层/函数 | 真实作用与限制 | 来源 |
|---|---|---|
| [DeliveryPluginRegistry](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:148) | 包装 emitChunk/hooks；发数据、完成、回调前检查传输租约；onTaskError 遇到 WorkerDeliveryRetryError 再抛，让 SDK 不把它吞成已处理失败 | 项目自定义 |
| [deliveryRedis](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-delivery-redis.ts:12) | 对 session DataStream XADD、registry HSET 用 Lua 校验 lease；检查 pipeline 内部错误 | 项目自定义 |
| [ByFrameworkDeliveryRegistry.markExecutionFinished](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-delivery-redis.ts:65) | 终态写入与传输 lease 校验一起执行，保留并发取消字段 | 项目自定义 |
| [ByFrameworkDeliveryState.register/resolveRun/resolveTrace/release](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-delivery-state.ts:9) | 保存 message/execution/trace 到 Run 路由；只在 trace 唯一活动 Run 时兜底定位；结束后路由短期保留 | 项目自定义 |
| [ByFrameworkDeliveryState.load/save](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-delivery-state.ts:66) | 保存转发状态和结果；检查 lease、禁止游标倒退；最终状态保留 7 天；等待结果通常无自动 TTL | 项目自定义；直接参与本次相等边界缺陷 |
| [retryWorkerDelivery](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-delivery-scope.ts:21) | 包装错误并在 delivery scope 标记 failure；阻止错误栈继续回传或 ACK | 项目自定义；是重试标签，不能单凭它判断业务根因 |
| [#handleCommandFailure](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:639) | 投递重试/lease 失效继续抛；取消交 SDK；有上游的 Ask 异常交 SDK 回 FAILED Resume；其余补用户失败终态 | 项目自定义 |
| [#rejectSettlement / ResumeRunTerminator.terminate](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-resume-command-handler.ts:364) | 过期/不存在/不可恢复回调明确失败；部分场景取消 Run、释放路由、同步原 execution | 项目自定义 |
| [UserInteractionResumeHandler.handle](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-resume-command-handler.ts:231) | 用户表单 Resume 先鉴权、respondToInteraction；本条命令不关闭用户整轮流 | 与员工终态 Resume 分支不同 |
| [handleCancel / pollPersistedCancellations](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-worker.ts:274) | 按共享路由/DB 找 Run 并取消；后台每秒同步；初始 Ask 还有局部取消监控 | 用户取消可跨等待期生效 |
| [ByFrameworkConnector.cancelPending / #createCancel](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/connectors/by-framework-common/src/index.ts:253) | 持久取消 tombstone；向 framework cancelTask；未返回 externalRef 也能按稳定 messageId 找任务 | 发布确认不确定时仍可阻止晚发/取消远端 |
| [RunService.#sweepExpiredCallbacks](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/application/run-service.ts:858) | 配置开启时按数据库期限结算超时；产生持久超时投递 | 默认 callbackMs=0 时关闭；因此丢失回调/终态转发不能指望默认超时来结束 |
| [ByFrameworkWorkerRuntime.#drainTimeoutDeliveries / #deliverTimeout](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/worker/by-framework-runtime.ts:201) | 领取超时 outbox，发失败正文/结束帧、更新原 execution，然后确认 outbox | 缺路由或投递失败保留 outbox；非普通成功 Resume 路径 |

## 12. 所有已识别的恢复拦截与默认限制

这张表列的是当前源码行为，不代表每一项都是必要设计，也不代表生产每项配置都采用默认值。

| 检查/限制 | 位置与效果 | 当前状态 |
|---|---|---|
| Leader 模型配置 SHA-256 相等 | 旧 runtime modelConfig 回调；密钥、URL、名称、协议、上下文/输出限制、reasoning 等整个规范化配置参与 JSON.stringify 和哈希 | **已删**；旧 Run 的 fingerprint 字段忽略 |
| Redis 指定模型存在、启用、字段/密钥合法 | RedisFirstLlmProvider.resolveByModelId/buildRedisProvider；失败会阻止 Leader 创建 | 保留 |
| 用户鉴权、Run owner、授权员工列表、不能委派自身 | ingress、authorizeResumeRun、DelegationService | 保留；注意回调结算早于正常回调鉴权 |
| 子回调终态、父请求 ID、成功 replyData 字符串 | parseChildAgentResume/resumeFinalAnswer；不符合即失败收口 | 保留 |
| 同 Session 执行顺序、Run/Delegation version、DB lease/fencing | Postgres queue/save/commit；冲突时拒绝旧栈写入 | 保留，单实例同样执行 |
| Worker 投递租约、pending consumer、游标单调 | RecoveringRunner、deliveryRedis、deliveryState | 保留；与数据库 lease 是两套锁 |
| Resume 边界与缓存游标比较 | #forwardRunEvents | **已修复：相等时继续，先前错误地要求严格大于** |
| checkpoint SDK 版本、session format、树/前缀、checksum、contextRevision | pi-session-checkpoint、PostgresLeaderCheckpointStore、RunService | 保留；不是已删的模型配置指纹 |
| checkpoint 容量 | 单 entry 默认 1 MiB；会话默认 16 MiB、20000 entries；stage/commit 会检查 | 保留，受配置控制 |
| 群聊上下文指纹 | [readIngressContext](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/storage-postgres/src/postgres-database.ts:2600) 重算 groupChatFingerprint，不同就抛 `Persisted Run group chat context fingerprint mismatch` | **另有这项校验，仍保留**；只在持久 Run 带 groupChat 时涉及，不能与 Leader 模型指纹混淆 |
| system prompt 诊断指纹 | [context-compiler](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/packages/by-conductor/src/context/context-compiler.ts:89) | 诊断值，不是这里的模型恢复拒绝条件 |
| route/lease/forward key 的 SHA | delivery state、recovering runner、idempotent dispatch 由 ID 组合生成 Redis key | 用来生成稳定键；不读取模型配置做相等拦截 |
| 派发 first activity timeout | 默认 300000ms；callback Connector 只管受理前阶段 | 受理后停止此计时 |
| callback timeout | DELEGATION_CALLBACK_TIMEOUT_MS 默认 0；开启时为绝对截止，不随恢复延长 | 默认禁用；读取实际部署配置才能断定生产是否启用 |
| 事件流 idle timeout | 默认 900000ms | 主要用于 events Connector，不是 callback 完成等待计时 |
| Run lease / 队列轮询 | 默认 30000ms / 500ms | 保留 |
| 活动任务计划续跑 | 最多额外 3 次 Leader.run，之后尝试结束计划 | 保留，可能让一次模型回答后继续运行 |
| 空 Leader 回答、模型不可用、压缩或持久化失败 | PiLeaderSession.run / RunService.#execute | 可导致 run.failed；必须由 worker 正确输出失败终态 |

## 13. 已证实、未证实和待修项

| 事项 | 证据范围 | 结论 |
|---|---|---|
| 原报错涉及模型指纹不一致 | 用户提供 cause 堆栈 + 旧 runtime 比较代码 | 已确认该次 Run 因比较失败；**哪一个配置字段为何变化，仍未查明** |
| 旧 Resume 把普通 run.failed 当投递失败重试 | 旧 #failForwardedRun 抛 Error，#forwardResumedRun 包装 WorkerDeliveryRetryError；现工作区修改及相应测试 | 该错误收口问题已修改；尚未部署 |
| 第二回调边界与上次缓存游标相等 | 真实边界生成/保存代码 + 本地 Worker 回归场景失败 | **独立确定性缺陷，现已修复并回归**；足以在无指纹错误时复现第二次回调不结束 |
| 原测试遗漏这个边界 | 原测试写 10→20，而 first suspended 为 12 | 之前“测试全绿”不能支持“链路已完整解决” |
| 任意模型变化、跨机器、员工自己的模型导致指纹变化 | 没有对应生产配置前后值或写入证据 | 不能当成已经定位的原因 |
| 回调先结算后鉴权、SDK execution 关联、关闭 waitIndex 后的回调补偿 | 源码顺序和配置可确认，未做完整生产故障验证 | 需要单独评估设计，不能自动称为本次故障根因 |

后续若修复第二回调边界，应以“真实 #resumeBoundaryEventId 返回值 + 两个独立 Delegation + 成功/失败终态 + pending 重投”做回归，避免再次用人为增大的 afterEventId 绕过边界。第 14 节记录后续已完成的修复及验证范围。


## 14. 后续修复与验证（2026-09-24）

`#forwardRunEvents` 已将等待结果恢复条件由 `新边界 > 保存游标` 改为 `新边界 >= 保存游标`。相等表示应从上次已处理的挂起事件之后继续，不再返回旧 WAITING_AGENT。更早边界、普通重复回调和已缓存终态仍沿原去重路径处理。

永久回归测试位于 [by-framework-worker.test.ts](/Users/tangs/iwhalecloud/ByClaw/byclaw-super/app/test/by-framework-worker.test.ts:25)：实际 Worker + RunService + DelegationService + CodeByFrameworkConnector 组装，使用内存仓库/队列与 Redis 替身，替代外部 callAgent 传输和真实模型。事件 ID 和回调边界由实际业务代码产生，不在测试中分别编造。

验证了同一 Worker 内：初始 Ask → 员工一派发/回调 → 员工二派发/回调 → Super 成功或失败终态；仅派发两次；原 execution 收到终态；输出一条 FINAL_ANSWER 和一条 APP_STREAM_RESPONSE。另验证员工一重复回调不提前结束、员工二重复回调不重复输出，以及已结算 pending 恢复能在相等边界继续输出失败终态。

修复前，两个链路场景及三个边界回归均失败，实际错误返回 WAITING_AGENT。修复后 Worker 的 53 项测试通过；全量 `pnpm test`（含构建）467 通过、8 跳过。生产逻辑变更仅为该边界条件和注释；修改尚未提交/部署。测试不涵盖真实 Redis/PostgreSQL 网络、真实模型和生产子 Agent，需要部署后验收才能确认生产症状消失。
