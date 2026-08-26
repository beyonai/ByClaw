import { get, isNil, set, unset } from 'lodash';

import { compareStreamId, type ParsedChatStreamMessage } from '@/hooks/useSseSender/chatStream';
import { IMessageState } from '@/constants/message';
import { chatSessionRuntimeManager, type RunningChatInfo } from '@/utils/chatSessionRuntimeManager';

import type { IMessage, TaskPlanSnapshot } from '@/typescript/message';

type UpdateMessage = (msg: IMessage, opt?: { isAssign?: boolean }) => IMessage;

export type ChatStreamRuntimeContext = {
  clientRequestId: string;
  laneId?: string;
  turnId?: string;
  queryMsg: IMessage;
  answerMsg: IMessage;
  onlyQuery?: boolean;
  restored?: boolean;
  getMessageList: () => IMessage[];
  flowHandler: (props: any) => any;
  updateMessage: UpdateMessage;
};

const pendingChatContexts = new Map<string, ChatStreamRuntimeContext>();
const laneChatContexts = new Map<string, ChatStreamRuntimeContext>();
const traceChatContexts = new Map<string, ChatStreamRuntimeContext>();
const turnChatContexts = new Map<string, Map<string, ChatStreamRuntimeContext>>();
const sessionChatContexts = new Map<string, Map<string, ChatStreamRuntimeContext>>();
const restoringStreamKeys = new Set<string>();
const restoredStreamBuffer = new Map<string, ParsedChatStreamMessage[]>();
const MAX_BUFFERED_STREAM_SIZE = 200;

const safeParseMetadata = (metadata: unknown): Record<string, unknown> => {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata as Record<string, unknown>;
  if (typeof metadata !== 'string') return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
};

const getMessageValue = (message: any, res: any, keys: string[]) => {
  const metadata = {
    ...safeParseMetadata(get(message, 'metadata')),
    ...safeParseMetadata(get(message, 'data.metadata')),
    ...safeParseMetadata(get(res, 'metadata')),
    ...safeParseMetadata(get(res, 'data.metadata')),
  };
  for (const key of keys) {
    const value = get(res, key) ?? get(metadata, key.replace(/^metadata\./, '')) ?? get(message, key);
    if (!isNil(value) && `${value}`) {
      return `${value}`;
    }
  }
  return undefined;
};

const getContextKey = (context: ChatStreamRuntimeContext) => context.clientRequestId;

const getScopedKey = (sessionId?: string | number, value?: string | number) => `${sessionId || ''}:${value || ''}`;

const getSessionContexts = (sessionId?: string | number) =>
  sessionId ? sessionChatContexts.get(`${sessionId}`) : undefined;

export const getChatStreamClientRequestId = (message: any, res?: any) =>
  getMessageValue(message, res, ['clientRequestId', 'data.clientRequestId', 'metadata.clientRequestId']);

export const getChatStreamSessionId = (message: any, res?: any) =>
  getMessageValue(message, res, ['sessionId', 'chatId', 'data.sessionId', 'data.chatId']);

export const getChatStreamLaneId = (message: any, res?: any) =>
  getMessageValue(message, res, ['laneId', 'data.laneId', 'metadata.laneId']);

export const getChatStreamTurnId = (message: any, res?: any) =>
  getMessageValue(message, res, ['turnId', 'data.turnId', 'metadata.turnId']);

export const getRestoredStreamKey = (targetSessionId?: string | number, traceId?: string) =>
  `${targetSessionId || ''}:${traceId || ''}`;

export const getParsedTraceId = (parsed: ParsedChatStreamMessage) =>
  get(parsed.rawMessage, 'traceId') ||
  get(parsed.res, 'traceId') ||
  get(parsed.res, 'data.traceId') ||
  get(parsed.formattedPayload, 'traceId');

const getRestoredKeyByParsed = (parsed: ParsedChatStreamMessage) => {
  const targetSessionId = getChatStreamSessionId(parsed.rawMessage, parsed.res);
  return getRestoredStreamKey(targetSessionId, getParsedTraceId(parsed));
};

export const registerPendingChatContext = (context: ChatStreamRuntimeContext) => {
  pendingChatContexts.set(context.clientRequestId, context);
  if (context.laneId) {
    laneChatContexts.set(`${context.laneId}`, context);
    const sessionId = context.answerMsg.sessionId || context.queryMsg.sessionId;
    if (sessionId) {
      laneChatContexts.set(getScopedKey(sessionId, context.laneId), context);
    }
  }
  if (context.turnId) {
    const contexts = turnChatContexts.get(`${context.turnId}`) || new Map<string, ChatStreamRuntimeContext>();
    contexts.set(context.clientRequestId, context);
    turnChatContexts.set(`${context.turnId}`, contexts);
  }
  const traceId = context.answerMsg.traceId || get(context.answerMsg, 'traceId');
  if (traceId) {
    const sessionId = context.answerMsg.sessionId || context.queryMsg.sessionId;
    traceChatContexts.set(getScopedKey(sessionId, traceId), context);
  }
};

export const unregisterPendingChatContext = (clientRequestId?: string) => {
  if (!clientRequestId) return;
  const context = pendingChatContexts.get(`${clientRequestId}`);
  pendingChatContexts.delete(`${clientRequestId}`);
  if (context?.laneId) {
    laneChatContexts.delete(`${context.laneId}`);
    const sessionId = context.answerMsg.sessionId || context.queryMsg.sessionId;
    if (sessionId) {
      laneChatContexts.delete(getScopedKey(sessionId, context.laneId));
    }
  }
  if (context?.turnId) {
    const contexts = turnChatContexts.get(`${context.turnId}`);
    contexts?.delete(context.clientRequestId);
    if (!contexts?.size) {
      turnChatContexts.delete(`${context.turnId}`);
    }
  }
  const traceId = context?.answerMsg.traceId || get(context?.answerMsg, 'traceId');
  const sessionId = context?.answerMsg.sessionId || context?.queryMsg.sessionId;
  if (traceId) {
    traceChatContexts.delete(getScopedKey(sessionId, traceId));
  }
};

export const registerSessionChatContext = (
  sessionId: string | number | undefined,
  context: ChatStreamRuntimeContext
) => {
  if (!sessionId) return;
  const sessionKey = `${sessionId}`;
  const contexts = sessionChatContexts.get(sessionKey) || new Map<string, ChatStreamRuntimeContext>();
  contexts.set(getContextKey(context), context);
  sessionChatContexts.set(sessionKey, contexts);
  if (context.laneId) {
    laneChatContexts.set(`${context.laneId}`, context);
    laneChatContexts.set(getScopedKey(sessionId, context.laneId), context);
  }
  if (context.turnId) {
    const turnContexts = turnChatContexts.get(`${context.turnId}`) || new Map<string, ChatStreamRuntimeContext>();
    turnContexts.set(context.clientRequestId, context);
    turnChatContexts.set(`${context.turnId}`, turnContexts);
  }
  const traceId = context.answerMsg.traceId || get(context.answerMsg, 'traceId');
  if (traceId) {
    traceChatContexts.set(getScopedKey(sessionId, traceId), context);
  }
};

export const unregisterSessionChatContext = (sessionId?: string | number, clientRequestId?: string) => {
  if (!sessionId) return;
  const sessionKey = `${sessionId}`;
  if (!clientRequestId) {
    const contexts = sessionChatContexts.get(sessionKey);
    contexts?.forEach((context) => unregisterPendingChatContext(context.clientRequestId));
    sessionChatContexts.delete(sessionKey);
    return;
  }
  const contexts = sessionChatContexts.get(sessionKey);
  const context = contexts?.get(`${clientRequestId}`);
  contexts?.delete(`${clientRequestId}`);
  if (!contexts?.size) {
    sessionChatContexts.delete(sessionKey);
  }
  if (context?.laneId) {
    laneChatContexts.delete(`${context.laneId}`);
    laneChatContexts.delete(getScopedKey(sessionId, context.laneId));
  }
  if (context?.turnId) {
    const turnContexts = turnChatContexts.get(`${context.turnId}`);
    turnContexts?.delete(context.clientRequestId);
    if (!turnContexts?.size) {
      turnChatContexts.delete(`${context.turnId}`);
    }
  }
  const traceId = context?.answerMsg.traceId || get(context?.answerMsg, 'traceId');
  if (traceId) {
    traceChatContexts.delete(getScopedKey(sessionId, traceId));
  }
};

const bufferParsedStream = (parsed: ParsedChatStreamMessage) => {
  const restoredKey = getRestoredKeyByParsed(parsed);
  if (!restoredKey || restoredKey === ':') return;

  const buffered = restoredStreamBuffer.get(restoredKey) || [];
  buffered.push(parsed);
  if (buffered.length > MAX_BUFFERED_STREAM_SIZE) {
    buffered.splice(0, buffered.length - MAX_BUFFERED_STREAM_SIZE);
  }
  restoredStreamBuffer.set(restoredKey, buffered);

  if (['error', 'appStreamResponse'].includes(parsed.eventName)) {
    const targetSessionId =
      (parsed.formattedPayload?.sessionId as string | number) || getChatStreamSessionId(parsed.rawMessage, parsed.res);
    const runtimeInfo =
      chatSessionRuntimeManager.getByClientRequest(parsed.clientRequestId) ||
      chatSessionRuntimeManager.getByLane(targetSessionId, parsed.laneId) ||
      chatSessionRuntimeManager.getByTrace(targetSessionId, getParsedTraceId(parsed));
    const clientRequestId = parsed.clientRequestId || runtimeInfo?.clientRequestId;
    if (clientRequestId) {
      unregisterSessionChatContext(targetSessionId, clientRequestId);
      unregisterPendingChatContext(clientRequestId);
      chatSessionRuntimeManager.complete(clientRequestId);
    }
  }
};

export const startRestoringChatStream = (restoreKey: string) => {
  if (!restoreKey) return;
  restoringStreamKeys.add(restoreKey);
};

export const stopRestoringChatStream = (restoreKey: string) => {
  if (!restoreKey) return;
  restoringStreamKeys.delete(restoreKey);
};

export const clearRestoredChatStreamBuffer = (restoreKey: string) => {
  if (!restoreKey) return;
  restoredStreamBuffer.delete(restoreKey);
};

const findChatStreamContext = (
  rawMessage: any,
  res?: any,
  eventName?: string
): ChatStreamRuntimeContext | undefined => {
  const clientRequestId = getChatStreamClientRequestId(rawMessage, res);
  if (clientRequestId) {
    const pending = pendingChatContexts.get(clientRequestId);
    if (pending) return pending;
  }

  const messageSessionId = getChatStreamSessionId(rawMessage, res);
  const laneId = getChatStreamLaneId(rawMessage, res);
  if (laneId) {
    const laneContext =
      laneChatContexts.get(getScopedKey(messageSessionId, laneId)) || laneChatContexts.get(`${laneId}`);
    if (laneContext) return laneContext;

    const laneRuntimeInfo = chatSessionRuntimeManager.getByLane(messageSessionId, laneId);
    if (laneRuntimeInfo?.clientRequestId) {
      return pendingChatContexts.get(laneRuntimeInfo.clientRequestId);
    }
  }

  const traceId =
    get(rawMessage, 'traceId') || get(res, 'traceId') || get(res, 'data.traceId') || get(rawMessage, 'data.traceId');
  if (traceId) {
    const traceContext = traceChatContexts.get(getScopedKey(messageSessionId, traceId));
    if (traceContext) return traceContext;
    const runtimeInfo = chatSessionRuntimeManager.getByTrace(messageSessionId, traceId);
    if (runtimeInfo?.clientRequestId) {
      const pending = pendingChatContexts.get(runtimeInfo.clientRequestId);
      if (pending) return pending;
    }
  }

  const turnId = getChatStreamTurnId(rawMessage, res);
  if (turnId) {
    const turnContexts = turnChatContexts.get(`${turnId}`);
    if (turnContexts?.size === 1) {
      return turnContexts.values().next().value;
    }
    if (turnContexts?.size && ['createSession', 'initMessage', 'initialization'].includes(`${eventName}`)) {
      return turnContexts.values().next().value;
    }
  }

  if (messageSessionId) {
    const contexts = getSessionContexts(messageSessionId);
    if (contexts?.size === 1) {
      return contexts.values().next().value;
    }
  }

  if (!messageSessionId) return undefined;

  const sessionPendingContexts = Array.from(pendingChatContexts.values()).filter((pending) => {
    return [pending.queryMsg.sessionId, pending.answerMsg.sessionId].some(
      (item) => item && `${item}` === `${messageSessionId}`
    );
  });
  return sessionPendingContexts.length === 1 ? sessionPendingContexts[0] : undefined;
};

export const hasChatStreamContext = (rawMessage: any, res?: any) => !!findChatStreamContext(rawMessage, res);

const shouldApplyParsedStream = (parsed: ParsedChatStreamMessage) => {
  if (!parsed.streamId) return true;
  const targetSessionId = getChatStreamSessionId(parsed.rawMessage, parsed.res);
  const runtimeInfo =
    chatSessionRuntimeManager.getByClientRequest(parsed.clientRequestId) ||
    chatSessionRuntimeManager.getByLane(targetSessionId, parsed.laneId) ||
    chatSessionRuntimeManager.getByTrace(targetSessionId, getParsedTraceId(parsed)) ||
    chatSessionRuntimeManager.getBySession(targetSessionId);
  if (!runtimeInfo?.lastAppliedStreamId) return true;
  return compareStreamId(parsed.streamId, runtimeInfo.lastAppliedStreamId) > 0;
};

const markParsedStreamApplied = (context: ChatStreamRuntimeContext, parsed: ParsedChatStreamMessage) => {
  if (!parsed.streamId) return;
  set(context.answerMsg, 'streamId', parsed.streamId);
  chatSessionRuntimeManager.updateLastAppliedStreamId(context.clientRequestId, parsed.streamId);
};

const completeChatStreamContext = (context: ChatStreamRuntimeContext, messageState: IMessageState) => {
  if (context.answerMsg.messageState !== IMessageState.Cancel) {
    set(context.answerMsg, 'messageState', messageState);
  }
  unset(context.answerMsg, 'cancelSSE');
  unregisterPendingChatContext(context.clientRequestId);
  if (context.answerMsg.sessionId) {
    unregisterSessionChatContext(`${context.answerMsg.sessionId}`, context.clientRequestId);
  }
  chatSessionRuntimeManager.complete(context.clientRequestId);
};

const applyParsedStreamToContext = (parsed: ParsedChatStreamMessage, context: ChatStreamRuntimeContext) => {
  const { eventName, formattedPayload, rawMessage, sseMsg, streamId } = parsed;
  if (streamId) {
    set(context.answerMsg, 'streamId', streamId);
  }
  if (formattedPayload.traceId) {
    set(context.answerMsg, 'traceId', formattedPayload.traceId);
    chatSessionRuntimeManager.updateTrace(context.clientRequestId, `${formattedPayload.traceId}`);
  }
  if (formattedPayload.laneId) {
    set(context.answerMsg, 'laneId', formattedPayload.laneId);
  }
  if (formattedPayload.turnId) {
    set(context.answerMsg, 'turnId', formattedPayload.turnId);
  }
  if (formattedPayload.agentId) {
    set(context.answerMsg, 'agentId', `${formattedPayload.agentId}`);
  }
  if (formattedPayload.agentCode) {
    set(context.answerMsg, 'agentCode', formattedPayload.agentCode);
  }
  if (formattedPayload.agentName) {
    set(context.answerMsg, 'agentName', formattedPayload.agentName);
  }

  context.flowHandler({
    sseRes: formattedPayload,
    sseMsg: {
      ...sseMsg,
      id: context.clientRequestId,
      clientRequestId: context.clientRequestId,
      sessionExts: rawMessage.sessionExts,
      data: typeof rawMessage.data === 'string' ? rawMessage.data : JSON.stringify(rawMessage.data || {}),
    },
    newQueryMsg: context.queryMsg,
    newAnswerMsg: context.answerMsg,
    messageList: context.getMessageList(),
  });

  const nextSessionId = context.answerMsg.sessionId || get(formattedPayload, 'sessionId');
  chatSessionRuntimeManager.bindSession(context.clientRequestId, nextSessionId ? `${nextSessionId}` : undefined);
  registerSessionChatContext(nextSessionId ? `${nextSessionId}` : undefined, context);
  if (nextSessionId && context.turnId) {
    const turnContexts = turnChatContexts.get(`${context.turnId}`);
    turnContexts?.forEach((turnContext) => {
      if (!turnContext.answerMsg.sessionId) {
        set(turnContext.answerMsg, 'sessionId', `${nextSessionId}`);
      }
      if (!turnContext.queryMsg.sessionId) {
        set(turnContext.queryMsg, 'sessionId', `${nextSessionId}`);
      }
      chatSessionRuntimeManager.bindSession(turnContext.clientRequestId, `${nextSessionId}`);
      registerSessionChatContext(`${nextSessionId}`, turnContext);
    });
  }

  if (['error'].includes(eventName)) {
    completeChatStreamContext(context, IMessageState.Error);
  }

  if (['appStreamResponse'].includes(eventName)) {
    completeChatStreamContext(context, IMessageState.Done);
  }

  if (!context.onlyQuery) {
    context.queryMsg = context.updateMessage(context.queryMsg);
  }
  context.answerMsg = context.updateMessage(context.answerMsg, { isAssign: context.restored });
  markParsedStreamApplied(context, parsed);
};

export const handleParsedChatStream = (parsed: ParsedChatStreamMessage) => {
  if (!shouldApplyParsedStream(parsed)) return;

  const restoredKey = getRestoredKeyByParsed(parsed);
  if (restoringStreamKeys.has(restoredKey)) {
    bufferParsedStream(parsed);
    return;
  }

  const context = findChatStreamContext(parsed.rawMessage, parsed.res, parsed.eventName);
  if (!context) {
    const messageSessionId = getChatStreamSessionId(parsed.rawMessage, parsed.res);
    const runtimeInfo = chatSessionRuntimeManager.getBySession(messageSessionId);
    if (runtimeInfo?.restored) {
      bufferParsedStream(parsed);
    }
    return;
  }

  applyParsedStreamToContext(parsed, context);
};

export const handleTaskPlanSnapshot = (message: any) => {
  const taskPlan = get(message, 'data') as TaskPlanSnapshot | undefined;
  if (!taskPlan?.planId || !taskPlan?.messageId) return false;

  const context = findChatStreamContext(message, taskPlan);
  if (!context) return false;

  const currentVersion = Number(context.answerMsg.taskPlan?.version || 0);
  const nextVersion = Number(taskPlan.version || 0);
  if (currentVersion >= nextVersion) return true;

  context.answerMsg.taskPlan = taskPlan;
  context.answerMsg.messageId = `${taskPlan.messageId}`;
  context.answerMsg.sessionId = `${taskPlan.sessionId}`;
  if (taskPlan.traceId) context.answerMsg.traceId = taskPlan.traceId;
  context.answerMsg = context.updateMessage(context.answerMsg);
  return true;
};

export const flushRestoredChatStreamBuffer = (restoreKey: string) => {
  const buffered = restoredStreamBuffer.get(restoreKey) || [];
  restoredStreamBuffer.delete(restoreKey);
  restoringStreamKeys.delete(restoreKey);
  buffered
    .filter(shouldApplyParsedStream)
    .sort((a, b) => compareStreamId(a.streamId, b.streamId))
    .forEach(handleParsedChatStream);
};

export const handleChatStreamError = (message: any) => {
  const context = findChatStreamContext(message);
  if (!context) return;
  const errorMsg = get(message, 'message') || get(message, 'chatContent') || 'WebSocket error';
  set(context.answerMsg, 'messageTip', errorMsg);
  if (!context.answerMsg.text) {
    set(context.answerMsg, 'text', errorMsg);
  }
  completeChatStreamContext(context, IMessageState.Error);
  context.answerMsg = context.updateMessage(context.answerMsg);
};

export const hydrateRunningSessions = (runningInfoList: RunningChatInfo[] = []) => {
  const runningSessionIds = new Set(
    runningInfoList.filter((item) => item.running && item.sessionId).map((item) => `${item.sessionId}`)
  );
  runningInfoList.forEach((item) => {
    if (item.running) {
      chatSessionRuntimeManager.hydrateRunning(item);
      return;
    }
    if (!runningSessionIds.has(`${item.sessionId}`)) {
      // 全局状态回查只能结束恢复的旧会话，实时回答仍由 SSE 完成事件结束。
      chatSessionRuntimeManager.completeRestoredBySession(item.sessionId);
    }
  });
};

export const clearChatRuntime = () => {
  pendingChatContexts.clear();
  laneChatContexts.clear();
  traceChatContexts.clear();
  turnChatContexts.clear();
  sessionChatContexts.clear();
  restoredStreamBuffer.clear();
  restoringStreamKeys.clear();
  chatSessionRuntimeManager.clear();
};
