import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceSider from '..';
import { useProjectList } from '@/pages/projectSpace/hooks/useProjectList';
import { useProjectScopeId } from '@/pages/projectSpace/hooks/useProjectScopeId';
import { listProjectSessionsByQo } from '@/service/devloop';

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockUpdateProjectScopeId = jest.fn();
const mockEventEmitter = {
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, number>) =>
      values?.count === undefined ? id : `${id}:${values.count}`,
  }),
  useLocation: () => ({ pathname: '/chat', state: null }),
  useNavigate: () => mockNavigate,
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({
    EventEmitter: mockEventEmitter,
    sessionId: '',
    setAgentId: jest.fn(),
    setSessionId: jest.fn(),
  }),
}));

jest.mock('@/pages/projectSpace/hooks/useProjectList', () => ({
  useProjectList: jest.fn(),
}));

jest.mock('@/pages/projectSpace/hooks/useProjectScopeId', () => ({
  useProjectScopeId: jest.fn(),
}));

jest.mock('@/service/devloop', () => ({
  listProjectSessionsByQo: jest.fn(),
}));

jest.mock('@/components/ChatLayoutComp/components/EasyConfirm', () => ({
  clearEasyConfirmInputDraft: jest.fn(),
}));

jest.mock('../WorkspaceSiderHeader', () => () => (
  <div>
    <img src="/beyond/favicon.svg" alt="messageList.defaultAIName" />
    <button type="button" aria-label="layouHeader.search" />
  </div>
));
jest.mock('../WorkspaceUserBar', () => () => <div data-testid="workspace-user-bar" />);
jest.mock('../WorkspaceProjectActions', () => ({ project, onNewSession }: any) => (
  <div data-testid="workspace-project-actions">
    <button type="button" aria-label="workspaceSider.newSession" onClick={() => onNewSession(project)} />
  </div>
));

const mockUseProjectList = useProjectList as jest.MockedFunction<typeof useProjectList>;
const mockUseProjectScopeId = useProjectScopeId as jest.MockedFunction<typeof useProjectScopeId>;
const mockListProjectSessionsByQo = listProjectSessionsByQo as jest.MockedFunction<typeof listProjectSessionsByQo>;

describe('WorkspaceSider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProjectList.mockReturnValue({
      projects: [
        {
          projectId: '1001',
          projectName: '前端',
          projectType: 'normal',
          isShare: 'N',
          sharedFlag: false,
        },
      ],
      loading: false,
      hasMore: false,
      loadMoreProjects: jest.fn(),
      fetchProjects: jest.fn(),
      keyword: '',
      setKeyword: jest.fn(),
    });
    mockUseProjectScopeId.mockReturnValue(['1001', mockUpdateProjectScopeId]);
    mockListProjectSessionsByQo.mockResolvedValue({
      rows: [
        {
          projectId: 1001,
          sessionId: 2001,
          sessionName: '自我介绍',
          updateTime: `${Date.now() - 2 * 60 * 1000}`,
        },
      ],
      total: 1,
      pageNum: 1,
    } as any);
  });

  it('renders the system identity and global search above the primary navigation', () => {
    render(<WorkspaceSider />);

    expect(screen.getByRole('img', { name: 'messageList.defaultAIName' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'layouHeader.search' })).toBeInTheDocument();
    expect(screen.getByTestId('workspace-user-bar')).toBeInTheDocument();
    const primaryNavigation = screen.getByRole('navigation', { name: 'workspaceSider.primaryNavigation' });
    const navigationLabels = Array.from(primaryNavigation.querySelectorAll('button > span:last-child')).map(
      (element) => element.textContent
    );
    expect(navigationLabels.slice(0, 4)).toEqual([
      'workspaceSider.newTask',
      'workspaceSider.scheduledTasks',
      'sider.projectSpace',
      'workspaceSider.digitalEmployee',
    ]);
  });

  it('loads the active project sessions and opens the selected session', async () => {
    render(<WorkspaceSider />);

    await waitFor(() => {
      expect(mockListProjectSessionsByQo).toHaveBeenCalledWith({ projectId: 1001, pageNum: 1, pageSize: 5 });
    });
    expect(await screen.findByRole('button', { name: /自我介绍/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /自我介绍/ }));

    expect(mockUpdateProjectScopeId).toHaveBeenCalledWith('1001');
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/addSession',
        payload: expect.objectContaining({ sessionId: '2001', projectId: '1001' }),
      })
    );
    expect(mockNavigate).toHaveBeenCalledWith('/chat', expect.any(Object));
  });

  it('shows edit and delete actions from the session more menu', async () => {
    render(<WorkspaceSider />);

    await screen.findByRole('button', { name: /自我介绍/ });
    fireEvent.click(screen.getByRole('button', { name: 'common.more' }));

    await waitFor(() => {
      expect(screen.getByText('common.edit')).toBeInTheDocument();
      expect(screen.getByText('common.delete')).toBeInTheDocument();
    });
  });

  it('loads five more sessions at a time and collapses back to the first five', async () => {
    mockListProjectSessionsByQo
      .mockResolvedValueOnce({
        rows: Array.from({ length: 5 }, (_, index) => ({
          projectId: 1001,
          sessionId: 3001 + index,
          sessionName: `会话${index + 1}`,
        })),
        total: 10,
        pageNum: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: Array.from({ length: 5 }, (_, index) => ({
          projectId: 1001,
          sessionId: 3006 + index,
          sessionName: `会话${index + 6}`,
        })),
        total: 10,
        pageNum: 2,
      } as any);

    render(<WorkspaceSider />);

    expect(await screen.findByRole('button', { name: '会话1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'workspaceSider.loadMore' }));

    await waitFor(() => {
      expect(mockListProjectSessionsByQo).toHaveBeenLastCalledWith({ projectId: 1001, pageNum: 2, pageSize: 5 });
    });
    expect(await screen.findByRole('button', { name: '会话10' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'workspaceSider.collapseSessions' }));

    expect(screen.queryByRole('button', { name: '会话10' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '会话1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'workspaceSider.loadMore' })).toBeInTheDocument();
  });

  it('expands or collapses a project without changing the right panel', async () => {
    render(<WorkspaceSider />);

    await screen.findByRole('button', { name: /自我介绍/ });
    mockUpdateProjectScopeId.mockClear();
    mockNavigate.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /前端/ }));
    expect(screen.queryByRole('button', { name: /自我介绍/ })).not.toBeInTheDocument();
    expect(mockUpdateProjectScopeId).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /前端/ }));
    expect(await screen.findByRole('button', { name: /自我介绍/ })).toBeInTheDocument();
    expect(mockUpdateProjectScopeId).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('opens the resource center page', () => {
    render(<WorkspaceSider />);

    fireEvent.click(screen.getByRole('button', { name: /workspaceSider\.resourceCenter/ }));

    expect(mockNavigate).toHaveBeenCalledWith('/resourceCenter');
  });

  it('creates a new session in the project selected from the hovered action area', () => {
    render(<WorkspaceSider />);

    fireEvent.click(screen.getByRole('button', { name: 'workspaceSider.newSession' }));

    expect(mockUpdateProjectScopeId).toHaveBeenCalledWith('1001');
    expect(mockNavigate).toHaveBeenCalledWith('/chat', {
      state: expect.objectContaining({ projectId: '1001', projectName: '前端' }),
    });
  });
});
