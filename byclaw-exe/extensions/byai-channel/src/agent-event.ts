import { EmitOptions, EventType, SseReasonMessageType } from "@byclaw/by-framework";
import {
  ActiveSdkRequest,
  bindActiveSdkRequestRunId,
  emitSdkChunkTracked,
  getLastSdkEmitChunk,
  isRootSessionKey,
  markActiveSdkModelFallbackStep,
  markActiveSdkCompactionRetryPending,
  markActiveSdkRootLifecycleFinished,
  markActiveSdkRootLifecycleStarted,
  resolveActiveSdkRequestBySessionKey,
  resolveActiveSdkRunBinding,
  resolveSdkEmitter,
  markActiveSdkRequestSubagentSpawned,
} from "./session-context";
import { registerPendingMessageToolSend } from "./pending-message-tool.js";
import {
  cancelActiveSdkCompletionCheck,
  scheduleActiveSdkCompletionCheck,
} from "./sdk-session-completion.js";
import {
  resolveAssistantDisplayStream,
  resolveAssistantEventKind,
  resolveAssistantEventText,
  resolveReasoningEventText,
} from "./agent-event-kind.js";
import { AgentEvent } from "./types";
import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";
import { isSubagentSessionKey } from "openclaw/plugin-sdk/routing";
import { emitIncrementalText, getAgentNameById, normalizeReasoningPreviewText } from "./utils";
import {
  buildThinkingEndText,
  buildToolResultTitle as buildLocalizedToolResultTitle,
  buildToolStartTitle as buildLocalizedToolStartTitle,
} from "./i18n.js";

type AgentStreamState = {
  seq: number;
  stream: string;
  runId: string;
  startTime: number;
};

const lastAgentAssistantEventBySession = new Map<string, AgentStreamState>();

function emptyAgentStreamState(): AgentStreamState {
  return { seq: 0, stream: "", runId: "", startTime: 0 };
}

function resolveAgentStreamState(sessionKey: string): AgentStreamState {
  let state = lastAgentAssistantEventBySession.get(sessionKey);
  if (!state) {
    state = emptyAgentStreamState();
    lastAgentAssistantEventBySession.set(sessionKey, state);
  }
  return state;
}

const toolStartArgsByCallId = new Map<string, Record<string, any>>();

/**
 * 通过baiying_call工具调用，返回的结果，如果包含toBeEmittedChunk字段，则缓存起来，等主agent启动->thinking->开始输出内容前，再emit chunk
 */
let toBeEmittedChunkAfterBaiyingCallTool: undefined | {
  data?: string | Record<string, any>;
  options?: EmitOptions;
} = undefined;

async function emitChunkGenByBaiyingCallTool(event: AgentEvent, request: ActiveSdkRequest, sdkEmitter?: ReturnType<typeof resolveSdkEmitter>) {
  if (!toBeEmittedChunkAfterBaiyingCallTool) {
    return;
  }
  if (!sdkEmitter) {
    sdkEmitter = resolveSdkEmitter(request.accountId);
  }
  await emitSdkChunk(request, JSON.stringify(toBeEmittedChunkAfterBaiyingCallTool.data), toBeEmittedChunkAfterBaiyingCallTool.options);
  toBeEmittedChunkAfterBaiyingCallTool = undefined;
}

async function emitSdkChunk(
  request: ActiveSdkRequest,
  text: string,
  options?: EmitOptions,
): Promise<void> {
  await emitSdkChunkTracked(request.sessionKey, {
    emitter: resolveSdkEmitter(request.accountId),
    sessionId: request.sessionId,
    traceId: request.traceId,
    text,
    options,
  });
}

function buildToolStartTitle(request: ActiveSdkRequest, data: ToolEventData): string {
  return buildLocalizedToolStartTitle(request.language, {
    args: data?.args || {},
    toolName: data?.name,
    agentName: getAgentNameById(data.args?.agentId) || "",
  });
}

function buildToolResultTitle(request: ActiveSdkRequest, data: ToolEventData): string {
  const args = data?.args || toolStartArgsByCallId.get(data?.toolCallId ?? "") || {};
  return buildLocalizedToolResultTitle(request.language, {
    args,
    toolName: data?.name,
    agentName: getAgentNameById(args?.agentId) || "",
    isError: data?.isError,
  });
}

type ToolEventData = {
  name: string;
  phase: string;
  toolCallId: string;
  isError?: boolean;
  args?: Record<string, any>;
  result?: {
    details: Record<string, any>;
  };
}

function isActiveSdkModelFallbackOutcome(
  value: unknown,
): value is "next_fallback" | "succeeded" | "chain_exhausted" {
  return value === "next_fallback" || value === "succeeded" || value === "chain_exhausted";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function handleToolEvent(
  request: ActiveSdkRequest,
  event: AgentEvent,
) {
  const sdkEmitter = resolveSdkEmitter(request.accountId);
  if (!sdkEmitter) {
    return;
  }
  const data = event.data as ToolEventData;
  const phase = data?.phase ?? "";
  const toolCallId = data?.toolCallId ?? "";

  const thinkDetailMessageId = `${toolCallId}-${phase}`;

  if (phase === "start") {
    if (toolCallId && data?.args && typeof data.args === "object") {
      toolStartArgsByCallId.set(toolCallId, data.args);
    }
    // message 工具的 action=send 是唯一"无 assistant 流、必须靠 outbound.sendText 投递"的
    // 可见内容。登记一条待投递，sendText 命中即 emit、未命中即抑制（agent 回复回声）。
    if (data?.name === "message") {
      const sendText = extractMessageToolSendText(data?.args);
      if (sendText) {
        registerPendingMessageToolSend(request.sessionKey, { toolCallId, text: sendText });
      }
    }
    const title = buildToolStartTitle(request, data);
    await emitSdkChunk(request, title, {
      // 必须以toolCallId作为messageId，这个toolCallId可能会作为parentMessageId发送到其他worker(在baiying-enhance的实现)
      messageId: toolCallId,
      parentMessageId: "-1",
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: SseReasonMessageType.think_status_title,
      objectType: "tool_call",
      status: "_START_",
    });
    const args = extractToolStartArgs(data);
    await emitSdkChunk(request, JSON.stringify({
      title: "Input",
      json: args || "{}",
    }), {
      messageId: thinkDetailMessageId,
      parentMessageId: toolCallId,
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: SseReasonMessageType.json_block,
    });
  } else if (phase === "result") {
    const result = extractToolResultText(data?.result);
    const title = buildToolResultTitle(request, data);
    if (toolCallId) {
      toolStartArgsByCallId.delete(toolCallId);
    }
    await emitSdkChunk(request, title, {
      messageId: toolCallId,
      parentMessageId: "-1",
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: SseReasonMessageType.think_status_title,
      objectType: "tool_call",
      status: data.isError ? "_ERROR_" : "_DONE_",
    });
    await emitSdkChunk(request, JSON.stringify({
      title: "Output",
      json: result || "{}"
    }), {
      messageId: thinkDetailMessageId,
      parentMessageId: toolCallId,
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: SseReasonMessageType.json_block,
    });
    if (data.name === "baiying_call") {
      setToBeEmittedChunkViaBaiyingCallTool(data.result);
    } else if (data.name === "sessions_spawn" && data.result?.details && !data.isError) {
      await markActiveSdkRequestSubagentSpawned(
        request.sessionKey,
        data.result.details.childSessionKey,
        data.result.details.runId,
      );
      cancelActiveSdkCompletionCheck(request.sessionKey);
    }
  }
}

type AssistantStreamContext = {
  isContinuingThinking: boolean;
  isContinuingAnswer: boolean;
};

async function handleAssistantEvent(
  request: ActiveSdkRequest,
  event: AgentEvent,
  isChildSession: boolean,
  streamContext: AssistantStreamContext,
) {
  const kind = resolveAssistantEventKind(event, isChildSession);
  if (kind === "ignore") {
    return;
  }
  const text = resolveAssistantEventText(event, kind);
  if (!text) {
    return;
  }
  if (kind === "reasoning") {
    await emitReasoningText(
      request,
      event.runId,
      "assistant",
      text,
      streamContext.isContinuingThinking,
    );
    return;
  }
  const previousEmit = getLastSdkEmitChunk(request.sessionKey);
  const answerOptions: EmitOptions = {
    parentMessageId: "-1",
    eventType: isChildSession ? EventType.REASONING_LOG_DELTA : EventType.ANSWER_DELTA,
    // 不是连续回复时，新增一个 messageId分组，用于前端区分显示不同段落
    messageId: streamContext.isContinuingAnswer && previousEmit?.messageId
      ? previousEmit.messageId
      : Math.random().toString(16).slice(2),
  };
  // assistant 流是权威可见源，按 runId 做简单前缀增量即可（sendText 的去重改由
  // message tool 事件驱动，不再和 assistant 流抢同一缓冲）。
  await emitIncrementalText({
    key: `${event.runId}:assistant:answer`,
    rawText: stringValue(event.data?.text) || text,
    emit: async (answerDelta) => {
      await emitSdkChunk(request, answerDelta, answerOptions);
    },
  });
}

async function handleReasoningEndTransition(
  request: ActiveSdkRequest,
  duration: number,
) {
  const sdkEmitter = resolveSdkEmitter(request.accountId);
  if (!sdkEmitter) {
    return;
  }
  const previousEmit = getLastSdkEmitChunk(request.sessionKey);
  await emitSdkChunkTracked(request.sessionKey, {
    emitter: sdkEmitter,
    sessionId: request.sessionId,
    traceId: request.traceId,
    text: buildThinkingEndText(request.language, duration),
    options: {
      eventType: EventType.REASONING_LOG_END,
      messageId: previousEmit?.messageId,
      parentMessageId: previousEmit?.parentMessageId,
      contentType: SseReasonMessageType.think_text,
    },
  });
}

/**
 * 为什么不把 SDK 会话收尾放到 outbound.sendText 里：
 * 1. byai-channel 依赖 onAgentEvent 来拿主 agent、子 agent、thinking、tool 等流式内容；
 *    如果只看 outbound.sendText，就拿不到完整的子 agent 过程输出。
 * 2. 从 openclaw 源码看，outbound.sendText 表示“最终 reply payload 正在投递到 channel”，
 *    而 lifecycle/end 表示“某个 agent run 结束”，两者不是同一种信号。
 * 3. 这两个信号的先后顺序在不同 dispatch 路径里并不完全一致，不能简单地认为
 *    sendText 一定晚于或早于 lifecycle/end。
 *
 * 因此，这里的逻辑只能视为 byai-channel 自己的“SDK 展示流收尾策略”：
 * 当 root session 收到 lifecycle/end，且当前没有待处理的子 session 时，尝试结束前端流。
 * 这不等价于 openclaw 全局意义上的“所有 outbound 投递都已完成”。
 */
async function handleLifecycleEvent(
  api: OpenClawPluginApi,
  request: ActiveSdkRequest,
  event: AgentEvent,
  sessionKey?: string,
) {
  const { data } = event;
  const phase = typeof data?.phase === "string" ? data.phase : undefined;
  if (!isRootSessionKey(sessionKey) || !phase) {
    return;
  }
  if (phase === "fallback_step") {
    if (!isActiveSdkModelFallbackOutcome(data?.fallbackStepFinalOutcome)) {
      return;
    }
    const activeRequest = markActiveSdkModelFallbackStep(
      sessionKey,
      data.fallbackStepFinalOutcome,
    ) ?? request;
    if (data.fallbackStepFinalOutcome === "next_fallback") {
      cancelActiveSdkCompletionCheck(activeRequest.sessionKey);
      return;
    }
    scheduleActiveSdkCompletionCheck(
      api,
      activeRequest.sessionKey,
      `model_fallback_${data.fallbackStepFinalOutcome}`,
    );
    return;
  }
  if (phase === "start") {
    const activeRequest = markActiveSdkRootLifecycleStarted(sessionKey) ?? request;
    cancelActiveSdkCompletionCheck(activeRequest.sessionKey);
    return;
  }
  if (phase !== "end" && phase !== "error") {
    return;
  }
  const activeRequest = markActiveSdkRootLifecycleFinished(sessionKey, phase) ?? request;
  if (phase === "error") {
    const errorText = typeof data?.error === "string" ? data.error : "Agent run failed";
    await emitSdkChunk(request, errorText, {
      eventType: EventType.ANSWER_DELTA,
    });
  }
  scheduleActiveSdkCompletionCheck(
    api,
    activeRequest.sessionKey,
    `root_lifecycle_${phase}`,
  );
}

async function handleCompactionEvent(
  request: ActiveSdkRequest,
  event: AgentEvent,
  sessionKey?: string,
) {
  const phase = typeof event.data?.phase === "string" ? event.data.phase : undefined;
  if (!phase) {
    return;
  }
  if (phase === "start") {
    markActiveSdkCompactionRetryPending(sessionKey ?? request.sessionKey, true);
    await emitSdkChunk(request, "", {
      contentType: "5007",
      eventType: EventType.ANSWER_DELTA,
    });
    return;
  }
  if (phase === "end") {
    markActiveSdkCompactionRetryPending(
      sessionKey ?? request.sessionKey,
      Boolean(event.data?.willRetry),
    );
  }
}

async function handleThinkingEvent(
  request: ActiveSdkRequest,
  event: AgentEvent,
  isPreviousThinking: boolean,
) {
  const text = resolveReasoningEventText(event);
  await emitReasoningText(request, event.runId, "thinking", text, isPreviousThinking);
}

async function emitReasoningText(
  request: ActiveSdkRequest,
  runId: string,
  source: string,
  text: string,
  isPreviousThinking: boolean,
) {
  const previousEmit = getLastSdkEmitChunk(request.sessionKey);
  const options: EmitOptions = {
    eventType: EventType.REASONING_LOG_DELTA,
    contentType: SseReasonMessageType.think_text,
  };
  if (isPreviousThinking) {
    options.messageId = previousEmit?.messageId;
    options.parentMessageId = previousEmit?.parentMessageId;
  } else {
    options.messageId = Math.random().toString(16).slice(2);
    options.parentMessageId = "-1";
    await emitSdkChunk(request, "", {
      ...options,
      eventType: EventType.REASONING_LOG_START,
    });
  }
  await emitIncrementalText({
    key: `${runId}:${source}:thinking`,
    rawText: text,
    normalize: normalizeReasoningPreviewText,
    emit: async (reasoningDelta) => {
      await emitSdkChunk(request, reasoningDelta, options);
    },
  });
}

export default async function handleAgentEvent(api: OpenClawPluginApi, event: AgentEvent) {
  api.logger.info(
    `[byai-channel] onAgentEvent: ${JSON.stringify(event)}`,
  );
  const { seq, sessionKey, runId } = event;
  const runBinding = resolveActiveSdkRunBinding(runId);
  const resolvedSessionKey = sessionKey ?? runBinding?.sessionKey;
  const correlationKey = resolvedSessionKey || runId;
  if (!correlationKey) {
    return;
  }
  const streamStateKey = resolvedSessionKey || runId;
  const lastAgentAssistantEvent = resolveAgentStreamState(streamStateKey);
  if (lastAgentAssistantEvent.runId === runId && lastAgentAssistantEvent.seq >= seq) {
    return;
  }
  const request = resolvedSessionKey
    ? resolveActiveSdkRequestBySessionKey(resolvedSessionKey) ?? runBinding?.request
    : runBinding?.request;
  if (!request) {
    return;
  }
  // direct-path 汇总 / announce 续跑等 turn 的 runId 不经 onAgentRunStart/subagent_spawned
  // 绑定，但其事件能经 sessionKey 解析到本 request。补绑定使 boundRunIds 完整，request
  // 清理时能回收其在 activeSdkRequestsByRun 的条目。
  if (runId && resolvedSessionKey && !request.boundRunIds.has(runId)) {
    bindActiveSdkRequestRunId(resolvedSessionKey, runId);
  }
  const isChildSession = isSubagentSessionKey(resolvedSessionKey);
  const currentStream = resolveAssistantDisplayStream(event, isChildSession);
  const previousStream = lastAgentAssistantEvent.stream;
  const isPreviousThinking = previousStream === "thinking";
  if (isPreviousThinking && currentStream !== "thinking") {
    await handleReasoningEndTransition(request, Date.now() - lastAgentAssistantEvent.startTime);
  }
  lastAgentAssistantEvent.seq = seq;
  lastAgentAssistantEvent.runId = runId;
  if (previousStream !== currentStream) {
    lastAgentAssistantEvent.startTime = Date.now();
  }
  lastAgentAssistantEvent.stream = currentStream;
  if (event.stream === 'tool') {
    await handleToolEvent(request, event);
  } else if (event.stream === 'assistant') {
    if (currentStream === "assistant" && previousStream !== "assistant" && toBeEmittedChunkAfterBaiyingCallTool) {
      // 无论是主agent还是subagent，开始输出正文前，先把baiying_call工具缓存起来的chunk emit出来
      await emitChunkGenByBaiyingCallTool(event, request);
    }
    await handleAssistantEvent(request, event, isChildSession, {
      isContinuingThinking: isPreviousThinking && currentStream === "thinking",
      isContinuingAnswer: previousStream === "assistant" && currentStream === "assistant",
    });
  } else if (event.stream === "lifecycle") {
    await handleLifecycleEvent(api, request, event, resolvedSessionKey);
  } else if (event.stream === "compaction") {
    await handleCompactionEvent(request, event, resolvedSessionKey);
  } else if (currentStream === "thinking") {
    await handleThinkingEvent(request, event, isPreviousThinking);
  }
}

function extractToolStartArgs(data: {
  args?: unknown,
}) {
  if (!data.args || typeof data.args !== "object" ) {
    return "";
  }
  return JSON.stringify(data.args, null, 2);
}

// 从 message 工具 args 提取要发送给用户的可见文本。字段优先级对齐 core message-tool
// 的清洗顺序（text/content/message/caption）。
function extractMessageToolSendText(args: unknown): string {
  if (!args || typeof args !== "object") {
    return "";
  }
  const record = args as Record<string, unknown>;
  for (const field of ["text", "content", "message", "caption"]) {
    const value = stringValue(record[field]);
    if (value.trim()) {
      return value;
    }
  }
  return "";
}

function extractToolResultText(result: unknown): string {
  if (typeof result === "string") {
    return result.trim();
  }
  if (!result || typeof result !== "object") {
    return "";
  }
  if ("details" in result && typeof result.details === "object" && result.details && Object.keys(result.details).length > 0) {
    return JSON.stringify(result.details, null, 2);
  }
  if ("content" in result && typeof result.content === "object") {
    return JSON.stringify(result.content, null, 2);
  }
  return JSON.stringify(result, null, 2);
}

function setToBeEmittedChunkViaBaiyingCallTool(result: unknown) {
  const checkIsValidToolResultToBeEmitted = () => {
    if (!result || typeof result !== "object") {
      return false;
    }
    if ("details" in result && typeof result.details === "object" && result.details && Object.keys(result.details).length > 0) {
      const details = result.details as Record<string, any>;
      if (details.toBeEmittedChunk) {
        toBeEmittedChunkAfterBaiyingCallTool = details.toBeEmittedChunk;
        return true;
      }
    }
    return false;
  }
  if (!checkIsValidToolResultToBeEmitted()) {
    toBeEmittedChunkAfterBaiyingCallTool = undefined;
    return false;
  }
  return true;
}
