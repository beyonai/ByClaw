jest.mock('@umijs/max', () => ({
  useSelector: jest.fn(),
  useDispatch: jest.fn(),
}));

jest.mock('../usePersistFn', () => ({
  __esModule: true,
  default: (fn: Function) => fn,
}));

jest.mock('../useSseSender/useSend', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    send: jest.fn(),
  })),
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
    updateMessage: jest.fn((msg: any) => msg),
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
  })),
}));

jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@/utils/sseRequestManager', () => ({
  sseRequestManager: {
    canStartNewRequest: jest.fn(),
    register: jest.fn(),
    unregister: jest.fn(),
  },
}));

jest.mock('@/service/message', () => ({
  stopChat: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import { useDispatch, useSelector } from '@umijs/max';
import useAppStore from '@/models/common/useAppStore';
import { sseRequestManager } from '@/utils/sseRequestManager';

import useChat from '../useChat';

const mockUseDispatch = useDispatch as jest.Mock;
const mockUseSelector = useSelector as jest.Mock;
const mockUseAppStore = useAppStore as jest.Mock;

describe('hooks/useChat/index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      })
    );
    mockUseAppStore.mockReturnValue({
      setUserCollectModalOpen: jest.fn(),
      setLoginModalOpen: jest.fn(),
    });
    (sseRequestManager.canStartNewRequest as jest.Mock).mockReturnValue(true);
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

  it('blocks new sends when SSE concurrency is exhausted', async () => {
    (sseRequestManager.canStartNewRequest as jest.Mock).mockReturnValue(false);

    const { result } = renderHook(() =>
      useChat({
        sessionId: 's1',
        addSession: jest.fn(),
      } as any)
    );

    await expect(result.current.sendQuery({ queryQuestion: 'hello' })).resolves.toBe(false);
  });
});
