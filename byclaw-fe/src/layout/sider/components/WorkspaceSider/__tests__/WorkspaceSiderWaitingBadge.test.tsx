import { render, screen, waitFor } from '@testing-library/react';
import { listProjectSessionsByQo } from '@/service/devloop';
import { getChatRunningStatus } from '@/service/message';
import { chatSessionRuntimeManager } from '@/utils/chatSessionRuntimeManager';
import WorkspaceSider from '../index';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => jest.fn(),
  useDispatch: () => jest.fn(),
  connect: () => (Component: any) => Component,
  useSelector: (selector: any) => selector({ user: { userInfo: {} }, session: {}, loading: {} }),
}));
jest.mock('@/hooks/useGlobal', () => () => ({
  EventEmitter: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
  sessionId: '',
  setAgentId: jest.fn(),
  setSessionId: jest.fn(),
}));
jest.mock('@/models/common/useAppStore', () => () => ({ setSiderCollapsed: jest.fn() }));
jest.mock('@/pages/projectSpace/hooks/useProjectList', () => ({
  useProjectList: () => ({
    projects: [{ projectId: '1', projectName: 'Project One' }],
    loading: false,
    fetchProjects: jest.fn(),
  }),
}));
jest.mock('@/service/devloop', () => ({ listProjectSessionsByQo: jest.fn() }));
jest.mock('@/service/message', () => ({ getChatRunningStatus: jest.fn() }));
// 只验证会话列表时间槽的优先级，隔离侧边栏头部/操作区等无关子树。
jest.mock('../WorkspaceSiderHeader', () => () => null);
jest.mock('../WorkspaceProjectActions', () => () => null);
jest.mock('../WorkspaceUserBar', () => () => null);
jest.mock('../WorkspaceSessionActions', () => () => null);

const SESSION_ID = '100';

const renderSider = async () => {
  window.localStorage.setItem('byclaw.workspaceSider.expandedProjectIds', JSON.stringify(['1']));
  jest.mocked(listProjectSessionsByQo).mockResolvedValue({
    data: [{ sessionId: SESSION_ID, sessionName: 'Session One', updateTime: '2026-01-01 10:00:00' }],
    total: 1,
  } as any);
  jest.mocked(getChatRunningStatus).mockResolvedValue([] as any);

  const view = render(<WorkspaceSider />);
  await screen.findByText('Session One');
  return view;
};

describe('WorkspaceSider 会话时间槽的等待/运行优先级', () => {
  beforeEach(() => {
    chatSessionRuntimeManager.clear();
    window.localStorage.clear();
  });

  it('shows the running indicator instead of the waiting badge once the user confirmed', async () => {
    const { container } = await renderSider();

    // 运行中 + 服务端投影为等待用户输入 → 等待标识优先级更高。
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: SESSION_ID,
      traceId: 'trace-1',
      source: 'test-engine',
      status: 'running',
      activeAgentCount: 1,
      activeChildCount: 0,
      waitingInteractionCount: 0,
      revision: 1,
      changedAt: 1000,
    });
    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: SESSION_ID,
      traceId: 'trace-1',
      source: 'test-engine',
      status: 'waiting_user',
      activeAgentCount: 1,
      activeChildCount: 0,
      waitingInteractionCount: 1,
      revision: 2,
      changedAt: 2000,
    });

    await waitFor(() => expect(screen.getByText('workspaceSider.sessionNeedsUserInput')).toBeInTheDocument());

    // 用户确认 → 等待态收敛，运行中标识不再被遮蔽。
    chatSessionRuntimeManager.markWaitingForUserInputConfirmed(SESSION_ID);

    await waitFor(() => expect(screen.queryByText('workspaceSider.sessionNeedsUserInput')).not.toBeInTheDocument());
    expect(chatSessionRuntimeManager.isSessionRunning(SESSION_ID)).toBe(true);
    expect(container.querySelector('.anticon-loading')).not.toBeNull();
  });

  it('keeps showing the waiting badge while a pending interaction is unresolved', async () => {
    const { container } = await renderSider();

    chatSessionRuntimeManager.applySessionRuntime({
      sessionId: SESSION_ID,
      traceId: 'trace-1',
      source: 'test-engine',
      status: 'waiting_user',
      activeAgentCount: 0,
      activeChildCount: 0,
      waitingInteractionCount: 1,
      revision: 1,
      changedAt: 1000,
    });

    await waitFor(() => expect(screen.getByText('workspaceSider.sessionNeedsUserInput')).toBeInTheDocument());
    expect(container.querySelector('.anticon-loading')).toBeNull();
  });
});
