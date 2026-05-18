import { EmitOptions, EventType, SseReasonMessageType } from "@byclaw/by-framework";
import {
  ActiveSdkRequest,
  emitSdkChunkTracked,
  getLastSdkEmitChunk,
  isRootSessionKey,
  isChildSessionKey,
  markActiveSdkRootLifecycleFinished,
  markActiveSdkRootLifecycleStarted,
  resolveActiveSdkRequestBySessionKey,
  resolveActiveSdkRunBinding,
  resolveSdkEmitter,
} from "./session-context";
import {
  cancelActiveSdkCompletionCheck,
  scheduleActiveSdkCompletionCheck,
} from "./sdk-session-completion.js";
import { AgentEvent } from "./types";
import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";
import { emitIncrementalText, getAgentNameById, normalizeReasoningPreviewText } from "./utils";
import {
  buildThinkingEndText,
  buildToolResultTitle as buildLocalizedToolResultTitle,
  buildToolStartTitle as buildLocalizedToolStartTitle,
} from "./i18n.js";

let lastAgentAssistantEvent: {
  seq: number;
  stream: string;
  runId: string;
  startTime: number;
} = {
  seq: 0,
  stream: "",
  runId: "",
  startTime: 0,
};

const toolStartArgsByCallId = new Map<string, Record<string, any>>();

/**
 * 通过baiying_call工具调用，返回的结果，如果包含toBeEmittedChunk字段，则缓存起来，等主agent启动->thinking->开始输出内容前，再emit chunk
 */
let toBeEmittedChunkAfterBaiyingCallTool: undefined | {
  data?: string | Record<string, any>;
  options?: EmitOptions;
} = undefined;

async function emitChunkGenByBaiyingCallTool(request: ActiveSdkRequest, sdkEmitter?: ReturnType<typeof resolveSdkEmitter>) {
  if (!toBeEmittedChunkAfterBaiyingCallTool) {
    return;
  }
  if (!sdkEmitter) {
    sdkEmitter = resolveSdkEmitter(request.accountId);
  }
  await emitSdkChunk(request, sdkEmitter, JSON.stringify(toBeEmittedChunkAfterBaiyingCallTool.data), toBeEmittedChunkAfterBaiyingCallTool.options);
  toBeEmittedChunkAfterBaiyingCallTool = undefined;
}

async function emitSdkChunk(
  request: ActiveSdkRequest,
  sdkEmitter: ReturnType<typeof resolveSdkEmitter>,
  text: string,
  options?: EmitOptions,
): Promise<void> {
  await emitSdkChunkTracked({
    emitter: sdkEmitter,
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

async function handleToolEvent(
  request: ActiveSdkRequest,
  event: AgentEvent,
  isChildSession: boolean,
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
    const title = buildToolStartTitle(request, data);
    await emitSdkChunk(request, sdkEmitter, title, {
      // 必须以toolCallId作为messageId，这个toolCallId可能会作为parentMessageId发送到其他worker(在baiying-enhance的实现)
      messageId: toolCallId,
      parentMessageId: "-1",
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: SseReasonMessageType.think_status_title,
      objectType: "tool_call",
      status: "_START_",
    });
    const args = extractToolStartArgs(data);
    await emitSdkChunk(request, sdkEmitter, JSON.stringify({
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
    await emitSdkChunk(request, sdkEmitter, title, {
      messageId: toolCallId,
      parentMessageId: "-1",
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: SseReasonMessageType.think_status_title,
      objectType: "tool_call",
      status: data.isError ? "_ERROR_" : "_DONE_",
    });
    await emitSdkChunk(request, sdkEmitter, JSON.stringify({
      title: "Output",
      json: result || "{}"
    }), {
      messageId: thinkDetailMessageId,
      parentMessageId: toolCallId,
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: SseReasonMessageType.json_block,
    });
    if (data?.name === "baiying_call") {
      setToBeEmittedChunkViaBaiyingCallTool(data?.result);
    }
  }
}

async function handleAssistantEvent(
  request: ActiveSdkRequest,
  event: AgentEvent,
  isChildSession: boolean,
) {
  const sdkEmitter = resolveSdkEmitter(request.accountId);
  const { data } = event;
  const { delta } = data || {};
  if (!delta) {
    return;
  }
  await emitSdkChunk(request, sdkEmitter, delta as string, {
    eventType: isChildSession ? EventType.REASONING_LOG_DELTA : EventType.ANSWER_DELTA,
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
  const previousEmit = getLastSdkEmitChunk(request.accountId);
  await emitSdkChunkTracked({
    emitter: sdkEmitter,
    sessionId: request.sessionId,
    traceId: request.traceId,
    text: buildThinkingEndText(request.language, duration),
    options: {
      eventType: EventType.REASONING_LOG_DELTA,
      messageId: previousEmit?.messageId,
      parentMessageId: previousEmit?.parentMessageId,
    },
  });
  // await emitSdkChunkTracked({
  //   emitter: sdkEmitter,
  //   sessionId: request.sessionId,
  //   traceId: request.traceId,
  //   text: "",
  //   options: {
  //     eventType: EventType.REASONING_LOG_END,
  //   },
  // });
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
  const sdkEmitter = resolveSdkEmitter(request.accountId);
  const { data } = event;
  const phase = typeof data?.phase === "string" ? data.phase : undefined;
  if (!isRootSessionKey(sessionKey) || !phase) {
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
  if (phase === "end" && activeRequest.pendingChildSessionKeys.size > 0) {
    // root run 先结束，但仍有子 agent 未收尾；先用空行隔开后续恢复输出。
    await emitSdkChunk(activeRequest, sdkEmitter, "\n\n", {
      eventType: EventType.ANSWER_DELTA,
    });
  }
  scheduleActiveSdkCompletionCheck(
    api,
    activeRequest.sessionKey,
    `root_lifecycle_${phase}`,
  );
}

async function handleThinkingEvent(
  request: ActiveSdkRequest,
  event: AgentEvent,
  isPreviousThinking: boolean,
) {
  const sdkEmitter = resolveSdkEmitter(request.accountId);
  const text = event.data?.text as string ?? "";
  const previousEmit = getLastSdkEmitChunk(request.accountId);
  const options: EmitOptions = {
    eventType: EventType.REASONING_LOG_DELTA,
  };
  if (isPreviousThinking) {
    options.messageId = previousEmit?.messageId;
    options.parentMessageId = previousEmit?.parentMessageId;
  } else {
    options.messageId = Math.random().toString(16).slice(2),
    options.parentMessageId = "-1";
  }
  await emitIncrementalText({
    key: `${event.runId}:thinking`,
    rawText: text,
    normalize: normalizeReasoningPreviewText,
    emit: async (reasoningDelta) => {
      await emitSdkChunk(request, sdkEmitter, reasoningDelta, options);
    },
  });
}

export default async function handleAgentEvent(api: OpenClawPluginApi, event: AgentEvent) {
  const { seq, sessionKey, runId } = event;
  const runBinding = resolveActiveSdkRunBinding(runId);
  const resolvedSessionKey = sessionKey ?? runBinding?.sessionKey;
  const correlationKey = resolvedSessionKey || runId;
  if (!correlationKey) {
    return;
  }
  if (lastAgentAssistantEvent.runId === runId && lastAgentAssistantEvent.seq >= seq) {
    return;
  }
  const request = resolvedSessionKey
    ? resolveActiveSdkRequestBySessionKey(resolvedSessionKey) ?? runBinding?.request
    : runBinding?.request;
  if (!request) {
    return;
  }
  api.logger.info(
    `[byai-channel] onAgentEvent: ${JSON.stringify(event)}`,
  );
  const isChildSession = isChildSessionKey(resolvedSessionKey);
  const isPreviousThinking = lastAgentAssistantEvent.stream === "thinking";
  if (isPreviousThinking && event.stream !== "thinking") {
    await handleReasoningEndTransition(request, Date.now() - lastAgentAssistantEvent.startTime);
  }
  const previousStream = lastAgentAssistantEvent.stream;
  lastAgentAssistantEvent.seq = seq;
  lastAgentAssistantEvent.runId = runId;
  if (previousStream !== event.stream) {
    lastAgentAssistantEvent.startTime = Date.now();
  }
  lastAgentAssistantEvent.stream = event.stream;
  if (event.stream === 'tool') {
    await handleToolEvent(request, event, isChildSession);
  } else if (event.stream === 'assistant') {
    if (previousStream !== "assistant" && toBeEmittedChunkAfterBaiyingCallTool) {
      // 无论是主agent还是subagent，开始输出正文前，先把baiying_call工具缓存起来的chunk emit出来
      await emitChunkGenByBaiyingCallTool(request);
    }
    await handleAssistantEvent(request, event, isChildSession);
  } else if (event.stream === "lifecycle") {
    await handleLifecycleEvent(api, request, event, resolvedSessionKey);
  } else if (event.stream === "thinking") {
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
