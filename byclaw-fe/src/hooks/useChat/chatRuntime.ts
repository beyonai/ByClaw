import { get, isNil, set, unset } from 'lodash';

import { compareStreamId, type ParsedChatStreamMessage } from '@/hooks/useSseSender/chatStream';
import { IMessageState } from '@/constants/message';
import { chatSessionRuntimeManager, type RunningChatInfo } from '@/utils/chatSessionRuntimeManager';

import type { IMessage, TaskPlanSnapshot } from '@/typescript/message';

type UpdateMessage = (msg: IMessage, opt?: { isAssign?: boolean }) => IMessage;

export type ChatStreamRuntimeContext = {
  clientRequestId: string;
  queryMsg: IMessage;
  answerMsg: IMessage;
  onlyQuery?: boolean;
  restored?: boolean;
  getMessageList: () => IMessage[];
  flowHandler: (props: any) => any;
  updateMessage: UpdateMessage;
};

const pendingChatContexts = new Map<string, ChatStreamRuntimeContext>();
const sessionChatContexts = new Map<string, ChatStreamRuntimeContext>();
const restoringStreamKeys = new Set<string>();
const restoredStreamBuffer = new Map<string, ParsedChatStreamMessage[]>();
const MAX_BUFFERED_STREAM_SIZE = 200;

const getMessageValue = (message: any, res: any, keys: string[]) => {
  for (const key of keys) {
    const value = get(message, key) ?? get(res, key);
    if (!isNil(value) && `${value}`) {
      return `${value}`;
    }
  }
  return undefined;
};

export const getChatStreamClientRequestId = (message: any, res?: any) =>
  getMessageValue(message, res, ['clientRequestId', 'data.clientRequestId']);

export const getChatStreamSessionId = (message: any, res?: any) =>
  getMessageValue(message, res, ['sessionId', 'chatId', 'data.sessionId', 'data.chatId']);

export const getRestoredStreamKey = (targetSessionId?: string | number, traceId?: string) =>
  `${targetSessionId || ''}:${traceId || ''}`;

export const getParsedTraceId = (parsed: ParsedChatStreamMessage) =>
  get(parsed.rawMessage, 'traceId') || get(parsed.res, 'traceId') || get(parsed.res, 'data.traceId');

const getRestoredKeyByParsed = (parsed: ParsedChatStreamMessage) => {
  const targetSessionId = getChatStreamSessionId(parsed.rawMessage, parsed.res);
  return getRestoredStreamKey(targetSessionId, getParsedTraceId(parsed));
};

export const registerPendingChatContext = (context: ChatStreamRuntimeContext) => {
  pendingChatContexts.set(context.clientRequestId, context);
};

export const unregisterPendingChatContext = (clientRequestId?: string) => {
  if (!clientRequestId) return;
  pendingChatContexts.delete(`${clientRequestId}`);
};

export const registerSessionChatContext = (
  sessionId: string | number | undefined,
  context: ChatStreamRuntimeContext
) => {
  if (!sessionId) return;
  sessionChatContexts.set(`${sessionId}`, context);
};

export const unregisterSessionChatContext = (sessionId?: string | number) => {
  if (!sessionId) return;
  sessionChatContexts.delete(`${sessionId}`);
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
    unregisterSessionChatContext(parsed.formattedPayload?.sessionId as string | number);
    if (parsed.clientRequestId) {
      unregisterPendingChatContext(parsed.clientRequestId);
      chatSessionRuntimeManager.complete(parsed.clientRequestId);
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

const findChatStreamContext = (rawMessage: any, res?: any): ChatStreamRuntimeContext | undefined => {
  const clientRequestId = getChatStreamClientRequestId(rawMessage, res);
  if (clientRequestId) {
    const pending = pendingChatContexts.get(clientRequestId);
    if (pending) return pending;
  }

  const messageSessionId = getChatStreamSessionId(rawMessage, res);
  if (messageSessionId) {
    const sessionContext = sessionChatContexts.get(`${messageSessionId}`);
    if (sessionContext) return sessionContext;
  }

  if (!messageSessionId) return undefined;

  return Array.from(pendingChatContexts.values()).find((pending) => {
    return [pending.queryMsg.sessionId, pending.answerMsg.sessionId].some(
      (item) => item && `${item}` === `${messageSessionId}`
    );
  });
};

export const hasChatStreamContext = (rawMessage: any, res?: any) => !!findChatStreamContext(rawMessage, res);

const shouldApplyParsedStream = (parsed: ParsedChatStreamMessage) => {
  if (!parsed.streamId) return true;
  const targetSessionId = getChatStreamSessionId(parsed.rawMessage, parsed.res);
  const runtimeInfo = chatSessionRuntimeManager.getBySession(targetSessionId);
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
    unregisterSessionChatContext(`${context.answerMsg.sessionId}`);
  }
  chatSessionRuntimeManager.complete(context.clientRequestId);
};

const applyParsedStreamToContext = (parsed: ParsedChatStreamMessage, context: ChatStreamRuntimeContext) => {
  const { eventName, formattedPayload, rawMessage, sseMsg, streamId } = parsed;
  if (streamId) {
    set(context.answerMsg, 'streamId', streamId);
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

  const context = findChatStreamContext(parsed.rawMessage, parsed.res);
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
  set(context.answerMsg, 'messageTip', get(message, 'message') || get(message, 'chatContent') || 'WebSocket error');
  completeChatStreamContext(context, IMessageState.Error);
  context.answerMsg = context.updateMessage(context.answerMsg);
};

export const hydrateRunningSessions = (runningInfoList: RunningChatInfo[] = []) => {
  runningInfoList.forEach((item) => {
    if (item.running) {
      chatSessionRuntimeManager.hydrateRunning(item);
      return;
    }
    chatSessionRuntimeManager.completeBySession(item.sessionId);
  });
};

export const clearChatRuntime = () => {
  pendingChatContexts.clear();
  sessionChatContexts.clear();
  restoredStreamBuffer.clear();
  restoringStreamKeys.clear();
  chatSessionRuntimeManager.clear();
};
