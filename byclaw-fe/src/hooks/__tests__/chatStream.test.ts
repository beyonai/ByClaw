jest.mock('@/utils/websocket', () => ({
  __esModule: true,
  default: {
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

jest.mock('@/hooks/useSseSender/util', () => ({
  answerDeltaHandler: jest.fn(),
  reasoningLogHandler: jest.fn(),
}));

import { formatStreamPayload, parseChatStreamMessage, subscribeChatStream } from '../useSseSender/chatStream';
import webSocketManager from '@/utils/websocket';
import { IMessageState } from '@/constants/message';
import { clearChatRuntime, handleParsedChatStream, registerPendingChatContext } from '../useChat/chatRuntime';

describe('hooks/useSseSender/chatStream', () => {
  it.each([IMessageState.Query, IMessageState.Answer, IMessageState.Cancel])(
    'ends a correlated startup error without reviving an already cancelled answer (%s)',
    (initialState) => {
      clearChatRuntime();
      const queryMsg: any = { msgId: '1', sessionId: '3' };
      const answerMsg: any = { msgId: '2', sessionId: '3', messageState: initialState, thinkDone: false };
      const updateMessage = jest.fn((msg) => msg);
      registerPendingChatContext({
        clientRequestId: 'startup-request',
        queryMsg,
        answerMsg,
        getMessageList: () => [queryMsg, answerMsg],
        flowHandler: jest.fn(),
        updateMessage,
      });
      const parsed = parseChatStreamMessage({
        type: 'CHAT_STREAM',
        event: 'error',
        clientRequestId: 'startup-request',
        sessionId: '3',
        data: {
          event: 'error',
          clientRequestId: 'startup-request',
          sessionId: 3,
          messageId: 2,
          queryMessageId: 1,
          traceId: 'startup-trace',
          message: 'Sandbox startup failed',
        },
      });
      expect(parsed?.isError).toBe(true);
      handleParsedChatStream(parsed!);
      expect(answerMsg.messageState).toBe(
        initialState === IMessageState.Cancel ? IMessageState.Cancel : IMessageState.Error
      );
      expect(updateMessage).toHaveBeenCalledWith(answerMsg, expect.any(Object));
      clearChatRuntime();
    }
  );

  it('preserves structured quota data in terminal errors', () => {
    const quota = { errorType: 'NAS_QUOTA_EXCEEDED', quotaBytes: 1024, exceededBytes: 20 };
    const parsed = parseChatStreamMessage({ event: 'error', data: JSON.stringify({ message: 'quota', quota }) });
    expect(parsed?.isError).toBe(true);
    expect(parsed?.formattedPayload).toMatchObject({ message: { content: { substance: { quota } } } });
  });

  it.each(['finalAnswer', 'final_answer'])('preserves the final body for %s without ending the stream', (event) => {
    const parsed = parseChatStreamMessage({
      event,
      clientRequestId: 'request-1',
      data: JSON.stringify({ final_content: '**最终答复**', sessionId: 's1' }),
    });

    expect(parsed?.formattedPayload).toMatchObject({ finalContent: '**最终答复**', sessionId: 's1' });
    expect(parsed?.isDone).toBe(false);
    expect(parsed?.isError).toBe(false);
  });

  it('delivers a final body through the payload callback rather than the completion callback', () => {
    const onPayload = jest.fn();
    const onDone = jest.fn();
    const unsubscribe = subscribeChatStream({ match: () => true, onPayload, onDone });
    const handler = (webSocketManager.onMessage as jest.Mock).mock.calls.at(-1)[1];
    handler({ event: 'finalAnswer', data: { final_content: '最终答复' } });

    expect(onPayload.mock.calls[0]?.[0].formattedPayload.finalContent).toBe('最终答复');
    expect(onDone).not.toHaveBeenCalled();
    unsubscribe();
  });

  it.each(['', '  ', '[DONE]', { title: 'card' }])('ignores invalid final bodies: %s', (finalContent) => {
    expect(formatStreamPayload('finalAnswer', { final_content: finalContent })).toEqual({});
  });

  it('forwards session title update payloads', () => {
    expect(
      formatStreamPayload('sessionTitleUpdated', {
        sessionId: 's1',
        sessionName: '第一条用户文字',
      })
    ).toEqual({
      sessionId: 's1',
      sessionName: '第一条用户文字',
    });
  });
});
