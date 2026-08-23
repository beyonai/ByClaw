import { EmitOptions, EventType, SseReasonMessageType } from "@byclaw/by-framework";
import {
  ActiveSdkRequest,
  addActiveSdkDelegatedWork,
  bindActiveSdkRequestRunId,
  emitSdkChunkTracked,
  getLastSdkEmitChunk,
  isRootSessionKey,
  markActiveSdkModelFallbackStep,
  markActiveSdkCompactionRetryPending,
  markActiveSdkRootLifecycleFinished,
  markActiveSdkRootLifecycleStarted,
  recordActiveSdkRootStreamAnswer,
  resolveActiveSdkRequestBySessionKey,
  resolveActiveSdkRunBinding,
  resolveSdkEmitter,
  markActiveSdkRequestSubagentSpawned,
  registerAgentRunEndPromise,
} from "./session-context";
import { appendByclawAssistantContextDelta } from "./chat-context-store.js";
import {
  cancelActiveSdkCompletionCheck,
  scheduleActiveSdkCompletionCheck,
} from "./sdk-session-completion.js";
import { isOpenClawContextOverflowDispatchError } from "./dispatch-error.js";
import { reportNativeChildRunTerminal } from "./native-child-run.js";
import {
  resolveAssistantDisplayStream,
  resolveAssistantEventKind,
  resolveAssistantEventText,
  resolveReasoningEventText,
} from "./agent-event-kind.js";
import { AgentEvent } from "./types";
import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";
import { isSubagentSessionKey } from "openclaw/plugin-sdk/routing";
import {
  appendIncrementalTextSnapshot,
  clearIncrementalTextSnapshot,
  emitIncrementalText,
  generateRandomId,
  getAgentNameById,
  getIncrementalTextSnapshot,
  normalizeReasoningPreviewText,
  rememberIncrementalTextSnapshot,
} from "./utils";
import { recordStreamedAnswerSegment } from "./answer-text-ledger.js";
import {
  buildCompactionNoticeText,
  buildThinkingEndText,
  buildToolResultTitle as buildLocalizedToolResultTitle,
  buildToolStartTitle as buildLocalizedToolStartTitle,
} from "./i18n.js";
import { DELEGATED_TASK_STATUS } from "../../shared/src/delegated-tool-details.js"; 
import { getToolCallUIDescription } from "./toolCallUIDescription.js";

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

/** 返回是否真的推给了前端，供答案账本判断该段是否已可见（见 answer-text-ledger.ts）。 */
async function emitSdkChunk(
  request: ActiveSdkRequest,
  text: string,
  options?: EmitOptions,
): Promise<boolean> {
  return await emitSdkChunkTracked(request.sessionKey, {
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
  resolvedSessionKey: string | undefined,
) {
  const sdkEmitter = resolveSdkEmitter(request.accountId);
  if (!sdkEmitter) {
    return;
  }
  const data = event.data as ToolEventData;
  const phase = data?.phase ?? "";
  const toolCallId = data?.toolCallId ?? "";

  const thinkDetailMessageId = `${toolCallId}-${phase}`;

  const renderAsToolCallUI = data.name !== "baiying_call";
  // 暂时还没在 by-framework 定义该 contentType，前端已经实现(SSEMessageType.toolCall)。后续在 by-framework 定义好了，可以直接切换。
  const toolCallContentType = "3015";

  if (phase === "start") {
    const args = extractToolStartArgs(data) || "{}";

    if (renderAsToolCallUI) {
      const toolCallDesc = getToolCallUIDescription(data);
      // sessions_spawn 继续沿用 派生子agent 这种描述
      const displayToolName = data.name === "sessions_spawn" ? buildToolStartTitle(request, data) : data.name;
      await emitSdkChunk(request, JSON.stringify({
        title: displayToolName,
        description: toolCallDesc,
        input: args,
      }), {
        messageId: toolCallId,
        parentMessageId: "-1",
        eventType: EventType.REASONING_LOG_DELTA,
        contentType: toolCallContentType,
        objectType: "tool_call",
      });
      return;
    }
    if (toolCallId && data?.args && typeof data.args === "object") {
      toolStartArgsByCallId.set(toolCallId, data.args);
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
    await emitSdkChunk(request, JSON.stringify({
      title: "Input",
      json: args,
    }), {
      messageId: thinkDetailMessageId,
      parentMessageId: toolCallId,
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: SseReasonMessageType.json_block,
    });
  } else if (phase === "result") {
    const result = extractToolResultText(data?.result) || "{}";
    const status = data.isError ? "_ERROR_" : "_DONE_";

    if (renderAsToolCallUI) {
      await emitSdkChunk(request, JSON.stringify({
        output: result,
        status,
      }), {
        messageId: toolCallId,
        parentMessageId: "-1",
        eventType: EventType.REASONING_LOG_DELTA,
        contentType: toolCallContentType,
        objectType: "tool_call",
      });
      return;
    }
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
      status,
    });
    await emitSdkChunk(request, JSON.stringify({
      title: "Output",
      json: result,
    }), {
      messageId: thinkDetailMessageId,
      parentMessageId: toolCallId,
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: SseReasonMessageType.json_block,
    });
    // 委派工作登记：baiying_call 返回 DELEGATED_TASK_STATUS 表示已把任务派给外部
    // RemoteAgent（redis 驱动，非原生 subagent），随后本 agent 会 sessions_yield。登记该
    // tool_call_id 到 request 挂住完成门，等委派结果经 dispatchRemoteTaskFollowup 回灌后消除。
    // 仅在「委派 tool call 所在会话不是 subagent key」时登记——避免把 subagent 内部再派生的
    // 委派也算进外层完成门（那层由 subagent 自己的 request / 原生 subagent 机制处理）。
    if (
      data.result?.details?.status === DELEGATED_TASK_STATUS &&
      toolCallId &&
      !isSubagentSessionKey(resolvedSessionKey)
    ) {
      addActiveSdkDelegatedWork(resolvedSessionKey ?? request.sessionKey, toolCallId);
    }
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
      : generateRandomId(),
  };
  const answerStreamKey = `${event.runId}:assistant:answer`;
  if (!streamContext.isContinuingAnswer) {
    // A tool/reasoning transition starts a new assistant message. finalAnswer
    // keeps only this run's last assistant message, not earlier process chatter.
    clearIncrementalTextSnapshot(answerStreamKey);
  }
  const explicitDelta = stringValue(event.data?.delta);
  const cumulativeText = stringValue(event.data?.text);
  const isReplacement = event.data?.replace === true;
  const emitAnswerDelta = async (answerDelta: string) => {
    appendByclawAssistantContextDelta({
      request,
      id: request.laneMetadata?.answerMessageId ?? `${event.runId}:assistant`,
      text: answerDelta,
      agentId: request.laneMetadata?.agentId ?? event.agentId,
      agentName: request.laneMetadata?.agentName,
    });
    const emitted = await emitSdkChunk(request, answerDelta, answerOptions);
    // 已推给前端的段落才记账（见 answer-text-ledger.ts），子会话也记：它的文本走
    // REASONING_LOG_DELTA 落在思考通道，位置不同但已经可见，core 事后经 sendText 重投同一
    // 份原文就是重复。没推成（缺 emitter）则不记，否则会抑制一段从未到达客户端的文本。
    // 记的是流式缓冲的当前段落全文，段落切换时缓冲已被替换，天然对齐 core 只投最后一段。
    if (emitted) {
      recordStreamedAnswerSegment({
        sessionKey: request.sessionKey,
        runId: event.runId,
        segmentText: getIncrementalTextSnapshot(answerStreamKey),
        isChildSession,
      });
    }
    if (!isChildSession) {
      recordActiveSdkRootStreamAnswer({
        request,
        runId: event.runId,
        answer: getIncrementalTextSnapshot(answerStreamKey),
      });
    }
  };
  if (explicitDelta && !isReplacement) {
    if (cumulativeText) {
      rememberIncrementalTextSnapshot({
        key: answerStreamKey,
        rawText: cumulativeText,
      });
    } else {
      appendIncrementalTextSnapshot({
        key: answerStreamKey,
        delta: explicitDelta,
      });
    }
    await emitAnswerDelta(explicitDelta);
    return;
  }
  // assistant 流是权威可见源，按 runId 做简单前缀增量即可（sendText 的去重由答案账本
  // 承担，见 answer-text-ledger.ts，不和 assistant 流抢同一缓冲）。
  await emitIncrementalText({
    key: answerStreamKey,
    rawText: text,
    emit: async (answerDelta) => emitAnswerDelta(answerDelta),
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
  if (!phase) {
    return;
  }
  if (!isRootSessionKey(sessionKey)) {
    // child run 的终态只喂 native subagent 台账，不碰 root 的 lifecycle 投影与流式收尾。
    // 这是 announce 之前就能拿到的终态事实，缺了它就只能等 core 推迟发出的 subagent_ended。
    if (phase === "end" || phase === "error") {
      reportNativeChildRunTerminal(api, {
        childRunId: event.runId,
        childSessionKey: sessionKey,
        source: "child_lifecycle",
      });
    }
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
    const activeRequest = markActiveSdkRootLifecycleStarted(sessionKey, event.runId) ?? request;
    cancelActiveSdkCompletionCheck(activeRequest.sessionKey);
    registerAgentRunEndPromise(event.runId);
    return;
  }
  if (phase !== "end" && phase !== "error") {
    return;
  }
  const activeRequest = markActiveSdkRootLifecycleFinished(sessionKey, phase, event.runId);
  if (!activeRequest) {
    api.logger.debug?.(
      `[byai-channel] ignored stale root lifecycle terminal: sessionKey=${sessionKey}, runId=${event.runId}, phase=${phase}`,
    );
    return;
  }
  if (phase === "error") {
    const errorText = typeof data?.error === "string" ? data.error : "Agent run failed";
    await emitSdkChunk(request, errorText, {
      eventType: EventType.ANSWER_DELTA,
    });
  }
  clearIncrementalTextSnapshot(`${event.runId}:`);
  const completionReason =
    phase === "error" && isOpenClawContextOverflowDispatchError(data?.error)
      ? "root_lifecycle_context_overflow_error"
      : `root_lifecycle_${phase}`;
  scheduleActiveSdkCompletionCheck(
    api,
    activeRequest.sessionKey,
    completionReason,
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
  const activeSessionKey = sessionKey ?? request.sessionKey;
  if (phase === "start") {
    markActiveSdkCompactionRetryPending(activeSessionKey, true);
    await emitSdkChunk(request, buildCompactionNoticeText(request.language, {
      phase: "start",
    }), {
      messageId: `${event.runId || activeSessionKey}:compaction:start`,
      parentMessageId: "-1",
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: SseReasonMessageType.think_status_title,
      objectType: "compaction",
      status: "_START_",
      metadata: {
        isCompactionNotice: true,
        compactionPhase: "start",
      },
    });
    return;
  }
  if (phase === "end") {
    const completed = Boolean(event.data?.completed);
    const willRetry = Boolean(event.data?.willRetry);
    markActiveSdkCompactionRetryPending(activeSessionKey, willRetry);
    await emitSdkChunk(request, buildCompactionNoticeText(request.language, {
      phase: "end",
      completed,
      willRetry,
    }), {
      messageId: `${event.runId || activeSessionKey}:compaction:end`,
      parentMessageId: "-1",
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: SseReasonMessageType.think_status_title,
      objectType: "compaction",
      status: completed ? "_DONE_" : "_ERROR_",
      metadata: {
        isCompactionNotice: true,
        compactionPhase: "end",
        completed,
        willRetry,
      },
    });
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
    options.messageId = generateRandomId();
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
    await handleToolEvent(request, event, resolvedSessionKey);
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
