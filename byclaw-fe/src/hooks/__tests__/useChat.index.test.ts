const mockUpdateMessage = jest.fn((msg: any) => msg);

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
    messageList: [],
    hasMore: false,
    deleteMessage: jest.fn(),
    setSessionId: jest.fn(),
    getMoreSessionMessage: jest.fn(),
    setMessageList: jest.fn(),
    updateMessage: mockUpdateMessage,
    reloadLatestMessageList: jest.fn(),
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
const mockUseAppStore = useAppStore as jest.Mock;
const mockGetChatRunningStatus = getChatRunningStatus as jest.MockedFunction<typeof getChatRunningStatus>;
const mockGetChatRunningSnapshot = getChatRunningSnapshot as jest.MockedFunction<typeof getChatRunningSnapshot>;

describe('hooks/useChat/index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearChatRuntime();
    chatSessionRuntimeManager.clear();
    mockUpdateMessage.mockImplementation((msg: any) => msg);
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
