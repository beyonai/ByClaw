import { act, render, screen, waitFor } from '@testing-library/react';

import { qryConversations } from '@/service/layout';
import ChildSessionNavigator from '../ChildSessionNavigator';

const mockDispatch = jest.fn();
const mockSetSessionId = jest.fn();

jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
}));

jest.mock('@/hooks/useGlobal', () => () => ({
  setSessionId: mockSetSessionId,
}));

jest.mock('@/service/layout', () => ({
  qryConversations: jest.fn(),
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

  it('refreshes a root hierarchy and renders newly created children without external metadata', async () => {
    const root = session('root-1', '主会话');
    const child = session('child-1', '架构舵手', 'root-1');
    mockQryConversations.mockResolvedValueOnce({ list: [] } as any).mockResolvedValue({ list: [child] } as any);

    render(<ChildSessionNavigator sessionId="root-1" currentSession={root} />);

    await waitFor(() => expect(mockQryConversations).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: '打开子会话列表' })).not.toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    expect(await screen.findByRole('button', { name: '打开子会话列表' })).toHaveTextContent('1 个子代理');
  });
});
