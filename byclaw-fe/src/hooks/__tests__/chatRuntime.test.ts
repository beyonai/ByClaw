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
  handleTaskPlanSnapshot,
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

  it('routes stream payloads by lane when a session has multiple active answers', () => {
    const queryMsg: any = { msgId: 'q1', sessionId: 's1' };
    const answerA: any = { msgId: 'a1', sessionId: 's1', messageState: IMessageState.Query };
    const answerB: any = { msgId: 'a2', sessionId: 's1', messageState: IMessageState.Query };
    const flowHandlerA = jest.fn(({ newAnswerMsg, sseRes }) => {
      newAnswerMsg.messageList = [sseRes.message];
    });
    const flowHandlerB = jest.fn(({ newAnswerMsg, sseRes }) => {
      newAnswerMsg.messageList = [sseRes.message];
    });
    const updateMessage = jest.fn((msg) => msg);

    registerPendingChatContext({
      clientRequestId: 'q1_a1',
      laneId: 'lane-a',
      turnId: 'q1',
      queryMsg,
      answerMsg: answerA,
      getMessageList: () => [queryMsg, answerA, answerB],
      flowHandler: flowHandlerA,
      updateMessage,
    });
    registerPendingChatContext({
      clientRequestId: 'q1_a2',
      laneId: 'lane-b',
      turnId: 'q1',
      queryMsg,
      answerMsg: answerB,
      getMessageList: () => [queryMsg, answerA, answerB],
      flowHandler: flowHandlerB,
      updateMessage,
    });
    registerSessionChatContext('s1', {
      clientRequestId: 'q1_a1',
      laneId: 'lane-a',
      turnId: 'q1',
      queryMsg,
      answerMsg: answerA,
      getMessageList: () => [queryMsg, answerA, answerB],
      flowHandler: flowHandlerA,
      updateMessage,
    });
    registerSessionChatContext('s1', {
      clientRequestId: 'q1_a2',
      laneId: 'lane-b',
      turnId: 'q1',
      queryMsg,
      answerMsg: answerB,
      getMessageList: () => [queryMsg, answerA, answerB],
      flowHandler: flowHandlerB,
      updateMessage,
    });

    handleParsedChatStream(
      createParsed({
        formattedPayload: {
          sessionId: 's1',
          laneId: 'lane-b',
          message: {
            contentType: 'text',
            content: { substance: 'from-b' },
            status: 'running',
          },
        },
        rawMessage: {
          type: 'CHAT_STREAM',
          sessionId: 's1',
          laneId: 'lane-b',
          data: {},
        },
        res: { sessionId: 's1', laneId: 'lane-b' },
        laneId: 'lane-b',
      })
    );

    expect(flowHandlerA).not.toHaveBeenCalled();
    expect(flowHandlerB).toHaveBeenCalledTimes(1);
    expect(answerA.messageList).toBeUndefined();
    expect(answerB.messageList?.[0]?.content.substance).toBe('from-b');
  });

  it('prefers per-lane stream payload identity over the websocket envelope identity', () => {
    const queryMsg: any = { msgId: 'q1', sessionId: 's1' };
    const answerA: any = { msgId: 'a1', sessionId: 's1', messageState: IMessageState.Query };
    const answerB: any = { msgId: 'a2', sessionId: 's1', messageState: IMessageState.Query };
    const flowHandlerA = jest.fn(({ newAnswerMsg, sseRes }) => {
      newAnswerMsg.messageList = [sseRes.message];
    });
    const flowHandlerB = jest.fn(({ newAnswerMsg, sseRes }) => {
      newAnswerMsg.messageList = [sseRes.message];
    });
    const updateMessage = jest.fn((msg) => msg);

    registerPendingChatContext({
      clientRequestId: 'q1_a1',
      laneId: 'lane-a',
      turnId: 'q1',
      queryMsg,
      answerMsg: answerA,
      getMessageList: () => [queryMsg, answerA, answerB],
      flowHandler: flowHandlerA,
      updateMessage,
    });
    registerPendingChatContext({
      clientRequestId: 'q1_a2',
      laneId: 'lane-b',
      turnId: 'q1',
      queryMsg,
      answerMsg: answerB,
      getMessageList: () => [queryMsg, answerA, answerB],
      flowHandler: flowHandlerB,
      updateMessage,
    });

    handleParsedChatStream(
      createParsed({
        formattedPayload: {
          sessionId: 's1',
          clientRequestId: 'q1_a2',
          laneId: 'lane-b',
          message: {
            contentType: 'text',
            content: { substance: 'reviewer-lane' },
            status: 'running',
          },
        },
        rawMessage: {
          type: 'CHAT_STREAM',
          sessionId: 's1',
          clientRequestId: 'q1_a1',
          data: {
            clientRequestId: 'q1_a2',
            laneId: 'lane-b',
          },
        },
        res: {
          sessionId: 's1',
          clientRequestId: 'q1_a2',
          laneId: 'lane-b',
        },
        clientRequestId: 'q1_a2',
        laneId: 'lane-b',
      })
    );

    expect(flowHandlerA).not.toHaveBeenCalled();
    expect(flowHandlerB).toHaveBeenCalledTimes(1);
    expect(answerA.messageList).toBeUndefined();
    expect(answerB.messageList?.[0]?.content.substance).toBe('reviewer-lane');
  });

  it('does not fall back to a session context when multiple lanes are active and the stream has no lane key', () => {
    const queryMsg: any = { msgId: 'q1', sessionId: 's1' };
    const answerA: any = { msgId: 'a1', sessionId: 's1', messageState: IMessageState.Query };
    const answerB: any = { msgId: 'a2', sessionId: 's1', messageState: IMessageState.Query };
    const flowHandler = jest.fn();
    const updateMessage = jest.fn((msg) => msg);

    registerSessionChatContext('s1', {
      clientRequestId: 'q1_a1',
      laneId: 'lane-a',
      queryMsg,
      answerMsg: answerA,
      getMessageList: () => [queryMsg, answerA, answerB],
      flowHandler,
      updateMessage,
    });
    registerSessionChatContext('s1', {
      clientRequestId: 'q1_a2',
      laneId: 'lane-b',
      queryMsg,
      answerMsg: answerB,
      getMessageList: () => [queryMsg, answerA, answerB],
      flowHandler,
      updateMessage,
    });

    handleParsedChatStream(
      createParsed({
        rawMessage: {
          type: 'CHAT_STREAM',
          sessionId: 's1',
          data: {},
        },
        res: { sessionId: 's1' },
      })
    );

    expect(flowHandler).not.toHaveBeenCalled();
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

  it('applies only the latest task plan snapshot to the active answer', () => {
    const queryMsg: any = { msgId: 'q1', sessionId: 's1' };
    const answerMsg: any = { msgId: 'c1', messageId: 'm1', sessionId: 's1', messageState: IMessageState.Answer };
    const updateMessage = jest.fn((msg) => msg);

    registerPendingChatContext({
      clientRequestId: 'c1',
      queryMsg,
      answerMsg,
      getMessageList: () => [queryMsg, answerMsg],
      flowHandler: jest.fn(),
      updateMessage,
    });

    const createSnapshot = (version: number, status: string) => ({
      type: 'TASK_PLAN_SNAPSHOT',
      sessionId: 's1',
      messageId: 'm1',
      traceId: 'trace-1',
      data: {
        planId: 'plan-1',
        version,
        title: 'Plan',
        status: 'ACTIVE',
        sessionId: 's1',
        messageId: 'm1',
        traceId: 'trace-1',
        tasks: [{ taskId: 'task-1', position: 1, title: 'Step 1', status }],
      },
    });

    expect(handleTaskPlanSnapshot(createSnapshot(2, 'COMPLETED'))).toBe(true);
    expect(handleTaskPlanSnapshot(createSnapshot(1, 'IN_PROGRESS'))).toBe(true);

    expect(answerMsg.taskPlan.version).toBe(2);
    expect(answerMsg.taskPlan.tasks[0].status).toBe('COMPLETED');
    expect(updateMessage).toHaveBeenCalledTimes(1);
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
