import type { JsonValue, RunEvent } from "@byclaw/by-conductor";

type SerializerState = {
  reasoningStarted: boolean;
  reasoningEnded: boolean;
  answerStarted: boolean;
  answerEnded: boolean;
};

/** 创建 ByClaw 前端可识别的 thinking/answer SSE 序列化器。 */
export function createByClawSseSerializer(): (event: RunEvent) => string {
  const state: SerializerState = {
    reasoningStarted: false,
    reasoningEnded: false,
    answerStarted: false,
    answerEnded: false,
  };
  return (event) => serializeByClawSse(event, state);
}

/** 根据内部 RunEvent 和当前流状态生成一个或多个 ByClaw SSE 帧。 */
function serializeByClawSse(event: RunEvent, state: SerializerState): string {
  const frames: string[] = [];
  appendSubAgentFrames(frames, event);
  appendInteractionFrame(frames, event);
  const progress = progressMessage(event);
  if (progress) {
    appendReasoning(frames, event, state, progress);
  }

  if (event.type === "leader.delta") {
    appendAnswerDelta(frames, event, state, stringData(event.data.text));
  }

  if (event.type === "run.completed") {
    if (!state.answerStarted) {
      appendAnswerDelta(frames, event, state, stringData(event.data.finalAnswer));
    }
    if (state.reasoningStarted && !state.reasoningEnded) {
      frames.push(frame(event, "reasoningLogEnd", messagePayload(event, "reasoningLogEnd", "")));
      state.reasoningEnded = true;
    }
    if (state.answerStarted && !state.answerEnded) {
      frames.push(frame(event, "answerEnd", messagePayload(event, "answerEnd", "")));
      state.answerEnded = true;
    }
    frames.push(
      frame(event, "appStreamResponse", {
        event: "appStreamResponse",
        messageId: event.runId,
        queryMessageId: event.runId,
        traceId: event.runId,
        relatedResources: [],
        relatedQuestions: [],
      }),
    );
  }

  if (event.type === "run.failed" || event.type === "run.cancelled") {
    frames.push(
      frame(event, "error", {
        event: "error",
        message: stringData(event.data.error) || stringData(event.data.reason) || event.type,
        traceId: event.runId,
      }),
    );
  }

  return frames.join("");
}

/** 把统一交互请求投影为现有前端已经支持的 3013 固定表单。 */
function appendInteractionFrame(frames: string[], event: RunEvent): void {
  if (event.type !== "interaction.requested") {
    return;
  }
  const interactionId = stringData(event.data.interactionId);
  const request = recordData(event.data.request);
  const uiPayload =
    recordData(request?.uiPayload) ??
    ({ formStatus: 0, pluginMachineFields: [] } as Record<string, JsonValue>);
  frames.push(
    frame(event, "reasoningLogDelta", {
      event: "reasoningLogDelta",
      messageId: interactionId || event.runId,
      queryMessageId: event.runId,
      traceId: event.runId,
      sourceAgentType: "BY_SUPER",
      contentType: "3013",
      orderId: interactionId || event.runId,
      parentOrderId: stringData(event.data.delegationId) || "-1",
      choices: [{ delta: { role: "assistant", content: JSON.stringify(uiPayload) } }],
      metadata: {
        parent_run_id: event.runId,
        interaction_id: interactionId,
      },
    }),
  );
}

/** 把持久 Delegation 事件映射为可独立展示和回放的子 Agent SSE 协议。 */
function appendSubAgentFrames(frames: string[], event: RunEvent): void {
  const eventName =
    event.type === "delegation.started"
      ? "subAgentStart"
      : event.type === "delegation.progress"
        ? "subAgentProgress"
        : event.type === "delegation.output.delta"
          ? "subAgentOutputDelta"
          : event.type === "delegation.completed"
            ? "subAgentEnd"
            : event.type === "delegation.failed"
              ? "subAgentError"
              : undefined;
  if (!eventName) {
    return;
  }

  const delegationId = stringData(event.data.delegationId);
  const text =
    event.type === "delegation.output.delta"
      ? stringData(event.data.text)
      : event.type === "delegation.progress"
        ? stringData(event.data.message)
        : event.type === "delegation.failed"
          ? stringData(event.data.error)
          : "";
  frames.push(
    frame(event, eventName, {
      event: eventName,
      messageId: delegationId || event.runId,
      queryMessageId: event.runId,
      traceId: event.runId,
      delegationId,
      agentId: stringData(event.data.agentId),
      agentName: stringData(event.data.agentName),
      status: stringData(event.data.status),
      artifactCount:
        typeof event.data.artifactCount === "number"
          ? event.data.artifactCount
          : 0,
      contentType: "1002",
      choices: [{ delta: { content: text } }],
    }),
  );
}

/** 追加思考阶段的开始和增量事件，并维护思考阶段状态。 */
function appendReasoning(
  frames: string[],
  event: RunEvent,
  state: SerializerState,
  text: string,
): void {
  if (!state.reasoningStarted || state.reasoningEnded) {
    frames.push(frame(event, "reasoningLogStart", messagePayload(event, "reasoningLogStart", "")));
    state.reasoningStarted = true;
    state.reasoningEnded = false;
  }
  frames.push(frame(event, "reasoningLogDelta", messagePayload(event, "reasoningLogDelta", text)));
}

/** 结束未关闭的思考阶段，并追加回答开始和回答增量事件。 */
function appendAnswerDelta(
  frames: string[],
  event: RunEvent,
  state: SerializerState,
  text: string,
): void {
  if (!text) {
    return;
  }
  if (state.reasoningStarted && !state.reasoningEnded) {
    frames.push(frame(event, "reasoningLogEnd", messagePayload(event, "reasoningLogEnd", "")));
    state.reasoningEnded = true;
  }
  if (!state.answerStarted) {
    frames.push(frame(event, "answerStart", messagePayload(event, "answerStart", "")));
    state.answerStarted = true;
  }
  frames.push(frame(event, "answerDelta", messagePayload(event, "answerDelta", text)));
}

/** 按标准 SSE 文本协议封装事件 ID、事件名和 JSON 数据。 */
function frame(event: RunEvent, name: string, data: Record<string, JsonValue>): string {
  return `id: ${event.eventId}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 构造 ByClaw answer/reasoning 事件共用的消息载荷。 */
function messagePayload(event: RunEvent, name: string, text: string): Record<string, JsonValue> {
  return {
    event: name,
    messageId: event.runId,
    queryMessageId: event.runId,
    traceId: event.runId,
    contentType: "1002",
    choices: [{ delta: { content: text } }],
  };
}

/** 将内部运行与委派事件转换为可安全展示的简化思考进度。 */
function progressMessage(event: RunEvent): string {
  if (event.type === "run.created") {
    return "任务已创建";
  }
  if (event.type === "run.attempt") {
    return Number(event.data.attemptNo) > 1 ? "任务已由其他实例恢复执行" : "任务开始执行";
  }
  if (event.type === "run.status") {
    return runStatusMessage(stringData(event.data.status));
  }
  if (event.type === "delegation.started") {
    return `正在调用 ${stringData(event.data.agentName) || stringData(event.data.agentId) || "Agent"}`;
  }
  if (event.type === "delegation.progress") {
    return stringData(event.data.message);
  }
  if (event.type === "delegation.completed") {
    return `Agent ${stringData(event.data.agentId) || ""} 已完成`.trim();
  }
  if (event.type === "delegation.failed") {
    return `Agent ${stringData(event.data.agentId) || ""} 执行失败`.trim();
  }
  return "";
}

/** 将内部 Run 状态映射为面向用户的中文进度文本。 */
function runStatusMessage(status: string): string {
  switch (status) {
    case "QUEUED":
      return "任务已进入队列";
    case "RUNNING":
      return "正在理解任务";
    case "WAITING_AGENT":
      return "正在等待 Agent 执行";
    case "WAITING_USER":
      return "等待你补充信息";
    case "SYNTHESIZING":
      return "正在汇总 Agent 结果";
    case "CANCELLING":
      return "正在取消任务";
    default:
      return "";
  }
}

/** 从事件 JSON 字段中安全提取字符串。 */
function stringData(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function recordData(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}
