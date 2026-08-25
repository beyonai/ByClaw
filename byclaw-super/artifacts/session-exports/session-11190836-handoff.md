# Session 11190836 问题说明（可直接转发）

时间均为北京时间（Asia/Shanghai）。该 Session 内共有两次用户调用、两个 trace：

- 首次调用：messageId `11190840`，traceId `6466e8419ac9fd7c9f9365b51b261874`
- 后续重试：messageId `11190846`，traceId `94ba5f41a8b4a1cb8a9f4b1d999a8532`

## 第一次调用

### 03:05:17.341

BY_SUPER 调度“自-文章创作助手”（OpenClaw，agentId `10000713`）。

- delegation/messageId：`a2a539bb-1453-4cdc-9cc3-e460fc260344`
- 下发任务：列出技能清单和角色定位

### 03:05:24.352

OpenClaw 写入“智能体已就绪”。

### 03:05:28.532—03:05:30.468

OpenClaw 已经生成并返回正文，共 19 个 `answerDelta` 分片。

- 输出 messageId：`2ede3be626bb4ec08607747c45c8b195`
- parentMessageId：`-1`
- 返回内容：文章创作助手的技能清单和角色定位

这里的输出 messageId 与 BY_SUPER 的 delegation/messageId 不一致，且 parentMessageId 没有关联到 delegation。

### 03:05:32.006

OpenClaw 写入 `appStreamResponse`，表示它自己的 DataStream 输出结束。

但没有发现 OpenClaw 向 BY_SUPER 回传与 delegation 对应的 `ResumeCommand`。

### 03:10:17.908

BY_SUPER 等待约 300 秒后，将 OpenClaw 调度标记为 `_ERROR_`。

错误信息：

```text
Delegation received no activity within 300000ms
```

也就是说：OpenClaw 实际已经输出结果，但结果只进入 Redis DataStream；BY_SUPER 的 `callAgent` 回调等待器没有收到 Resume，因此仍判定为“无活动并超时”。

### 03:10:20.118

BY_SUPER 随后才开始调度“需求侦探 · 许知意”（BYCLAW_CODE，agentId `11094232`）。

- delegation/messageId：`5313b287-4756-47b5-8d83-65ce5c6fa3ad`

这也说明两个 Agent 并没有真正并行：第一个 `callAgent` 阻塞等待 300 秒后，第二个调度才开始。

### 03:10:50.621

BY_SUPER 收到 `RESUMED`，说明 BYCLAW_CODE 正确走了 `callAgent -> ResumeCommand` 回调链路。

### 03:11:04.507

BY_SUPER 将 BYCLAW_CODE 调度标记为 `_DONE_`。

### 03:11:40.091—03:11:40.307

BY_SUPER 输出最终 `finalAnswer`，随后写入自己的 `appStreamResponse`。最终结果中：

- OpenClaw：超时、结果为空
- BYCLAW_CODE：完成

## 第二次调用/重试

### 03:12:51.477

BY_SUPER 先调度 BYCLAW_CODE。

- delegation/messageId：`9904b24c-08ef-4007-bb4f-66ef40c27b5c`
- 下发任务：实际执行 `ls`

### 03:12:59.775—03:12:59.965

BYCLAW_CODE 执行 `ls -la` 并返回真实输出。

### 03:13:04.781

BY_SUPER 收到 `RESUMED`。

### 03:13:12.827

BY_SUPER 将 BYCLAW_CODE 调度标记为 `_DONE_`。

### 03:13:21.447

BY_SUPER 再调度 OpenClaw。

- delegation/messageId：`4b61fd4e-6f63-4f6b-beab-e090e9f69a86`
- 下发任务：实际执行 `ls`

### 03:13:26.014

OpenClaw 写入“智能体已就绪”。

### 03:13:29.422—03:13:37.263

OpenClaw 实际调用终端工具执行 `ls`：

- 第一次目标目录不存在，退出码为 2
- 随后改查父目录及自己的 workspace，执行成功

### 03:13:44.880—03:13:59.764

OpenClaw 已生成完整结果，共 337 个 `answerDelta` 分片。

- 输出 messageId：`f31187f1bc454e4992b04b640253316d`
- parentMessageId：`-1`

### 03:13:59.990

OpenClaw 写入 `appStreamResponse`，但仍没有向 BY_SUPER 回传关联 delegation 的 `ResumeCommand`。

### 03:18:20.372

约 300 秒后，BY_SUPER 再次将 OpenClaw 调度标记为 `_ERROR_`：

```text
Delegation received no activity within 300000ms
```

### 03:18:55.843—03:18:55.910

BY_SUPER 输出最终 `finalAnswer` 和 `appStreamResponse`。最终结果中：

- BYCLAW_CODE：成功
- OpenClaw：再次超时、结果为空

## 结论

OpenClaw 的执行和内容生成本身没有失败，两次都产生了结果并写入 `answerDelta + appStreamResponse`。真正的问题是：

1. OpenClaw 仍使用 Redis DataStream 直出结果。
2. OpenClaw 没有按 `callAgent` 协议向 BY_SUPER 回传 `ResumeCommand`。
3. OpenClaw 输出的 messageId 是新 ID，parentMessageId 为 `-1`，无法关联到 BY_SUPER 的 delegation/messageId。
4. BY_SUPER 已不再消费子 Agent 的 Redis DataStream，因此不会把 OpenClaw 的 `appStreamResponse` 当作子 Agent finalAnswer。
5. `callAgent` 只能等到 300 秒超时，导致后续串行调度也被一起延迟。

对照来看，BYCLAW_CODE 会返回 `ResumeCommand`，所以 BY_SUPER 能收到 `RESUMED` 并把调度标记为 `_DONE_`。

需要修复的是 OpenClaw（或其接入层）的回调协议：完成后使用原 delegation/messageId 建立关联，并向 BY_SUPER 发送包含 finalAnswer 的 `ResumeCommand`。
