jest.mock('@/hooks/useSseSender/chatStream', () => ({
  compareStreamId: (a?: string, b?: string) => {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    return Number(a) - Number(b);
  },
}));

import { IMessageState } from '@/constants/message';
import { chatSessionRuntimeManager } from '@/utils/chatSessionRuntimeManager';

import {
  clearChatRuntime,
  flushRestoredChatStreamBuffer,
  getRestoredStreamKey,
  handleChatStreamError,
  handleParsedChatStream,
  registerPendingChatContext,
  registerSessionChatContext,
  startRestoringChatStream,
} from '../useChat/chatRuntime';

const createParsed = (overrides: Record<string, any> = {}) =>
  ({
    eventName: 'answerDelta',
    formattedPayload: {
      sessionId: 's1',
      message: {
        contentType: 'text',
        content: { substance: 'hello' },
        status: 'running',
      },
    },
    res: {
      sessionId: 's1',
    },
    sseMsg: {
      event: 'answerDelta',
      data: '{}',
    },
    rawMessage: {
      type: 'CHAT_STREAM',
      clientRequestId: 'c1',
      sessionId: 's1',
      data: {},
    },
    isError: false,
    isDone: false,
    ...overrides,
  } as any);

describe('hooks/useChat/chatRuntime', () => {
  beforeEach(() => {
    clearChatRuntime();
  });

  it('keeps a pending context alive and applies stream payloads', () => {
    const queryMsg: any = { msgId: 'q1', sessionId: 's1' };
    const answerMsg: any = { msgId: 'c1', sessionId: 's1', messageState: IMessageState.Query };
    const updateMessage = jest.fn((msg) => msg);
    const flowHandler = jest.fn(({ newAnswerMsg, sseRes }) => {
      newAnswerMsg.messageList = [sseRes.message];
    });

    registerPendingChatContext({
      clientRequestId: 'c1',
      queryMsg,
      answerMsg,
      getMessageList: () => [queryMsg, answerMsg],
      flowHandler,
      updateMessage,
    });
    chatSessionRuntimeManager.register({
      clientRequestId: 'c1',
      answerClientMsgId: 'c1',
      sessionId: 's1',
    });

    handleParsedChatStream(createParsed());

    expect(flowHandler).toHaveBeenCalled();
    expect(updateMessage).toHaveBeenCalledWith(queryMsg);
    expect(updateMessage).toHaveBeenCalledWith(answerMsg, { isAssign: undefined });
    expect(answerMsg.messageList).toHaveLength(1);
  });

  it('does not create message cache when no context exists', () => {
    expect(() => handleParsedChatStream(createParsed())).not.toThrow();
  });

  it('marks pending answers as error on websocket ERROR messages', () => {
    const queryMsg: any = { msgId: 'q1', sessionId: 's1' };
    const answerMsg: any = { msgId: 'c1', sessionId: 's1', messageState: IMessageState.Query };
    const updateMessage = jest.fn((msg) => msg);

    registerPendingChatContext({
      clientRequestId: 'c1',
      queryMsg,
      answerMsg,
      getMessageList: () => [queryMsg, answerMsg],
      flowHandler: jest.fn(),
      updateMessage,
    });

    handleChatStreamError({
      type: 'ERROR',
      clientRequestId: 'c1',
      message: 'failed',
    });

    expect(answerMsg.messageState).toBe(IMessageState.Error);
    expect(answerMsg.messageTip).toBe('failed');
    expect(updateMessage).toHaveBeenCalledWith(answerMsg);
  });

  it('buffers restored stream messages while snapshot is loading and replays by streamId', () => {
    const queryMsg: any = { msgId: 'q1', sessionId: 's1' };
    const answerMsg: any = { msgId: 'c1', sessionId: 's1', messageState: IMessageState.Answer };
    const appliedStreamIds: string[] = [];

    registerSessionChatContext('s1', {
      clientRequestId: 'c1',
      queryMsg,
      answerMsg,
      restored: true,
      getMessageList: () => [queryMsg, answerMsg],
      flowHandler: jest.fn(({ sseRes }: any) => {
        appliedStreamIds.push(sseRes.streamId);
      }),
      updateMessage: jest.fn((msg) => msg),
    });

    const restoreKey = getRestoredStreamKey('s1', 'trace-1');
    startRestoringChatStream(restoreKey);
    handleParsedChatStream(
      createParsed({
        streamId: '2',
        formattedPayload: { sessionId: 's1', streamId: '2' },
        rawMessage: { clientRequestId: 'c1', sessionId: 's1', traceId: 'trace-1', streamId: '2', data: {} },
        res: { sessionId: 's1', traceId: 'trace-1' },
      })
    );
    handleParsedChatStream(
      createParsed({
        streamId: '1',
        formattedPayload: { sessionId: 's1', streamId: '1' },
        rawMessage: { clientRequestId: 'c1', sessionId: 's1', traceId: 'trace-1', streamId: '1', data: {} },
        res: { sessionId: 's1', traceId: 'trace-1' },
      })
    );

    expect(appliedStreamIds).toEqual([]);

    flushRestoredChatStreamBuffer(restoreKey);

    expect(appliedStreamIds).toEqual(['1', '2']);
  });
});
