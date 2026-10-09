# 请求链路日志：精简实施方案

2026-09-21。按最新要求收敛：一个查询 ID、少量关键节点、正常后台静默。本方案取代《聊天链路日志与沙箱刷屏审计》中的详细埋点实施建议；原审计仅保留为源码和配置证据。本文尚未实施到运行代码。

## 1. 一个 requestId 查询整条链路

对外统一使用 `requestId`。FE 单路请求直接复用现有 clientRequestId 的值，不再生成另一套随机 ID；多 lane 的一次发送选主入口 ID，各 lane 和子任务继承同一查询根。这个字段仅用于链路关联，不覆盖现有子请求 clientRequestId、业务 traceId 或 runId，也不使用每个 WS 帧临时生成的 REQUEST_ID。

FE → BE → Java by-framework → Redis请求 → 沙箱 Node worker → channel/OpenClaw → Redis结果 → BE → WS → FE，都携带同一个 requestId。重连、消息重投和执行恢复保持不变，写入消息 metadata 和恢复上下文。一次独立的新发起使用新 requestId。定时任务/机器人在最早入口生成或绑定同样的查询根。

用户只需拿到 requestId 查询日志；sessionId、业务 traceId、streamId等只作为必要的辅助字段，不要求人工换ID逐跳搜索。

## 2. 正常请求只记录这些节点

| 节点 | 何时记一条 | 必要补充 |
|---|---|---|
| `fe.sent` | 请求进入浏览器WS发送队列 | 连接标识；不表示BE已收到 |
| `be.received` | BE收到聊天请求 | sessionId、业务traceId映射 |
| `be.dispatched` | 沙箱/worker就绪且请求XADD成功 | sandboxId、workerId、requestStreamId、readyMs、redisWriteMs；由一层负责记录，SDK只返回结果 |
| `worker.received` | Node框架领取请求 | requestStreamId、workerId |
| `openclaw.started` | channel真正开始调用OpenClaw | 准备/排队耗时；核心运行ID可用时绑定 |
| `openclaw.ended` | channel观察到对应root执行终态 | 执行耗时、结果、core事件原时间（若有）、channel队列等待；与dispatch返回/完成门分开 |
| `channel.final_written` | 完成门通过且appStreamResponse实际XADD成功 | streamId、完成门等待、Redis写入耗时；检查pipeline命令结果 |
| `be.final_received` | BE listener收到appStreamResponse | streamId、consumer/实例 |
| `be.final_processed` | 终态快照/持久化处理完成 | lockWaitMs、snapshotMs、persistMs、处理结果合并在这一条 |
| `be.ws_written` | 目标连接的ChannelFuture完成 | 成功/失败/跳过、连接标识、direct/broadcast、写耗时；每个实际目标连接一条 |
| `fe.final_received` | FE收到终态，业务匹配前 | 连接标识、streamId |
| `fe.final_applied` | FE应用终态完成 | receivedToAppliedMs、页面可见性；不宣称用户已看见 |

普通单路、单目标连接约12条，不随token数、心跳次数或执行时长增加。后台/多lane/子任务仅在真实执行边界增加对应记录。BE广播和原连接发送可能先后顺序不同，按实际时间及目标连接还原，不伪造固定顺序。

长步骤内部只维护当前子步骤和开始时间，不逐步打印。阶段失败、超时或超过观测阈值时补一条 `request.issue`，带requestId、stage、当前子步骤、已等待多久和reason。同一次持续等待不循环刷日志；长任务等待不自动认定失败，也不据此取消执行。

## 3. 字段和输出保持简单

固定字段仅需 `time、requestId、service、instance、stage、result`。有处理过程时加 `costMs`，失败加 `reason/error`，相关节点再补上表必要字段。时间精确到毫秒；本进程耗时用单调时钟，跨机器时间比较考虑时钟偏差。

示例为设计格式，不是事故实测：

```text
2026-09-21T10:00:00.120Z requestId=abc service=be instance=be-1 stage=be.final_received result=ok streamId=...
2026-09-21T10:00:00.155Z requestId=abc service=be instance=be-1 stage=be.final_processed result=ok costMs=35 lockWaitMs=1 snapshotMs=4 persistMs=30
2026-09-21T10:00:00.160Z requestId=abc service=be instance=be-1 stage=be.ws_written result=ok costMs=5 connectionId=...
```

FE关键节点使用现有上报通道扩展结构化字段，少量批量上报；断网暂存有限记录，恢复后补交。没有完成上报前，服务端缺FE记录只能标“尚未确认”，不能据此判定浏览器没有收到。普通ACK不另记成功日志；失败必须带同一requestId。底层异常只在负责处理的边界输出一次堆栈。

不记录逐token、普通工具调用成功、完整问题/答案、请求响应正文；不新增周期性delta汇总或健康状态摘要。工具异常或慢等待时，在request.issue里记录当前工具名和耗时即可。

## 4. 沙箱和配置只处理必要项

- 健康心跳、续租、空扫描、无变化状态查询保持静默；创建、重启、释放、真实状态变化保留结果。由聊天触发时携带requestId。
- 删除Service/Provider/HTTP client重复的成功日志；失败只记一次，同一持续故障限频。
- 部署业务默认INFO，关闭常驻verbose和无用原始帧/正文输出；修正Logback过滤位置与队列背压问题，避免日志拖慢业务。
- 启动只输出一条脱敏配置摘要：构建/SDK版本、有效日志级别、Redis拓扑与key schema、关键超时及留存。不逐请求重复配置。
- 对齐BE Spring、Java SDK、Node SDK的有效Redis配置。参数不一致、错误的pending恢复路径等属于独立修复，不能靠多记日志解决。

## 5. 验收标准

输入一个requestId，能够看到完整的阶段顺序、各段耗时、最终结果；缺失下一节点时可以定位停在哪一段，同ID异常记录说明具体失败或等待原因。Redis写入成功、BE消费成功、WS写出成功、FE应用成功必须能区分。

正常十分钟任务仍约12条关键链路日志；沙箱空闲轮询不刷屏。模拟消费暂停、落库阻塞、WS写失败、FE收到但未应用、断网重连，分别确认日志能定位对应阶段。只检查源码和配置不能证明某次线上故障根因。
