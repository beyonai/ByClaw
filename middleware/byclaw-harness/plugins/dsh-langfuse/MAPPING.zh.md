# DSH 与 ByClaw Langfuse 行为对照

| 目标行为 | ByClaw/OpenClaw 参考 | DSH `2026.9.8` 适配 |
|---|---|---|
| 请求根 | inbound/run diagnostics span | `agent/inbox/claimed` 中首个真实用户消息，按 `sessionId + turn` 创建 `dsh.run` |
| session/user | Langfuse span attributes 与 backfill | `langfuse.session.id` 使用 DSH session ID；入口/header userId 优先，缺失回退 `USER_CODE`，`turn/end` 再解析并补写 |
| 模型配置 | `model.call.started` | `agent/request` waterfall 下游返回的最终 provider/model |
| 模型内容 | diagnostics private model content | `agent/pre-step` 的已接纳消息，加 `system-prompt/assemble` 的 sections/tools |
| 模型输出 | completed model call/final-output backfill | durable `assistant/message`，以 `turn/step` 关联 generation |
| token usage | model usage diagnostics | `agent/assistant-stream` 的原生 `usage` chunk；缺失不伪造 |
| 首词响应 | `langfuse.observation.completion_start_time` | 从模型调用开始计时，首个非空文本、推理或工具调用 chunk 写入完成起始时间；usage/空 chunk 不计入 |
| 工具 identity | `toolCallId/runId/sessionKey` bridge | DSH `ToolExecution.token` 为进程内 identity，`callId` 为可观测 identity |
| 工具输入输出 | `input.value`/`output.value` | `arguments` 与 canonical result value/error；同一 span 开始并结束 |
| 子代理父链 | observation bridge | 父 Agent scoped `subagent/start/end`；child ID 到 W3C trace/span context 的内存和文件桥 |
| 最终输出 | trace 与运行 observation 补写 | 根 span attributes 加同 trace ID 的 Langfuse `trace-create` 幂等补写 |
| 失败状态 | error/blocked/cancelled spans | model failure、abandoned attempt、tool `isError`、subagent stopReason、非 completed turn reason |
| 生命周期 | exporter flush/shutdown | disposer 释放 root/scoped listeners，等待 public ingestion，随后 forceFlush/shutdown OTLP provider |

## 差异与限制

- DSH 没有 OpenClaw diagnostics-otel 的内置授权 ID，也没有同名事件；不能复制插件 ID 或假设事件等价。
- DSH 的 token usage 来自 stream usage chunk；没有事件字段时不推算。
- 跨进程子代理只有在两端均加载插件且共享 `BYCLAW_LANGFUSE_OBSERVATION_BRIDGE_FILE` 时才能恢复父 observation。
- public ingestion 补写是 OTLP trace 的辅助路径，不替代 OTLP 主导出的模型与工具 observations。
