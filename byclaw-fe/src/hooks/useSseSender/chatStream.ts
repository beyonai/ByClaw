import { get, isEmpty, pick, set } from 'lodash';

import { SSEEventStatus, SSEMessageType } from '@/constants/message';
import webSocketManager from '@/utils/websocket';

import { answerDeltaHandler, reasoningLogHandler } from './util';

export type ParsedChatStreamMessage = {
  eventName: string;
  formattedPayload: Record<string, unknown>;
  res: any;
  sseMsg: {
    event: string;
    sessionExts?: any;
    data: string;
    id?: string;
  };
  isError: boolean;
  isDone: boolean;
  rawMessage: any;
};

type SubscribeChatStreamOptions = {
  id?: string;
  match: (message: any) => boolean;
  filterParsed?: (parsed: ParsedChatStreamMessage) => boolean;
  onPayload?: (parsed: ParsedChatStreamMessage) => void;
  onDone?: (parsed: ParsedChatStreamMessage) => void;
  onError?: (parsed: ParsedChatStreamMessage) => void;
};

export function formatStreamPayload(eventName: string, res: any) {
  const payload = {};

  switch (eventName) {
    case 'createSession':
    case 'initMessage':
    case 'initialization': {
      Object.assign(payload, { ...res });
      break;
    }
    case 'answerStart':
    case 'answerDelta':
    case 'answerEnd': {
      Object.assign(payload, answerDeltaHandler(res, eventName));
      Object.assign(payload, pick(res, ['messageId', 'queryMessageId', 'metadata', 'traceId']));
      break;
    }
    case 'reasoningLogStart':
    case 'reasoningLogDelta':
    case 'reasoningLogEnd': {
      Object.assign(payload, reasoningLogHandler(res, eventName));
      Object.assign(payload, pick(res, ['messageId', 'queryMessageId', 'metadata', 'traceId']));
      break;
    }
    case 'resComComplete':
      if (res) {
        set(payload, 'resComIds', res);
      }
      break;
    case 'appStreamResponse': {
      const { messageId, relatedResources, queryMessageId, relatedQuestions, traceId } = res;
      set(payload, 'messageId', messageId);
      set(payload, 'queryMessageId', queryMessageId);
      set(payload, 'traceId', traceId);
      set(payload, 'message', {
        contentType: SSEMessageType.appStreamResponse,
        content: {
          substance: {
            relatedResources,
            relatedQuestions,
          },
        },
        status: SSEEventStatus.done,
      });
      break;
    }
    case 'error':
      set(payload, 'message', {
        contentType: SSEMessageType.error,
        content: {
          substance: {
            msg: get(res, 'message'),
            traceback: get(res, 'traceback'),
          },
        },
        status: SSEEventStatus.done,
      });
      break;
    default:
      break;
  }

  return payload;
}

export function parseChatStreamMessage(message: any, id?: string): ParsedChatStreamMessage | undefined {
  const eventName = message.event || get(message, 'data.event');
  if (!eventName || ['moduleStatus'].includes(eventName)) return undefined;

  let res: any = message.data || {};
  if (typeof res === 'string') {
    try {
      res = JSON.parse(res) || {};
    } catch (e) {
      console.error(e, message);
      res = {};
    }
  }

  const formattedPayload = formatStreamPayload(eventName, res);
  const sseMsg = {
    event: eventName,
    sessionExts: message.sessionExts,
    data: typeof message.data === 'string' ? message.data : JSON.stringify(message.data || {}),
    id,
  };

  return {
    eventName,
    formattedPayload,
    res,
    sseMsg,
    isError: ['error'].includes(eventName),
    isDone: ['appStreamResponse'].includes(eventName),
    rawMessage: message,
  };
}

export function subscribeChatStream(options: SubscribeChatStreamOptions) {
  const { id, match, filterParsed, onPayload, onDone, onError } = options;
  const handler = (message: any) => {
    if (!match(message)) return;

    const parsed = parseChatStreamMessage(message, id);
    if (!parsed) return;
    if (filterParsed && !filterParsed(parsed)) return;

    if (!isEmpty(parsed.formattedPayload)) {
      onPayload?.(parsed);
    }
    if (parsed.isError) {
      onError?.(parsed);
    }
    if (parsed.isDone) {
      onDone?.(parsed);
    }
  };

  webSocketManager.onMessage('CHAT_STREAM', handler);
  return () => {
    webSocketManager.offMessage('CHAT_STREAM', handler);
  };
}
