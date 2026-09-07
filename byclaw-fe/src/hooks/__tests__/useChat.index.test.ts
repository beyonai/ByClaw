const mockUpdateMessage = jest.fn((msg: any) => msg);
const mockReloadLatestMessageList = jest.fn(() => Promise.resolve());
let mockMessageList: any[] = [];
let mockReconnectHandler: (() => void) | undefined;

jest.mock('@/utils/websocket', () => ({
  __esModule: true,
  default: {
    onReconnect: (handler: () => void) => {
      mockReconnectHandler = handler;
      return () => {
        if (mockReconnectHandler === handler) {
          mockReconnectHandler = undefined;
        }
      };
    },
    onMessage: jest.fn(),
    offMessage: jest.fn(),
    sendMessageWhenReady: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@umijs/max', () => ({
  useSelector: jest.fn(),
  useDispatch: jest.fn(),
  getDvaApp: jest.fn(() => ({
    _store: {
      getState: () => ({
        user: {
          userInfo: {
            userId: 'u1',
            userName: 'User One',
          },
        },
      }),
    },
  })),
}));

jest.mock('../usePersistFn', () => ({
  __esModule: true,
  default: (fn: (...args: any[]) => any) => fn,
}));

jest.mock('../useSseSender/useSend', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    send: jest.fn(),
  })),
  formatStreamPayload: jest.fn(() => ({})),
}));

jest.mock('../useChat/useMessage', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    messageList: mockMessageList,
    hasMore: false,
    deleteMessage: jest.fn(),
    setSessionId: jest.fn(),
    getMoreSessionMessage: jest.fn(),
    setMessageList: jest.fn(),
    updateMessage: mockUpdateMessage,
    reloadLatestMessageList: mockReloadLatestMessageList,
  })),
}));

jest.mock('../useChat/useHandler', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    sessionInfoHandler: jest.fn((props: any) => props),
    messageIdHandler: jest.fn((props: any) => {
      if (props.sseRes?.messageId) {
        props.newAnswerMsg.messageId = `${props.sseRes.messageId}`;
      }
      return props;
    }),
    queryMessageIdHandler: jest.fn((props: any) => props),
    messageHandler: jest.fn((props: any) => props),
    resComIdsHandler: jest.fn((props: any) => props),
    textHandler: jest.fn((props: any) => props),
    rewriteQuestionHandler: jest.fn((props: any) => props),
  })),
}));

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    agentId: 'agent-1',
    EventEmitter: { emit: jest.fn() },
  })),
}));

jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@/service/message', () => ({
  stopChat: jest.fn(),
  getChatRunningStatus: jest.fn(() => Promise.resolve([])),
  getChatRunningSnapshot: jest.fn(() => Promise.resolve(null)),
}));

import { act, renderHook } from '@testing-library/react';
import { useDispatch, useSelector } from '@umijs/max';
import useAppStore from '@/models/common/useAppStore';
import { getChatRunningSnapshot, getChatRunningStatus } from '@/service/message';
import { chatSessionRuntimeManager } from '@/utils/chatSessionRuntimeManager';
import webSocketManager from '@/utils/websocket';
import { IMessageState, SSEMessageType } from '@/constants/message';
import { clearChatRuntime, handleParsedChatStream, handleTaskPlanSnapshot } from '../useChat/chatRuntime';

import { subscribeChatStream } from '../useSseSender/chatStream';
import useChat from '../useChat';

const mockUseDispatch = useDispatch as jest.Mock;
const mockUseSelector = useSelector as jest.Mock;
const mockUseAppStore = useAppStore as jest.Mock;
const mockGetChatRunningStatus = getChatRunningStatus as jest.MockedFunction<typeof getChatRunningStatus>;
const mockGetChatRunningSnapshot = getChatRunningSnapshot as jest.MockedFunction<typeof getChatRunningSnapshot>;
const mockSendMessageWhenReady = webSocketManager.sendMessageWhenReady as jest.Mock;

describe('hooks/useChat/index', () => {
  it('restores a turn missed entirely while this client was disconnected', async () => {
    renderHook(() => useChat({ sessionId: '101', addSession: jest.fn() } as any));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    mockGetChatRunningStatus.mockResolvedValue([
      {
        sessionId: '101',
        running: true,
        traceId: 'trace-1',
        clientRequestId: 'client-1',
        modelAnswerMessageId: '201',
        userMessageId: '111',
        chatContent: 'hello from device A',
      },
    ] as any);
    act(() => {
      chatSessionRuntimeManager.register({
        sessionId: '101',
        clientRequestId: 'old-client',
        traceId: 'old-trace',
        restored: false,
      });
    });
    mockGetChatRunningSnapshot.mockResolvedValue({
      sessionId: '101',
      messageId: '201',
      traceId: 'trace-1',
      snapshotStreamId: '1-0',
      msgContent: 'recovered answer',
      running: true,
    } as any);
    await act(async () => {
      mockReconnectHandler?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: '111',
        text: 'hello from device A',
        fromBeyond: false,
      }),
      { isAssign: true }
    );
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: '201',
        sessionId: '101',
        snapshotStreamId: '1-0',
      }),
      { isAssign: true }
    );
    expect(mockSendMessageWhenReady).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TASK_PLAN_GET',
        sessionId: '101',
        messageId: '201',
      })
    );
    expect(chatSessionRuntimeManager.getBySession('101')?.clientRequestId).toBe('client-1');
    expect(
      handleTaskPlanSnapshot({
        type: 'TASK_PLAN_SNAPSHOT',
        sessionId: '101',
        clientRequestId: 'client-1',
        data: { planId: 'p1', sessionId: '101', messageId: '201', version: 2 },
      })
    ).toBe(true);
  });

  it('reloads history on reconnect even when the entire completed turn was missed', async () => {
    renderHook(() => useChat({ sessionId: '101', addSession: jest.fn() } as any));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(chatSessionRuntimeManager.isSessionRunning('101')).toBe(false);
    await act(async () => {
      mockReconnectHandler?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockReloadLatestMessageList).toHaveBeenCalled();
  });

  it('keeps the task plan when its WS reply arrives before the running HTTP snapshot', async () => {
    mockGetChatRunningStatus.mockResolvedValue([
      {
        sessionId: '101',
        running: true,
        traceId: 'trace-1',
        clientRequestId: 'client-1',
        modelAnswerMessageId: '201',
        userMessageId: '111',
      },
    ] as any);
    mockGetChatRunningSnapshot.mockImplementation(async () => {
      expect(
        handleTaskPlanSnapshot({
          type: 'TASK_PLAN_SNAPSHOT',
          sessionId: '101',
          clientRequestId: 'client-1',
          data: { planId: 'p1', sessionId: '101', messageId: '201', version: 3 },
        })
      ).toBe(true);
      return {
        sessionId: '101',
        messageId: '201',
        traceId: 'trace-1',
        snapshotStreamId: '1-0',
        msgContent: 'recovered answer',
        running: true,
      } as any;
    });
    renderHook(() => useChat({ sessionId: '101', addSession: jest.fn() } as any));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const lastAnswerUpdate = mockUpdateMessage.mock.calls.filter(([msg]) => msg.messageId === '201').pop();
    expect(lastAnswerUpdate?.[0].taskPlan?.version).toBe(3);
    expect(lastAnswerUpdate?.[0].snapshotStreamId).toBe('1-0');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearChatRuntime();
    chatSessionRuntimeManager.clear();
    mockUpdateMessage.mockImplementation((msg: any) => msg);
    mockReloadLatestMessageList.mockResolvedValue(undefined);
    mockMessageList = [];
    mockReconnectHandler = undefined;
    mockGetChatRunningStatus.mockResolvedValue([]);
    mockGetChatRunningSnapshot.mockResolvedValue(null);
    mockUseDispatch.mockReturnValue(jest.fn());
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        user: {
          userInfo: {
            userId: 'u1',
            isRetented: true,
          },
        },
        session: {
          extParamsBySessionId: {},
        },
        employees: {
          defaultDigEmployeeId: '',
          employeesList: [],
        },
      })
    );
    mockUseAppStore.mockReturnValue({
      setUserCollectModalOpen: jest.fn(),
      setLoginModalOpen: jest.fn(),
    });
  });

  it('restores a v2 running snapshot with its active thinking block open', async () => {
    mockGetChatRunningStatus.mockResolvedValue([
      {
        sessionId: 's1',
        running: true,
        traceId: 'trace-1',
        clientRequestId: 'client-1',
        modelAnswerMessageId: 'answer-1',
        userMessageId: 'query-1',
      },
    ] as any);
    mockGetChatRunningSnapshot.mockResolvedValue({
      sessionId: 's1',
      messageId: 'answer-1',
      traceId: 'trace-1',
      metadata: JSON.stringify({ messageRenderVersion: 'v2' }),
      inferLog: JSON.stringify([
        {
          seq: 3,
          contentType: SSEMessageType.thinkText,
          orderId: 'reasoning',
          parentOrderId: '-1',
          choices: [{ delta: { content: '思考中' } }],
        },
      ]),
      messageStruct: JSON.stringify([]),
      snapshotStreamId: '3-0',
    } as any);

    renderHook(() => useChat({ sessionId: 's1', addSession: jest.fn() } as any));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'answer-1',
        messageState: IMessageState.Answer,
        thinkDone: false,
        _v2NextSeq: 4,
        _v2LastChannel: 'thinkList',
      }),
      { isAssign: true }
    );
  });

  it('requests the latest task plan while restoring a running session', async () => {
    mockGetChatRunningStatus.mockResolvedValue([
      {
        sessionId: '101',
        running: true,
        traceId: 'trace-1',
        clientRequestId: '111_201',
        modelAnswerMessageId: '201',
        userMessageId: '111',
      },
    ] as any);

    renderHook(() => useChat({ sessionId: '101', addSession: jest.fn() } as any));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSendMessageWhenReady).toHaveBeenCalledWith({
      type: 'TASK_PLAN_GET',
      clientRequestId: '111_201',
      sessionId: '101',
      messageId: '201',
      traceId: 'trace-1',
    });
  });

  it('restores a missing runtime and task plan after websocket reconnect', async () => {
    renderHook(() => useChat({ sessionId: '101', addSession: jest.fn() } as any));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(chatSessionRuntimeManager.isSessionRunning('101')).toBe(false);

    mockSendMessageWhenReady.mockClear();
    mockGetChatRunningStatus.mockResolvedValue([
      {
        sessionId: '101',
        running: true,
        traceId: 'trace-1',
        clientRequestId: '111_201',
        modelAnswerMessageId: '201',
        userMessageId: '111',
      },
    ] as any);

    await act(async () => {
      mockReconnectHandler?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(chatSessionRuntimeManager.isSessionRunning('101')).toBe(true);
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: '201',
        sessionId: '101',
        fromBeyond: true,
      }),
      { isAssign: true }
    );
    expect(mockSendMessageWhenReady).toHaveBeenCalledWith({
      type: 'TASK_PLAN_GET',
      clientRequestId: '111_201',
      sessionId: '101',
      messageId: '201',
      traceId: 'trace-1',
    });
  });

  it('reloads the latest history after reconnect when the backend is no longer running', async () => {
    renderHook(() => useChat({ sessionId: '101', addSession: jest.fn() } as any));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    mockReloadLatestMessageList.mockClear();
    mockGetChatRunningStatus.mockResolvedValue([]);
    await act(async () => {
      mockReconnectHandler?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockReloadLatestMessageList).toHaveBeenCalledTimes(1);
  });

  it('requests the latest task plan after another client initializes its answer', async () => {
    renderHook(() => useChat({ sessionId: '101', addSession: jest.fn() } as any));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const newMessageHandler = (webSocketManager.onMessage as jest.Mock).mock.calls.find(
      ([type]) => type === 'NEW_MESSAGE'
    )![1];
    act(() => {
      newMessageHandler({
        type: 'NEW_MESSAGE',
        clientRequestId: '111_201',
        sessionId: '101',
        agentId: 'agent-1',
        data: {
          creatorId: 'u1',
          usage: 1,
          sessionId: '101',
          messageId: '111',
          messageContent: '{"text":"hello"}',
        },
      });
    });
    expect(chatSessionRuntimeManager.isSessionRunning('101')).toBe(true);

    mockSendMessageWhenReady.mockClear();
    const unsubscribe = subscribeChatStream({ match: () => true, onPayload: handleParsedChatStream });
    const backendFrame = {
      type: 'CHAT_STREAM',
      clientRequestId: 'client-1',
      sessionId: '101',
      event: 'initialization',
      data: JSON.stringify({ messageId: '201', queryMessageId: '111', traceId: 'trace-1' }),
    };
    const streamHandler = (webSocketManager.onMessage as jest.Mock).mock.calls.find(
      ([type]) => type === backendFrame.type
    )![1];
    act(() => streamHandler(backendFrame));
    unsubscribe();

    expect(mockSendMessageWhenReady).toHaveBeenCalledWith({
      type: 'TASK_PLAN_GET',
      clientRequestId: '111_201',
      sessionId: '101',
      messageId: '201',
      traceId: 'trace-1',
    });
  });

  it('opens the login modal and aborts when user is not logged in', async () => {
    const setLoginModalOpen = jest.fn();
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        user: {
          userInfo: undefined,
        },
        session: {
          extParamsBySessionId: {},
        },
        employees: {
          defaultDigEmployeeId: '',
          employeesList: [],
        },
      })
    );
    mockUseAppStore.mockReturnValue({
      setUserCollectModalOpen: jest.fn(),
      setLoginModalOpen,
    });

    const { result } = renderHook(() =>
      useChat({
        sessionId: 's1',
        addSession: jest.fn(),
      } as any)
    );

    await expect(result.current.sendQuery({ queryQuestion: 'hello' })).resolves.toBe(false);
    expect(setLoginModalOpen).toHaveBeenCalledWith(true);
  });

  it('opens the collect modal when retention consent is missing', async () => {
    const setUserCollectModalOpen = jest.fn();
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        user: {
          userInfo: {
            userId: 'u1',
            isRetented: false,
          },
        },
        session: {
          extParamsBySessionId: {},
        },
        employees: {
          defaultDigEmployeeId: '',
          employeesList: [],
        },
      })
    );
    mockUseAppStore.mockReturnValue({
      setUserCollectModalOpen,
      setLoginModalOpen: jest.fn(),
    });

    const { result } = renderHook(() =>
      useChat({
        sessionId: 's1',
        addSession: jest.fn(),
      } as any)
    );

    await expect(result.current.sendQuery({ queryQuestion: 'hello' })).resolves.toBe(false);
    expect(setUserCollectModalOpen).toHaveBeenCalledWith(true);
  });
});
