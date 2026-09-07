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

const mockSend = jest.fn((text?: string, payload?: any) => {
  void text;
  void payload;
  return {
    promise: Promise.resolve({}),
    cancel: jest.fn(),
  };
});
const mockUpdateMessage = jest.fn((msg: any) => msg);
const mockWaitForSessionMessageLoaded = jest.fn(() => Promise.resolve());
const mockReloadLatestMessageList = jest.fn(() => Promise.resolve());
let mockMessageList: any[] = [];
let mockReconnectHandler: (() => void) | undefined;
let mockExtParamsBySessionId: Record<string, unknown> = {};
let mockSessionList: any[] = [];
let mockMessageLoadState = 'idle';
const mockRetrySessionMessageLoad = jest.fn(() => Promise.resolve());

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

jest.mock('../usePersistFn', () => ({
  __esModule: true,
  default: (fn: (...args: any[]) => any) => fn,
}));

jest.mock('../useSseSender/useSend', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    send: mockSend,
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
    waitForSessionMessageLoaded: mockWaitForSessionMessageLoaded,
    getSessionMessageLoadState: jest.fn(() => mockMessageLoadState),
    retrySessionMessageLoad: mockRetrySessionMessageLoad,
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
const mockUseAppStore = useAppStore as unknown as jest.Mock;
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
    mockSend.mockReturnValue({
      promise: Promise.resolve({}),
      cancel: jest.fn(),
    });
    mockUpdateMessage.mockImplementation((msg: any) => msg);
    mockWaitForSessionMessageLoaded.mockResolvedValue(undefined);
    mockReloadLatestMessageList.mockResolvedValue(undefined);
    mockMessageList = [];
    mockReconnectHandler = undefined;
    mockExtParamsBySessionId = {};
    mockSessionList = [];
    mockMessageLoadState = 'idle';
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
          extParamsBySessionId: mockExtParamsBySessionId,
          sessionList: mockSessionList,
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

  it('waits for session messages before restoring running messages', async () => {
    let resolveSessionMessages!: () => void;
    const sessionMessagesPromise = new Promise<void>((resolve) => {
      resolveSessionMessages = resolve;
    });
    mockWaitForSessionMessageLoaded.mockReturnValue(sessionMessagesPromise);
    mockGetChatRunningStatus.mockResolvedValue([
      {
        sessionId: '101',
        running: true,
        traceId: 'trace-1',
        clientRequestId: 'client-1',
        modelAnswerMessageId: '201',
        userMessageId: 'query-1',
        chatContent: 'hello',
      },
    ] as any);

    renderHook(() =>
      useChat({
        sessionId: '101',
        addSession: jest.fn(),
      } as any)
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockWaitForSessionMessageLoaded).toHaveBeenCalledWith('101');
    expect(mockGetChatRunningStatus).not.toHaveBeenCalled();
    expect(mockUpdateMessage).not.toHaveBeenCalled();

    await act(async () => {
      resolveSessionMessages();
      await sessionMessagesPromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetChatRunningStatus).toHaveBeenCalledWith({ sessionIds: ['101'] });
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: '201',
        sessionId: '101',
      }),
      { isAssign: true }
    );
    expect(mockSendMessageWhenReady).toHaveBeenCalledWith({
      type: 'TASK_PLAN_GET',
      clientRequestId: 'client-1',
      sessionId: '101',
      messageId: '201',
      traceId: 'trace-1',
      laneId: undefined,
    });
  });

  it('requests the latest task plan after websocket reconnect', async () => {
    mockMessageList = [
      {
        messageId: '201',
        msgId: 'answer_client-1',
        messageState: IMessageState.Answer,
        sessionId: '101',
      },
    ];
    mockGetChatRunningStatus.mockResolvedValue([]);

    renderHook(() => useChat({ sessionId: '101', addSession: jest.fn() } as any));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    mockSendMessageWhenReady.mockClear();
    mockGetChatRunningStatus.mockResolvedValue([
      {
        sessionId: '101',
        running: true,
        traceId: 'trace-1',
        clientRequestId: 'client-1',
        modelAnswerMessageId: '201',
      },
    ] as any);

    await act(async () => {
      mockReconnectHandler?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSendMessageWhenReady).toHaveBeenCalledWith({
      type: 'TASK_PLAN_GET',
      clientRequestId: 'client-1',
      sessionId: '101',
      messageId: '201',
      traceId: 'trace-1',
      laneId: undefined,
    });
  });

  it('requests the latest task plan after another device initializes its answer message', async () => {
    renderHook(() => useChat({ sessionId: '101', addSession: jest.fn() } as any));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const newMessageHandler = (webSocketManager.onMessage as jest.Mock).mock.calls.find(
      ([type]) => type === 'NEW_MESSAGE'
    )![1];
    await act(async () => {
      await newMessageHandler({
        type: 'NEW_MESSAGE',
        clientRequestId: 'client-1',
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
      clientRequestId: 'client-1',
      sessionId: '101',
      messageId: '201',
      traceId: 'trace-1',
      laneId: undefined,
    });
  });

  it('restores an idle parent without loading while children work and resumes on a later root event', async () => {
    mockGetChatRunningStatus.mockResolvedValue([
      {
        sessionId: 's1',
        running: true,
        traceId: 'trace-1',
        clientRequestId: 'query_answer',
        modelAnswerMessageId: 'answer-1',
        userMessageId: 'query-1',
        runtimeSource: 'test-engine',
        runtimeStatus: 'running',
        rootActive: false,
        acceptingInput: true,
        activeAgentCount: 1,
        activeChildCount: 1,
        runtimeRevision: 2,
        runtimeChangedAt: 1000,
      },
    ] as any);
    mockGetChatRunningSnapshot.mockResolvedValue({
      messageId: 'answer-1',
      sessionId: 's1',
      traceId: 'trace-1',
      running: true,
      msgContent: '团队已经开始工作',
      msgStatus: '1',
      snapshotStreamId: '1000-1',
    } as any);

    const { result } = renderHook(() => useChat({ sessionId: 's1', addSession: jest.fn() } as any));
    await act(async () => {
      await Promise.resolve();
    });

    const answer = mockUpdateMessage.mock.calls.at(-1)?.[0];
    expect(answer.messageState).toBe(IMessageState.Done);
    expect(answer.thinkDone).toBe(true);
    expect(result.current.canAcceptInput).toBe(true);
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);

    const { handleSessionRuntimeState } = await import('../useChat/chatRuntime');
    await act(async () => {
      handleSessionRuntimeState({
        sessionId: 's1',
        traceId: 'trace-1',
        source: 'test-engine',
        status: 'running',
        rootActive: true,
        acceptingInput: false,
        activeAgentCount: 1,
        activeChildCount: 0,
        waitingInteractionCount: 0,
        revision: 3,
        changedAt: 2000,
      });
    });
    expect(answer.messageState).toBe(IMessageState.Answer);
    expect(result.current.canAcceptInput).toBe(false);
  });

  it('exposes the current session message loading state and retry action', async () => {
    mockMessageLoadState = 'error';
    const { result } = renderHook(() => useChat({ sessionId: 'child-1', addSession: jest.fn() } as any));

    expect(result.current.sessionMessageLoadState).toBe('error');
    await result.current.retrySessionMessageLoad();
    expect(mockRetrySessionMessageLoad).toHaveBeenCalledWith('child-1');
  });

  it('clears a restored session when reconnect reconciliation finds no backend runtime', async () => {
    chatSessionRuntimeManager.register({
      clientRequestId: 'client-1',
      sessionId: 's1',
      traceId: 'trace-1',
      restored: true,
    });
    mockGetChatRunningStatus.mockResolvedValue([]);

    renderHook(() => useChat({ sessionId: 's1', addSession: jest.fn() } as any));

    await act(async () => {
      mockReconnectHandler?.();
      await Promise.resolve();
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(false);
    expect(mockReloadLatestMessageList).toHaveBeenCalled();
  });

  it('finishes loading from a terminal snapshot during reconnect reconciliation', async () => {
    const answerMessage = {
      messageId: 'answer-1',
      msgId: 'answer_client-1',
      messageState: IMessageState.Answer,
      sessionId: 's1',
    } as any;
    mockMessageList = [answerMessage];
    chatSessionRuntimeManager.register({
      clientRequestId: 'client-1',
      sessionId: 's1',
      traceId: 'trace-1',
      restored: true,
    });
    mockGetChatRunningStatus.mockResolvedValue([
      {
        sessionId: 's1',
        running: true,
        traceId: 'trace-1',
        clientRequestId: 'client-1',
        modelAnswerMessageId: 'answer-1',
      },
    ] as any);
    mockGetChatRunningSnapshot.mockResolvedValue({
      sessionId: 's1',
      messageId: 'answer-1',
      traceId: 'trace-1',
      messageContent: 'finished answer',
      running: false,
      snapshotStreamId: '100-0',
    } as any);

    renderHook(() => useChat({ sessionId: 's1', addSession: jest.fn() } as any));

    await act(async () => {
      mockReconnectHandler?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(answerMessage.messageState).toBe(IMessageState.Done);
    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(false);
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

  it('restores an external child projection without waiting for the parent chat runtime registry', async () => {
    mockSessionList = [
      {
        sessionId: 'child',
        parentSessionId: 100,
        sessionExts: [{ extParamCode: 'external_session_id', extParamValue: 'worker-child-1' }],
      },
    ];
    mockGetChatRunningSnapshot.mockResolvedValue({
      sessionId: 'child',
      messageId: 'answer-1',
      messageContent: 'child result',
      msgStatus: 0,
      running: false,
      snapshotStreamId: '200-0',
    } as any);

    renderHook(() => useChat({ sessionId: 'child', addSession: jest.fn() } as any));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetChatRunningStatus).not.toHaveBeenCalled();
    expect(mockGetChatRunningSnapshot).toHaveBeenCalledWith({
      sessionId: 'child',
      traceId: 'external-child-child',
    });
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'answer-1',
        sessionId: 'child',
        messageState: IMessageState.Done,
        snapshotStreamId: '200-0',
      }),
      { isAssign: true, allowCreateSession: false }
    );
  });

  it('does not let an older reconnect snapshot overwrite a newer external child projection', async () => {
    mockSessionList = [
      {
        sessionId: 'child',
        parentSessionId: 100,
        sessionExts: [{ extParamCode: 'external_session_id', extParamValue: 'worker-child-1' }],
      },
    ];
    mockGetChatRunningSnapshot
      .mockResolvedValueOnce({
        sessionId: 'child',
        messageId: 'answer-1',
        messageContent: 'newer',
        msgStatus: 1,
        running: true,
        snapshotStreamId: '200-1',
      } as any)
      .mockResolvedValueOnce({
        sessionId: 'child',
        messageId: 'answer-1',
        messageContent: 'older',
        msgStatus: 1,
        running: true,
        snapshotStreamId: '200-0',
      } as any);

    renderHook(() => useChat({ sessionId: 'child', addSession: jest.fn() } as any));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      mockReconnectHandler?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetChatRunningSnapshot).toHaveBeenCalledTimes(2);
    expect(mockUpdateMessage).toHaveBeenCalledTimes(1);
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'answer-1', snapshotStreamId: '200-1' }),
      { isAssign: true, allowCreateSession: false }
    );
  });

  it('reloads persisted child history when the reconnect snapshot is absent', async () => {
    mockSessionList = [
      {
        sessionId: 'child',
        parentSessionId: 100,
        sessionExts: [{ extParamCode: 'external_session_id', extParamValue: 'worker-child-1' }],
      },
    ];
    mockGetChatRunningSnapshot.mockResolvedValue(null);

    renderHook(() => useChat({ sessionId: 'child', addSession: jest.fn() } as any));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockReloadLatestMessageList).toHaveBeenCalled();
    expect(mockGetChatRunningStatus).not.toHaveBeenCalled();
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

  it('allows parent input while child work remains active when runtime explicitly permits it', async () => {
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: 's1',
      traceId: 'trace-1',
      status: 'running',
      activeAgentCount: 1,
      activeChildCount: 1,
      waitingInteractionCount: 0,
      rootActive: false,
      acceptingInput: true,
      revision: 1,
      changedAt: 1000,
    });
    const { result } = renderHook(() => useChat({ sessionId: 's1', addSession: jest.fn() } as any));

    expect(result.current.isSessionRunning).toBe(true);
    expect(result.current.canAcceptInput).toBe(true);

    await act(async () => {
      await result.current.sendQuery({ queryQuestion: 'next task' });
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('blocks parent input while the root runtime is active', async () => {
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: 's1',
      traceId: 'trace-1',
      status: 'running',
      activeAgentCount: 1,
      activeChildCount: 0,
      waitingInteractionCount: 0,
      rootActive: true,
      acceptingInput: false,
      revision: 1,
      changedAt: 1000,
    });
    const { result } = renderHook(() => useChat({ sessionId: 's1', addSession: jest.fn() } as any));

    await expect(result.current.sendQuery({ queryQuestion: 'blocked' })).resolves.toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends multi-agent lane metadata and creates one answer placeholder per lane', async () => {
    const { result } = renderHook(() =>
      useChat({
        sessionId: 's1',
        addSession: jest.fn(),
      } as any)
    );

    await act(async () => {
      await result.current.sendQuery({
        queryQuestion: '@Agent A @Agent B hello',
        resourceList: [
          {
            id: 'DIG_EMPLOYEE_101',
            resourceType: 'DIG_EMPLOYEE',
            resourceId: '101',
            resourceName: 'Agent A',
            resourceCode: 'agent-a',
          },
          {
            id: 'DIG_EMPLOYEE_102',
            resourceType: 'DIG_EMPLOYEE',
            resourceId: '102',
            resourceName: 'Agent B',
            resourceCode: 'agent-b',
          },
        ],
      } as any);
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0]?.[1] as any;
    expect(payload.multiAgent).toMatchObject({
      mode: 'parallel',
      lanes: [
        {
          agentId: '101',
          agentCode: 'agent-a',
          agentName: 'Agent A',
          order: 0,
        },
        {
          agentId: '102',
          agentCode: 'agent-b',
          agentName: 'Agent B',
          order: 1,
        },
      ],
    });
    expect(payload.multiAgent.turnId).toBeTruthy();
    expect(payload.extParams.multiAgent).toEqual(payload.multiAgent);
    expect(payload.clientRequestId).toBe(payload.multiAgent.lanes[0].clientRequestId);
    expect(payload.multiAgent.lanes[0].queryMessageId).toBe(payload.multiAgent.turnId);
    expect(payload.multiAgent.lanes[0].answerMessageId).toBe(payload.multiAgent.lanes[0].laneId);
    expect(payload.multiAgent.lanes[1].answerMessageId).toBe(payload.multiAgent.lanes[1].laneId);

    const updatedMessages = mockUpdateMessage.mock.calls.map(([msg]) => msg);
    expect(updatedMessages.filter((msg) => msg.fromBeyond)).toHaveLength(2);
    expect(updatedMessages.filter((msg) => !msg.fromBeyond)).toHaveLength(1);
    expect(updatedMessages.filter((msg) => msg.fromBeyond).map((msg) => msg.agentId)).toEqual(['101', '102']);
  });

  it('uses the single inline mentioned digital employee for the answer placeholder even when payload has an agentId', async () => {
    const { result } = renderHook(() =>
      useChat({
        sessionId: 's1',
        addSession: jest.fn(),
      } as any)
    );

    await act(async () => {
      await result.current.sendQuery({
        queryQuestion: '@Agent B hello',
        payload: {
          agentId: 'default-agent',
          agentType: 'agent',
        },
        resourceList: [
          {
            id: 'DIG_EMPLOYEE_102',
            resourceType: 'DIG_EMPLOYEE',
            resourceId: '102',
            resourceName: 'Agent B',
            resourceCode: 'agent-b',
          },
        ],
      } as any);
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0]?.[1] as any;
    expect(payload.agentId).toBe('102');
    expect(payload.agentCode).toBeNull();
    expect(payload.resourceList).toEqual([
      {
        id: 'DIG_EMPLOYEE_102',
        resourceType: 'DIG_EMPLOYEE',
        resourceId: '102',
        resourceName: 'Agent B',
        resourceCode: 'agent-b',
      },
    ]);

    const answerMessage = mockUpdateMessage.mock.calls.map(([msg]) => msg).find((msg) => msg.fromBeyond);
    expect(answerMessage.agentId).toBe('102');
    expect(answerMessage.agentCode).toBe('agent-b');
    expect(answerMessage.agentName).toBe('Agent B');
    expect(answerMessage.resourceList).toEqual([
      {
        id: 'DIG_EMPLOYEE_102',
        resourceType: 'DIG_EMPLOYEE',
        resourceId: '102',
        resourceName: 'Agent B',
        resourceCode: 'agent-b',
      },
    ]);
    expect(JSON.parse(answerMessage.metadata)).toMatchObject({
      agentId: '102',
      agentCode: 'agent-b',
      agentName: 'Agent B',
    });
  });

  it('keeps the fixed debug employee instead of falling back to the global agent', async () => {
    const { result } = renderHook(() =>
      useChat({
        sessionId: '',
        fixedAgentId: '90001',
        addSession: jest.fn(),
      } as any)
    );

    await act(async () => {
      await result.current.sendQuery({ queryQuestion: '调试数字员工组' });
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0]?.[1]).toMatchObject({
      agentId: '90001',
      agentCode: null,
    });
  });
});
