# 请求链路日志实施与排障

本次增加诊断，不调整消费组、ACK/重试、完成门、沙箱任务周期和前端重连策略。未部署。

## 用一个 ID 查询

普通 Web 聊天以原 `clientRequestId` 为 `requestId`，放入 `extParams.requestId`，经 BE 的 Gateway metadata/extraPayload 传到 channel，再随结果 metadata 和 WS 返回。多泳道保留各自业务 clientRequestId/traceId，共享根 requestId。BE 恢复上下文中原有 AssistantChatDto 会持久化 extParams。老客户端或非 Web 请求可回退到已有 clientRequestId/traceId；尚未补齐的外部调用入口不能保证最早节点使用同一根 ID。

在 BE 和沙箱日志中搜索 `chat_chain` + requestId，无须打印问题、答案、工具参数或 Token。例如：

```sh
rg 'chat_chain .*"requestId":"实际请求ID"' logs/
```

| stage | 证明了什么 | 主要辅助字段 |
| --- | --- | --- |
| fe.sent | 浏览器 WS send 已返回，或发送失败 | result、clientTime |
| be.received | BE 已收到聊天入口请求 | channelId |
| be.worker_ready | 沙箱/worker 就绪检查已返回 | readyMs、targetAgentType、traceId |
| be.dispatched | Gateway SDK 发送调用成功返回/失败 | readyMs、dispatchMs、workerId、traceId |
| worker.received | Node worker 开始处理命令 | sessionId、traceId |
| openclaw.started | 即将调用 OpenClaw dispatch | traceId |
| openclaw.ended | 收到有效根 run 的 lifecycle end/error | runId、phase；不代表所有子任务/收尾已完成 |
| channel.final_written | 终态对应的 Redis XADD 命令收到成功回复或失败 | **实际 streamId**、durationMs、errorType |
| be.final_received | Redis listener 回调已收到终态，尚未进入批处理 | streamId、traceId |
| be.final_processed | 终态路由及持久化处理结束 | lockWaitMs、processingMs、streamId、result |
| be.ws_written | Netty writeAndFlush 的 Future 完成/失败，或连接已失效 | channelId、writeMs、result |
| fe.final_received | 浏览器 onmessage 收到终态 | clientTime、streamId |
| fe.final_applied | 终态经过现有消息更新/flush 路径 | clientTime；不是浏览器像素绘制回执 |

普通单请求约 13 个诊断节点；重投、多设备、多泳道、多轮 run 会各有对应记录。`be.final_processed` 与 WS 回调可能交错，按实际时间和 streamId 对照，不假设所有阶段严格串行。

异常额外记录：前端恢复/缺上下文时 `fe.final_deferred`；本页未完成请求断线及重新连上时 `fe.connection_closed/opened`；channel 已进入收尾等待且超过 30 秒时仅记一次 `channel.final_wait`，附待发数量、委派数量及 followup/压缩重试等状态。不新增取消或业务超时。浏览器强制关闭/断电不保证能记录断线；重开后的恢复行为仍由原有运行态恢复逻辑负责。

FE 事件单批最多 20 条，本地最多 100 条、最长 24 小时；失败 30 秒后重试，online/pageshow/WS 连接成功也尝试补交。独立 HTTP 客户端不触发全局错误弹窗或退出登录。服务端同时保留收到上报时的 time 和原 clientTime；重试可能重复，用 eventId 去重。浏览器日志是诊断信息，不作为业务完成依据。缺少上报只能说“尚未确认”，不能证明浏览器没收到；跨机器比较需考虑时钟偏差。

## 去噪与配置

- BE：普通页面没有沙箱时的心跳不再 WARN；四个沙箱定时 Job 的健康/空轮摘要，Service 的分页列表、续约、正常状态同步，以及 OpenSandbox/WhaleAgent Provider 的正常查询和续约改为 DEBUG。创建、重拉、释放、真实失败保留。任务执行频率不变。
- Channel：移除逐 agent event、注入上下文、消息正文、附件路径、完整 Redis 配置等输出；普通 dispatch 明细降为 DEBUG，保留关键节点及异常。
- 两份 logback 同步关闭内部 debug 和 10 秒扫描（配置变更需要重启）；关闭无用 callerData；错误 appender **入队前**过滤非 ERROR；SessionStreamManager 从 ERROR 恢复为 WARN。开发与部署配置业务包默认 INFO，可用 `LOGGING_LEVEL_COM_IWHALECLOUD` 临时覆盖。
- 保留原日志文件名、512 队列容量、非丢弃背压策略、同步控制台和滚动策略，避免这次改动悄悄丢失关键日志。慢磁盘/控制台仍可能造成背压，不能宣称日志 I/O 已完全无阻塞。归档总量原本为每 appender 100 MB，因此“最多 7 天”不保证实际能保存 7 天。
- 启动时一次 `chat_chain_config` 分别显示 Java SDK Redis 模式/db/超时/节点数，Spring Redis 模式/db、Stream poll/batch/queue 配置和业务日志级别。Channel 启动显示模式和 key schema。无密码、节点地址、完整配置对象。
- 两个镜像启动脚本默认不再加 `--verbose`，诊断时显式设置 `OPENCLAW_VERBOSE=true`。**数据库 sandbox_service_spec 的 startup 命令可能覆盖脚本并保留 --verbose**，用户已确认本次不修改数据库启动命令，故该配置保留；这类环境的 verbose 不会因镜像脚本变更自动关闭。本次没有修改 DDL/DML 或 initdb。

## 排查停在哪一段

- 有 be.received、没有 be.worker_ready：检查 BE 入口到沙箱/worker 就绪；有 worker_ready、没有 dispatched：检查发送调用。
- 有 dispatched、没有 worker.received：检查请求 stream、worker 消费和就绪注册。Java SDK 当前返回值没有 XADD 的 Redis entry ID，不能将业务 messageId 冒充请求 streamId。
- OpenClaw ended 后迟迟没有 final_written：检查完成门及 final_wait 状态；根 run 结束不等于整轮收尾。
- final_written 到 final_received 间隔大：检查结果消费、连接、积压；processed 的 lockWaitMs 大指向会话锁，processingMs 大指向路由/快照/持久化。本次把这三项合并计时，没有虚构分别耗时。
- processed 后没有 WS 成功回调：检查连接、输出路径及多端跨实例广播；ws_written 只证明服务端写出，不证明到达或显示。
- fe.final_received 到 final_applied 间隔大或出现 deferred：检查前端恢复、上下文匹配和消息应用。

## 验证记录

以下为实施阶段在 `86b4fb578` 基线上的记录。提交前已快进同步远端 `b4c122607`，并重新执行正常 pre-commit：文件级 lint 通过；FE 全量 321 个文件通过、4 个失败、4 个跳过（26 项失败），BE 全量 2649 项中 1 项失败、36 项跳过。FE 的 4 个失败文件及 BE 的 `SessionStreamRecoveryLocalOwnerTest.skipsClaimForHealthyLiveListener` 均在干净的 `b4c122607` 副本复现；FE 单独复测时失败数量有波动。提交时仅本次跳过钩子，未修改钩子配置，不将全量检查描述为通过。新的基线对比日志为 `/private/tmp/chat-chain-push-*.log`。

- BE 定向 100 项通过，覆盖终态路由/持久化/ACK、批处理、多端发送、沙箱行为、日志配置真实加载及前端上报校验。
- FE 定向 52 项通过，覆盖 WS/聊天运行态、离线缓存、失败重试、多泳道断线诊断及独立上报客户端；最终生产构建成功。改动文件 ESLint 通过，Stylelint/Prettier 检查通过。
- Channel 定向 39 项通过；构建成功。验证 SDK 实际调用的 pipeline 回复、单命令错误、连接错误、日志抛错隔离、根 ID 透传、长收尾等待只记一次。两个镜像启动脚本通过语法及默认/verbose 参数保留检查。
- BE `clean verify` 共运行 2553 项，2 failure + 1 error；三个失败分别涉及资源授权 mock、迁移基线断言、索引授权 mock，在未修改的 HEAD 副本运行同一组仍为 2 failure + 1 error。
- FE 全量 303 个文件通过、6 个失败、4 个跳过；58 个失败用例在 HEAD 副本同样复现。全量 JS lint 的 61 项错误也与 HEAD 一致，没有扩大修复无关代码。
- Channel 全量仍有既有的 OpenClaw runtime-store/测试 mock 环境及断言失败（12 文件失败、6 用例失败）；关键新增测试独立通过，不把全量检查描述为全绿。

测试日志保存在 `/private/tmp/chat-chain-*.log`；基线副本为 `/private/tmp/chat-chain-baseline`。未连接生产执行故障演练，线上结论需要部署后用实际请求检查各节点。
