import { render, screen, waitFor } from '@testing-library/react';
import { listProjectSessionsByQo } from '@/service/devloop';
import { getChatRunningStatus } from '@/service/message';
import WorkspaceSider from '../index';

// 侧栏初始化解析的针对性回归（#237 / PR #242 的 F1）：
// 作用域指向的项目不在已加载的第 1 页时，侧栏必须继续翻页补齐并最终选中它，
// 而不是把 initializedProjectRef 提前置位后永久不再解析、也不选中任何项目。

const mockUpdateProjectScopeId = jest.fn();
const mockLoadMoreProjects = jest.fn();

let mockProjects: any[] = [];
let mockHasMore = false;
let mockProjectScopeId: string | undefined;

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useLocation: () => ({ pathname: '/', search: '', state: null, key: 'test' }),
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
    projects: mockProjects,
    loading: false,
    fetchProjects: jest.fn(),
    hasMore: mockHasMore,
    loadMoreProjects: mockLoadMoreProjects,
  }),
}));
jest.mock('@/pages/projectSpace/hooks/useProjectScopeId', () => ({
  useProjectScopeId: () => [mockProjectScopeId, mockUpdateProjectScopeId],
}));
jest.mock('@/service/devloop', () => ({ listProjectSessionsByQo: jest.fn() }));
jest.mock('@/service/message', () => ({ getChatRunningStatus: jest.fn() }));
// 只验证初始化解析，隔离侧边栏头部/操作区等无关子树。
jest.mock('../WorkspaceSiderHeader', () => () => null);
jest.mock('../WorkspaceProjectActions', () => () => null);
jest.mock('../WorkspaceUserBar', () => () => null);
jest.mock('../WorkspaceSessionActions', () => () => null);

const buildProject = (projectId: string, projectName: string, projectType = 'normal') => ({
  projectId,
  projectName,
  projectType,
  isShare: 'N',
  sharedFlag: false,
});

const FIRST_PAGE = [buildProject('1', 'Project One'), buildProject('2', 'Project Two')];
const SECOND_PAGE = [...FIRST_PAGE, buildProject('999', 'Project On Page Two')];

describe('WorkspaceSider 项目作用域初始化解析', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockProjects = FIRST_PAGE;
    mockHasMore = true;
    mockProjectScopeId = '999';
    jest.mocked(listProjectSessionsByQo).mockResolvedValue({ data: [], total: 0 } as any);
    jest.mocked(getChatRunningStatus).mockResolvedValue([] as any);
  });

  it('loads the next page instead of locking when the scoped project is not on the first page', async () => {
    render(<WorkspaceSider />);

    // 第 1 页里没有 999：必须继续翻页补齐，而不是提前置位后什么都不做。
    await waitFor(() => expect(mockLoadMoreProjects).toHaveBeenCalled());
    // 未命中时不得把作用域覆写成列表第一项。
    expect(mockUpdateProjectScopeId).not.toHaveBeenCalledWith('1');
  });

  it('selects the scoped project once the appended page contains it', async () => {
    const { rerender } = render(<WorkspaceSider />);

    await waitFor(() => expect(mockLoadMoreProjects).toHaveBeenCalled());

    // 模拟 loadMoreProjects 追加第 2 页后列表增长（useProjectList 的真实时序）。
    mockProjects = SECOND_PAGE;
    mockHasMore = false;
    rerender(<WorkspaceSider />);

    await waitFor(() => expect(mockUpdateProjectScopeId).toHaveBeenCalledWith('999'));
    expect(screen.getByText('Project On Page Two')).toBeInTheDocument();
  });

  it('keeps falling back to the default project when nothing is selected', async () => {
    mockProjectScopeId = undefined;
    mockProjects = [buildProject('10', '普通项目'), buildProject('-1', '我的默认项目', 'default')];
    mockHasMore = false;

    render(<WorkspaceSider />);

    // 未选择时仍回退 projectType === 'default' 的项目，而不是列表第一项。
    await waitFor(() => expect(mockUpdateProjectScopeId).toHaveBeenCalledWith('-1'));
  });
});
