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

const mockSend = jest.fn((_text?: string, _payload?: any) => ({
  promise: Promise.resolve({}),
  cancel: jest.fn(),
}));
const mockUpdateMessage = jest.fn((msg: any) => msg);
const mockWaitForSessionMessageLoaded = jest.fn(() => Promise.resolve());
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
  })),
}));

jest.mock('../useChat/useHandler', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    sessionInfoHandler: jest.fn(),
    messageIdHandler: jest.fn(),
    queryMessageIdHandler: jest.fn(),
    messageHandler: jest.fn(),
    resComIdsHandler: jest.fn(),
    textHandler: jest.fn(),
    rewriteQuestionHandler: jest.fn(),
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
import { IMessageState, SSEMessageType } from '@/constants/message';
import { clearChatRuntime } from '../useChat/chatRuntime';

import useChat from '../useChat';

const mockUseDispatch = useDispatch as jest.Mock;
const mockUseSelector = useSelector as jest.Mock;
const mockUseAppStore = useAppStore as unknown as jest.Mock;
const mockGetChatRunningStatus = getChatRunningStatus as jest.MockedFunction<typeof getChatRunningStatus>;
const mockGetChatRunningSnapshot = getChatRunningSnapshot as jest.MockedFunction<typeof getChatRunningSnapshot>;

describe('hooks/useChat/index', () => {
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

  it('waits for session messages before restoring running messages', async () => {
    let resolveSessionMessages!: () => void;
    const sessionMessagesPromise = new Promise<void>((resolve) => {
      resolveSessionMessages = resolve;
    });
    mockWaitForSessionMessageLoaded.mockReturnValue(sessionMessagesPromise);
    mockGetChatRunningStatus.mockResolvedValue([
      {
        sessionId: 's1',
        running: true,
        traceId: 'trace-1',
        clientRequestId: 'client-1',
        modelAnswerMessageId: 'answer-1',
        userMessageId: 'query-1',
        chatContent: 'hello',
      },
    ] as any);

    renderHook(() =>
      useChat({
        sessionId: 's1',
        addSession: jest.fn(),
      } as any)
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockWaitForSessionMessageLoaded).toHaveBeenCalledWith('s1');
    expect(mockGetChatRunningStatus).not.toHaveBeenCalled();
    expect(mockUpdateMessage).not.toHaveBeenCalled();

    await act(async () => {
      resolveSessionMessages();
      await sessionMessagesPromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetChatRunningStatus).toHaveBeenCalledWith({ sessionIds: ['s1'] });
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'answer-1',
        sessionId: 's1',
      }),
      { isAssign: true }
    );
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
