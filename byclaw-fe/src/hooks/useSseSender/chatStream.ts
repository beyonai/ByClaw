import { get, isEmpty, pick, set } from 'lodash';

import { SSEEventStatus, SSEMessageType } from '@/constants/message';
import webSocketManager from '@/utils/websocket';

import { answerDeltaHandler, reasoningLogHandler } from './util';

export type ParsedChatStreamMessage = {
  eventName: string;
  formattedPayload: Record<string, unknown>;
  res: any;
  clientRequestId?: string;
  laneId?: string;
  turnId?: string;
  agentId?: string;
  agentName?: string;
  sseMsg: {
    event: string;
    sessionExts?: any;
    data: string;
    id?: string;
  };
  isError: boolean;
  isDone: boolean;
  streamId?: string;
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

const getStreamContextFields = (res: any) => {
  const metadata = {
    ...safeParseMetadata(get(res, 'metadata')),
    ...safeParseMetadata(get(res, 'data.metadata')),
  };
  return {
    ...pick(metadata, ['clientRequestId', 'laneId', 'turnId', 'agentId', 'agentCode', 'agentName']),
    ...pick(get(res, 'data') || {}, ['clientRequestId', 'laneId', 'turnId', 'agentId', 'agentCode', 'agentName']),
    ...pick(res, ['clientRequestId', 'laneId', 'turnId', 'agentId', 'agentCode', 'agentName']),
  };
};

export function formatStreamPayload(eventName: string, res: any) {
  const payload = {};
  const streamContextFields = getStreamContextFields(res);

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
      Object.assign(payload, streamContextFields);
      break;
    }
    case 'reasoningLogStart':
    case 'reasoningLogDelta':
    case 'reasoningLogEnd': {
      Object.assign(payload, reasoningLogHandler(res, eventName));
      Object.assign(payload, pick(res, ['messageId', 'queryMessageId', 'metadata', 'traceId']));
      Object.assign(payload, streamContextFields);
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
      Object.assign(payload, streamContextFields);
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
      Object.assign(payload, streamContextFields);
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
  const clientRequestId =
    get(res, 'clientRequestId') ||
    get(res, 'data.clientRequestId') ||
    get(formattedPayload, 'clientRequestId') ||
    get(message, 'clientRequestId');
  const laneId =
    get(res, 'laneId') || get(res, 'data.laneId') || get(formattedPayload, 'laneId') || get(message, 'laneId');
  const turnId =
    get(res, 'turnId') || get(res, 'data.turnId') || get(formattedPayload, 'turnId') || get(message, 'turnId');
  const agentId =
    get(res, 'agentId') || get(res, 'data.agentId') || get(formattedPayload, 'agentId') || get(message, 'agentId');
  const agentName =
    get(res, 'agentName') ||
    get(res, 'data.agentName') ||
    get(formattedPayload, 'agentName') ||
    get(message, 'agentName');
  const streamId = get(message, 'streamId') || get(res, 'streamId') || get(res, 'data.streamId');
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
    clientRequestId: clientRequestId ? `${clientRequestId}` : undefined,
    laneId: laneId ? `${laneId}` : undefined,
    turnId: turnId ? `${turnId}` : undefined,
    agentId: agentId ? `${agentId}` : undefined,
    agentName: agentName ? `${agentName}` : undefined,
    sseMsg,
    isError: ['error'].includes(eventName),
    isDone: ['appStreamResponse'].includes(eventName),
    streamId: streamId ? `${streamId}` : undefined,
    rawMessage: message,
  };
}

export function compareStreamId(a?: string, b?: string) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  const parse = (value: string) => value.split('-').map((item) => Number(item));
  const aParts = parse(`${a}`);
  const bParts = parse(`${b}`);
  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i += 1) {
    const av = Number.isFinite(aParts[i]) ? aParts[i] : 0;
    const bv = Number.isFinite(bParts[i]) ? bParts[i] : 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
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
