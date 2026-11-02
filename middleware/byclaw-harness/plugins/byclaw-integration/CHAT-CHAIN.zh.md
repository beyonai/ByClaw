# 后端、Harness 初始化与回复回程日志

范围：后端接收并派发请求、Harness 插件初始化、输入领取与执行边界、回复写 Redis、后端消费/持久化/ACK、WebSocket 写出和浏览器应用。日志写入原有进程标准输出/应用日志；浏览器继续使用现有有界诊断缓存和批量上报，不引入监控平台。

## 身份与关联

所有新增日志以 `chat_chain ` 为固定标记，后面是一行 JSON。

| 字段 | 语义 |
| --- | --- |
| requestId | 保留有效客户端关联编号（数字先转字符串）；空值回退 clientRequestId，再缺失由服务端生成 UUID。允许字母、数字、`_.:-`，1～128 字符；不截断无效 ID，避免截断碰撞。它是检索入口，不是唯一性或授权依据。 |
| invocationId | 服务端为本次接收生成的 UUID；同次发起不变。客户端重复 requestId、同会话多次发送、续接复用 traceId 时仍能区分。 |
| ingressRequestId | 后端原有 REQUEST_ID 的快照，供关联既有普通业务/异常日志；缺失时为空，不另造一个。它和客户端 requestId 分开。 |
| dispatchId / attempt | 每次实际 SDK 派发生成新 UUID / 本次发起中的重试序号。重试保留 invocationId；不同尝试的 metadata 使用独立快照。 |
| deliveryId | Harness 为每次进入命令处理入口生成的 UUID。Redis 重投或重复处理保留 dispatchId，但 deliveryId 不同。 |
| traceId / sessionId / messageId | 原有业务轮次、会话和回答消息身份；没有产生时为空，不伪造。 |
| tenantId / scope / userCode | 后端从可信租户上下文和登录用户取得；scope 为 personal/tenant。个人空间 tenantId 为空，用户维度由 userCode 辅助区分。 |
| service / instance | be 或 harness；进程 PID 与 HOSTNAME，定位具体实例。 |

Java DTO 的进程内 ChatChainContext 禁止 Jackson/Fastjson 客户端反序列化和对外序列化。Gateway metadata.chatChain 每次由后端重新生成，覆盖同名入站字段；通过 Java Gateway wire header.metadata 传到 Harness，不依赖 ThreadLocal/MDC。业务 requestId 也与后端原有 REQUEST_ID 日志上下文分开，后者不是跨服务关联 ID。

UUID 提供实际足够的碰撞隔离，不作数学上的绝对唯一承诺。先用 requestId 找入口，再以 invocationId 精确筛选；一次派发看 dispatchId，一次本地消费看 deliveryId。诊断字段不参与租户授权、幂等或业务路由。

## 阶段与耗时

每条日志带 time（UTC Unix 毫秒）、stage、result；请求阶段还带 phase、elapsedMs。回程处理点与浏览器上报不伪造完整请求的累计耗时。start/end 成对的阶段，结束记录增加数值型 durationMs。

| stage | 边界 |
| --- | --- |
| be.received | 后端接受请求，建立服务端身份；WebSocket 在额度检查之前记录。 |
| be.admission | 额度拒绝时的失败记录。 |
| be.prepare | 会话、成员权限、员工和本轮模型选择准备。 |
| be.params | 生成消息身份、初始化事件、组装 Gateway 参数。 |
| be.route | 目标 AgentType 解析的阶段耗时和员工 ID；interface/a2a 分支用单点记录说明不走 Harness，缺少用户上下文也明确记录失败。 |
| be.worker_ready | Worker 检查和必要的冷启动等待；progress 记录 STARTING/WAITING/READY。无回调路径标为 existing_or_not_required，不冒充已发生冷启动。 |
| be.dispatch | 一次 GatewayClient.sendMessage 调用。ok 只表示 SDK 派发成功，不能证明沙箱已收到。 |
| be.worker_restart | 派发失败后重启沙箱并等待 Worker 的过程。 |
| be.dispatched | 本次路由派发的汇总结果，durationMs 包含运行态登记、就绪等待和全部派发尝试。 |
| be.initiate | 参数准备后发生异常的兜底失败记录。 |
| harness.received | Worker processCommand 的最外层入口，早于准入、预处理和内部排队；不是 Redis XREADGROUP 的时刻。 |
| harness.admission | 本地准入检查，进入 handler 就结束，不把模型执行时间计入。 |
| harness.preflight | 交互恢复查询和会话开启观察准备；waiting_user 表示停靠旧交互，不是新 turn 已开始。 |
| harness.queue | 等待同会话/前台队列，开始处理时结束，不包含后续执行。 |
| harness.prepare | 准备 Agent，到投递用户输入之前结束；失败记录错误类型。 |
| harness.model_resolve | 本轮根 Agent 模型解析。 |
| harness.agent_open | 根 Agent 创建、恢复或复用。 |
| harness.input_submit | 普通根请求/定向子会话的输入投递。 |
| harness.turn_started | 将实际输入消息 ID 与 agent/inbox/claimed 中的消息 ID 和 response Session 同时匹配后的单点记录。后台 turn/start 不足以证明当前请求开始；steer 可进入既有 turn。 |
| harness.initiate | 实际输入尚未被领取时失败的兜底记录。 |
| harness.resume_handoff | Resume 返回后的交接结果，handoff 表示唤醒旧执行，reconstructed 表示完成冷恢复；单点记录，不计为新 turn 开始。 |

部分分支只出现适用阶段，例如 Resume 热恢复可能只唤醒旧请求，不产生新 turn；不能强求每条请求都经过所有阶段。原有后台/群任务直接调用 ScriptService 的路径在 params/route 处建立身份，不伪造不存在的 WebSocket 入口。

- durationMs：本进程内该阶段的单调时钟差；Java System.nanoTime、Node process.hrtime.bigint。
- elapsedMs：本进程收到该次请求/命令后累计耗时。后端与 Harness 各自从零开始，不能直接相减。
- 跨容器 UTC 时间仅辅助排序，依赖机器校时；不把时间戳差当作精确 Redis 排队耗时。
- 日志可能交错；按身份、阶段和开始/结束配对，不能用相邻两行相减。
- 失败日志保留 errorCode/errorType；不打印用户正文、完整 metadata、认证头或原始异常消息。结合相同时间的既有业务异常日志定位细节。诊断输出失败不改变业务结果。

## 手工排查示例

以下编号和耗时为示意。假设后端记录：

```text
requestId=r123 invocationId=789801ba-4e40-47b1-b7f7-1c77d50bbd0a
be.received       point ok
be.prepare        end   ok       durationMs=20
be.params         end   ok       durationMs=15 traceId=...
be.route          end   ok       durationMs=10 targetAgentType=BYCLAW_DSH_demo
be.worker_ready   start running
be.worker_ready   end   ok       durationMs=12000 mode=cold_start
be.dispatch       end   failed   attempt=1 dispatchId=<D1>
be.worker_restart end   ok       durationMs=1500
be.dispatch       end   ok       attempt=2 dispatchId=<D2>
```

1. 先在后端日志按 requestId 或会话 ID 找入口，取得 invocationId。相同 requestId 可能有多个入口，结合租户、用户、时间选择。
2. 用 invocationId 同时搜索后端和对应沙箱日志。Docker 示例（替换容器名）：

```bash
docker logs --since 30m byclaw-be 2>&1 | rg -F '789801ba-4e40-47b1-b7f7-1c77d50bbd0a'
docker logs --since 30m harness-demo 2>&1 | rg -F '789801ba-4e40-47b1-b7f7-1c77d50bbd0a'
```

不知道沙箱容器名时，可在部署主机逐个筛选，保留包含关联编号的日志；已停止但尚未删除的容器也可查：

```bash
for container in $(docker ps -aq); do
  matches=$(docker logs --since 30m "$container" 2>&1 | rg -F '789801ba-4e40-47b1-b7f7-1c77d50bbd0a')
  if [ -n "$matches" ]; then
    echo "container=$container"
    echo "$matches"
  fi
done
```

Kubernetes 可先按后端/沙箱工作负载 selector 取日志再筛选；Pod 重启后补查 `kubectl logs --previous`。多主机分别执行相同检索。未采集的已删除容器日志、轮转前的日志无法靠这些埋点恢复。

3. 检查 Harness 中 dispatchId=<D2> 的 harness.received，再看同 deliveryId 后续阶段，例如：

```text
harness.received      point ok       dispatchId=<D2> deliveryId=<C1>
harness.admission     end   ok       durationMs=0
harness.preflight     end   ok       durationMs=5
harness.queue         end   ok       durationMs=800
harness.prepare       start running
harness.model_resolve start running
harness.model_resolve end   failed   durationMs=30000 errorType=TimeoutError
harness.prepare       end   failed
harness.initiate      end   failed
```

这说明第二次派发已进入沙箱，内部排队 800ms，失败发生在模型配置解析阶段，不能归因于 Redis 没消费。

- be.worker_ready 只有 start：优先查沙箱启动、注册和就绪等待。
- be.dispatch 为 ok，但无 harness.received：检查目标 AgentType、Worker 健康、Redis 控制流消费，也确认容器日志是否完整；缺日志不是消息丢失的充分证明。
- harness.received 后 queue 无 end：检查前一轮和内部排队。
- harness.prepare 未结束：找最后一个子阶段 start，结合错误日志。
- 相同 dispatchId 出现多个 deliveryId：发生重复消费/重投递，分别看各次本地处理。
- 看到精确匹配输入的 harness.turn_started：本次发起已走通；不代表模型已经回复。

## 新增初始化与回程字段

| 字段 | 如何用 |
| --- | --- |
| startupId | 每次插件激活生成的 UUID；重启或重新激活会更换。同进程多个插件实例也各自独立。该启动注册的 Worker 收到命令及其回程会携带此 ID，可从一次消息跳回其启动过程。 |
| replyEventId / eventSequence | Harness 每次输出生成一个 UUID 和该 delivery 内的递增序号。第一段输出、每类流约每 30 秒、finalAnswer、appStreamResponse、error 是日志检查点；每个事件仍带编号。不是协议幂等键。 |
| streamId | Redis 实际 XADD 返回的 ID；与后端消费、ACK 对照。 |
| frameId | 一次逻辑 WebSocket 帧的编号；同帧跨实例转发、发给多个设备保持相同；另一次构造帧另编号。一条输出可能拆成多帧。 |
| sessionId / traceId / messageId | 原始命令归属，保留不变。traceId 可能续接，不能代替 invocationId。 |
| eventSessionId / eventTraceId / eventMessageId | 实际 Harness 输出携带的业务编号。工具卡片的 messageId 与最终回复不同是正常情况。 |
| externalSessionId / sessionScope | 外部子会话及父子归属；子会话映射成本地会话后，不能要求其 sessionId 与根命令相等。 |
| targetInvocationId / targetSessionId / targetTraceId / targetMessageId / targetClientRequestId | 后端实际命中的处理上下文、会话、回答、lane；它们与源身份分开保留，便于发现错误路由。部分无上下文/外部子会话路径只在后续帧中提供实际目标。 |
| frameClientRequestId / targetTenantId | 帧实际携带的 clientRequestId、目标租户；be.ws_written 的 targetTenantId 取实际 Channel 属性。个人域为空，结合 scope 判断。 |
| appliedSessionId / appliedTraceId / appliedMessageId / appliedClientRequestId | 前端实际应用到的对象；仅适用字段才记录。applyDelayMs 为同浏览器从接收到应用的单调时钟差。 |

`harness.reply_publish` 衡量 SDK/emitter 调用，可能包含历史写入，不等于 Redis 已写成功。`harness.redis_written` 检查实际 pipeline 内的 XADD 返回值，能记录“exec 返回但某条命令失败”的情况；只观测，不修改 SDK 原有错误处理。Redis 写失败会额外记录，普通成功 token 不逐条打日志。

`be.ws_route` 记录本实例匹配的 Channel 数与发起写出的数量；`no_local_match` 可能是客户端连接在其他实例。`be.reply_broadcast` 记录跨实例 Pub/Sub 发布结果和耗时，subscriberCount 只是 Redis 订阅数，不能当成浏览器交付确认。继续用同一 frameId 查接收实例的 be.ws_written。

最终正文 `finalAnswer` 与终止标记 `appStreamResponse` 是两个事件，各有 replyEventId。需要同时检查；有终止标记不证明正文成功交付。SDK 在 processCommand 返回后发送的最终事件仍使用原始命令的归属，不依赖当时的全局异步上下文。

## 场景一：发消息后一直卡住

先按 requestId/会话、时间、租户找到 be.received，取得 invocationId，再复用前面的 Docker 检索命令筛选后端和沙箱日志。**以 invocationId 精确查一次请求，再按 dispatchId、deliveryId 看重试。**

正常主回程检查点大致如下；写 WebSocket 与终止持久化的先后按实际业务流程，不能要求所有行严格串行：

```text
harness.turn_started
harness.step           start / end    operationId=<turn:step> durationMs=...
harness.tool           start / end    operationId=<toolCallId> durationMs=...
harness.reply_publish  start / end    eventType=finalAnswer replyEventId=<R1>
harness.redis_written  end ok         replyEventId=<R1> streamId=100-0
be.reply_received      ok             replyEventId=<R1> streamId=100-0
be.reply_route         ok             targetMessageId=<M>
be.reply_processed     HANDLED        lockWaitMs=... processingMs=...
be.reply_ack           ok             replyEventId=<R1> streamId=100-0
be.ws_written          ok             replyEventId=<R1> frameId=<F1> durationMs=...
fe.reply_received      ok             replyEventId=<R1> frameId=<F1>
fe.reply_applied       ok             appliedMessageId=<M> applyDelayMs=...
... appStreamResponse 对应另一个 replyEventId=<R2>
be.reply_persist       start / end ok durationMs=...
be.reply_ack           ok             replyEventId=<R2>
fe.final_applied       ok             appliedMessageId=<M>
```

| 最后的证据 | 接下来查哪里 |
| --- | --- |
| be.worker_ready 仅 start | 沙箱启动与 Worker 注册；看场景二。未收到请求时还没有 startupId，先按容器、用户、启动时间找。 |
| harness.queue 仅 start | 同会话/前台前一轮执行是否结束。 |
| harness.turn_started 后没有回复 | 看 harness.step 和 harness.tool。tool 有 start 无 end 时按 operationId 查工具；step 有 start 无 end 且无工具记录时查 DSH/模型调用及既有业务异常日志。step 耗时包含模型与工具等整步工作，不冒充纯 API 耗时。 |
| harness.reply_publish 有 start 无 end | SDK 发出或相关历史写入尚未返回；看该 replyEventId 的 Redis 写出结果。 |
| harness.redis_written failed | 实际写 Redis 失败；即使 reply_publish 为 ok 也不能当成功。 |
| harness.redis_written ok，无 be.reply_received | 查相同 streamKey/streamId 的消费者、pending、容器是否重启及日志完整性。不要直接重发业务消息来“修复”。 |
| be.reply_received 后处理迟迟没结束 | 看 be.reply_processed 的 lockWaitMs/processingMs，区分同会话锁等待与业务处理；有 be.reply_persist start 无 end 则定位持久化。 |
| be.reply_persist failed 或无 ACK | 保留 pending 等重试；按 streamId、对应异常和持久化标记查。ACK ok 只证明消费确认。 |
| be.ws_written failed/inactive 或无写出 | 查路由目标、Channel 和连接；对子会话还要检查当前订阅、投影合并/背压。history/ignored/replay 属于不同处理结果。 |
| be.ws_written ok，无前端接收 | 只证明 Netty 写成功，继续查浏览器断线、网络、是否在其他设备。 |
| 前端收到但未应用 | 查 fe.reply_deferred / fe.final_deferred：restoring、missing_context 或 ignored；再核对实际应用目标及旧流过滤规则。 |

外部子会话批次额外记录 `be.reply_child` start/end、耗时及 handled/failed；handled 只证明路由服务返回，不单独证明正文被浏览器渲染。其投影可能合并多个流事件，最终看选中子会话的 NEW_MESSAGE/SCOPED_MESSAGE_DELTA 与应用记录。

浏览器缓存可在当前站点控制台查看，不包含正文：

```js
JSON.parse(localStorage.getItem('byclaw.chat-chain.v1') || '[]')
  .filter(e => e.requestId === 'r123')
```

已成功批量上报的项会从缓存移除，在后端应用日志中按同一 invocationId/replyEventId 查 `fe.*`。`source=browser_report` 表示客户端报告，字段不作为服务端授权或可信租户身份；离线、页面关闭、日志轮转都可能造成证据缺口。`fe.*_applied` 表示应用到前端消息状态，不是屏幕像素确认。

## 场景二：Harness 初始化很慢

1. 从 `harness.received` 的 startupId 找到服务这次请求的那一轮启动；若 Worker 尚未注册，先从 be.worker_ready 的用户/AgentType、时间和容器找到 `harness.startup`。
2. 使用 startupId 筛选沙箱日志，例如：

```bash
docker logs --since 1h harness-demo 2>&1 | rg -F '<startupId>'
```

3. 比较 `harness.startup` 中各 step 的 start/end 和 durationMs：

```text
step=session-metadata    end ok  durationMs=40
step=builtin-skills      end ok  durationMs=120
step=redis-connect       end ok  durationMs=6
step=backend-discovery   end ok  durationMs=15
step=model-catalog       end ok  durationMs=80
step=resource-sync       start running
step=projection:...      point   operationElapsedMs=... intervalMs=...
step=resource-sync       end ok  durationMs=18000
step=resource-sync-result point  degraded=false
step=worker-registration end ok  durationMs=25
step=worker-ready        point   elapsedMs=18350
```

这里耗时集中在资源同步，再看 `projection:*` 的最后阶段、operationElapsedMs 与 intervalMs 缩小到拉取、准备和发布阶段。`intervalMs` 是相邻启动点间隔；measure 的 durationMs 才是该操作自身耗时，嵌套阶段不能求和。不同步骤可以并行，不能把打印顺序当完整调用顺序。

- 某 step 有 start 无 end：该操作尚未返回，或启动中途退出；结合进程重启和错误记录判断。
- step=resource-sync-result degraded=true：资源同步降级保留缓存，不等于已完整同步成功。
- 插件激活很快但后端 worker_ready 很慢：查 Worker 注册、发现、心跳与后端就绪等待，而非归因于模型。
- 以上从插件 apply 开始计时。镜像拉取、容器调度、插件加载之前的耗时需查 Docker/Kubernetes 事件及容器启动时间；processUptimeMs 可辅助识别进程已运行多久。

## 场景三：回复串消息、重复或顺序混乱

例如用户 A 的会话显示了 B 的回答，先按这条输出的 replyEventId（或 streamId/frameId）核对三组事实：

```text
Harness 来源：invocationId=A tenantId=101 messageId=MA eventMessageId=...
后端实际：   targetInvocationId=B targetMessageId=MB targetTenantId=202
前端实际：   appliedSessionId=... appliedMessageId=MB
```

若源归属 A 在 Redis 消费时仍正确，而首次 target* 已变成 B，就从后端上下文恢复、lane/trace 映射和广播路由排查；保留相同 replyEventId，不用错误的目标 ID 覆盖来源。如果 target* 正确、applied* 指向别的对象，就查前端上下文匹配和恢复逻辑。租户比较应看实际 Channel 的 targetTenantId，并区分个人域，不能仅相信浏览器上报的 tenantId。

其他容易误判的情况：

- requestId/traceId 一样但 invocationId 不同：两次发起或续接，分开查；它们不唯一。
- 同 invocationId、不同 dispatchId：后端重试；同 dispatchId、不同 deliveryId：本地重复消费/重新投递。
- 同 replyEventId、同 streamId、不同 frameId：同一事件被再次构造发送、拆帧或重放，需要结合事件类型和路由判断；不是自动认定模型重复生成。
- 同 frameId 到不同 channelId：多设备或跨实例广播，可能完全正常。
- 同 replyEventId、不同 streamId：同一逻辑输出被再次写入 Redis；检查 SDK/发送端重试。
- eventSequence 仅在单 delivery 内递增，日志又是采样检查点，序号跳跃正常；不同 delivery 的序号不能排序比较。
- 根/子会话和工具卡片的 messageId 本来就可能不同；用 sessionScope、externalSessionId、eventMessageId、targetMessageId 和 appliedMessageId 对照映射。
- 如果源与目标都一致但回复内容本身不对，这些日志只能排除已观测边界上的归属错误；模型上下文、历史和工具内容须结合受控的业务记录检查，诊断日志不保存正文。

## 验证

```bash
# 仓库根目录；可选 fixture 参数让 Node 直接读取 Java SDK 生成的 wire JSON。
node --experimental-transform-types middleware/byclaw-harness/plugins/byclaw-integration/scripts/chat-chain-verify.mjs
# 后端测试可通过 -Dchat.chain.fixture=/tmp/chat-chain-command.json 导出脱敏命令，
# 然后将该路径作为上面脚本的第一个参数。
```

另运行 `node --experimental-transform-types middleware/byclaw-harness/plugins/byclaw-integration/scripts/reply-chain-verify.mjs`，验证真实 SDK 的回程序列化、pipeline 部分失败、异步最终事件归属及初始化日志。后端 ChatReplyLogTest 与前端 chatChainLog 测试覆盖多 lane 和实际应用归属。

验证覆盖：Java SDK 序列化、Node 命令反序列化、重复客户端 ID、续接 trace、多租户快照、并发异步上下文、派发重试、Redis 重投身份、精确 inbox 匹配、准入失败、日志输出异常及敏感字段排除。它不建立 Redis/容器端到端或真实模型成功的结论。
