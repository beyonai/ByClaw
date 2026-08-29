import { act, render, screen, waitFor } from '@testing-library/react';

import { qryConversations } from '@/service/layout';
import ChildSessionNavigator from '../ChildSessionNavigator';

const mockDispatch = jest.fn();
const mockSetSessionId = jest.fn();
const mockOnMessage = jest.fn();
const mockOffMessage = jest.fn();
const mockOnReconnect = jest.fn();
let newMessageHandler: ((message: any) => void | Promise<void>) | undefined;
let reconnectHandler: (() => void) | undefined;

jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
}));

jest.mock('@/hooks/useGlobal', () => () => ({
  setSessionId: mockSetSessionId,
}));

jest.mock('@/service/layout', () => ({
  qryConversations: jest.fn(),
}));

jest.mock('@/utils/websocket', () => ({
  __esModule: true,
  default: {
    onMessage: (...args: any[]) => mockOnMessage(...args),
    offMessage: (...args: any[]) => mockOffMessage(...args),
    onReconnect: (...args: any[]) => mockOnReconnect(...args),
  },
}));

const mockQryConversations = qryConversations as jest.MockedFunction<typeof qryConversations>;

const session = (sessionId: string, sessionName: string, parentSessionId?: string) =>
  ({
    sessionId,
    sessionName,
    parentSessionId,
    createTime: '2026-08-29 10:00:00',
    updateTime: '2026-08-29 10:00:00',
  } as any);

describe('ChildSessionNavigator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    newMessageHandler = undefined;
    reconnectHandler = undefined;
    mockOnMessage.mockImplementation((type: string, handler: (message: any) => void | Promise<void>) => {
      if (type === 'NEW_MESSAGE') newMessageHandler = handler;
    });
    mockOnReconnect.mockImplementation((handler: () => void) => {
      reconnectHandler = handler;
      return jest.fn();
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('recognizes any session with parentSessionId as a child and loads its root hierarchy', async () => {
    const root = session('root-1', '主会话');
    const child = session('child-1', '架构舵手', 'root-1');
    mockQryConversations.mockImplementation(async (params: any) => {
      if (params.parentSessionId === 'root-1') return { list: [child] } as any;
      if (params.sessionId === 'root-1') return { list: [root] } as any;
      return { list: [] } as any;
    });

    render(<ChildSessionNavigator sessionId="child-1" currentSession={child} />);

    expect(await screen.findByRole('button', { name: /主会话/ })).toBeInTheDocument();
    expect(mockQryConversations).toHaveBeenCalledWith({ parentSessionId: 'root-1', pageNum: 1, pageSize: 100 });
  });

  it('does not poll the hierarchy while the conversation is idle', async () => {
    const root = session('root-1', '主会话');
    mockQryConversations.mockResolvedValue({ list: [] } as any);

    render(<ChildSessionNavigator sessionId="root-1" currentSession={root} />);

    await waitFor(() => expect(mockQryConversations).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(mockQryConversations).toHaveBeenCalledTimes(1);
  });

  it('does not reload the hierarchy when the same session object is refreshed in the store', async () => {
    const root = session('root-1', '主会话');
    mockQryConversations.mockResolvedValue({ list: [] } as any);

    const view = render(<ChildSessionNavigator sessionId="root-1" currentSession={root} />);
    await waitFor(() => expect(mockQryConversations).toHaveBeenCalledTimes(1));

    view.rerender(
      <ChildSessionNavigator sessionId="root-1" currentSession={{ ...root, sessionName: '主会话（已更新）' }} />
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockQryConversations).toHaveBeenCalledTimes(1);
  });

  it('loads an unknown child once when its first WebSocket message arrives', async () => {
    const root = session('root-1', '主会话');
    mockQryConversations.mockResolvedValue({ list: [] } as any);

    render(<ChildSessionNavigator sessionId="root-1" currentSession={root} />);
    await waitFor(() => expect(mockQryConversations).toHaveBeenCalledTimes(1));
    expect(newMessageHandler).toBeDefined();

    await act(async () => {
      await newMessageHandler?.({
        type: 'NEW_MESSAGE',
        sessionId: 'child-1',
        data: {
          sessionId: 'child-1',
          metadata: JSON.stringify({
            session_scope: 'child',
            external_session_id: 'external-child-1',
            external_parent_session_id: 'root-1',
            child_name: '架构舵手',
            child_role: '架构负责人',
            session_status: 'running',
          }),
        },
      });
    });

    expect(await screen.findByRole('button', { name: '打开子会话列表' })).toHaveTextContent('1 个子代理');

    await act(async () => {
      await newMessageHandler?.({
        type: 'NEW_MESSAGE',
        sessionId: 'child-1',
        data: {
          sessionId: 'child-1',
          metadata: JSON.stringify({
            session_scope: 'child',
            external_session_id: 'external-child-1',
            external_parent_session_id: 'root-1',
            child_name: '架构舵手',
          }),
        },
      });
    });
    expect(mockQryConversations).toHaveBeenCalledTimes(1);
  });

  it('hydrates concurrent unknown child events without another hierarchy request', async () => {
    const root = session('root-1', '主会话');
    const children = [
      session('child-1', '需求侦探', 'root-1'),
      session('child-2', '架构舵手', 'root-1'),
      session('child-3', '代码工匠', 'root-1'),
      session('child-4', '质量哨兵', 'root-1'),
    ];
    mockQryConversations.mockResolvedValue({ list: [] } as any);

    render(<ChildSessionNavigator sessionId="root-1" currentSession={root} />);
    await waitFor(() => expect(mockQryConversations).toHaveBeenCalledTimes(1));

    const childEvent = (childSessionId: string) => ({
      type: 'NEW_MESSAGE',
      sessionId: childSessionId,
      data: {
        sessionId: childSessionId,
        metadata: JSON.stringify({
          session_scope: 'child',
          external_session_id: `external-${childSessionId}`,
          external_parent_session_id: 'root-1',
        }),
      },
    });

    await act(async () => {
      await Promise.all(children.map((child) => newMessageHandler?.(childEvent(`${child.sessionId}`))));
    });

    expect(await screen.findByRole('button', { name: '打开子会话列表' })).toHaveTextContent('4 个子代理');
    expect(mockQryConversations).toHaveBeenCalledTimes(1);
  });

  it('reconciles the active hierarchy once after WebSocket reconnects', async () => {
    const root = session('root-1', '主会话');
    const child = session('child-1', '架构舵手', 'root-1');
    mockQryConversations.mockResolvedValueOnce({ list: [] } as any).mockResolvedValueOnce({ list: [child] } as any);

    render(<ChildSessionNavigator sessionId="root-1" currentSession={root} />);
    await waitFor(() => expect(mockQryConversations).toHaveBeenCalledTimes(1));
    expect(reconnectHandler).toBeDefined();

    await act(async () => {
      reconnectHandler?.();
      await Promise.resolve();
    });

    expect(await screen.findByRole('button', { name: '打开子会话列表' })).toHaveTextContent('1 个子代理');
    expect(mockQryConversations).toHaveBeenCalledTimes(2);
  });
});
