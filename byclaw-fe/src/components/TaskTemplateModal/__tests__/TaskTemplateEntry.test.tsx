import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaskTemplateEntry from '../TaskTemplateEntry';
import { useProjectList } from '@/pages/projectSpace/hooks/useProjectList';
import { useProjectScopeId } from '@/pages/projectSpace/hooks/useProjectScopeId';

const mockUpdateProjectScopeId = jest.fn();
const mockEventEmitter = {
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};
jest.mock('@umijs/max', () => ({
  getLocale: () => 'zh-CN',
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) =>
      ({
        'projectSpace.createProject': '新建项目',
        'projectSpace.selectProject': '请选择项目',
        'projectSpace.unnamedProject': '未命名项目',
        'projectSpace.message.createSuccess': '项目空间创建成功',
        'projectSpace.message.createFailed': '项目空间创建失败',
      }[id] || id),
  }),
  useNavigate: () => jest.fn(),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: mockEventEmitter }),
}));

jest.mock('@/pages/projectSpace/hooks/useProjectList', () => ({
  useProjectList: jest.fn(),
}));

jest.mock('@/pages/projectSpace/hooks/useProjectScopeId', () => ({
  useProjectScopeId: jest.fn(),
}));

jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/useChatResourceProject', () => ({
  useChatResourceProject: () => ({
    project: { projectId: '1', projectType: 'normal', resources: [] },
    loading: false,
  }),
}));

jest.mock('@/service/auth', () => ({
  getDcSystemConfigListByStandType: jest.fn(),
}));

jest.mock('@/service/devloop', () => ({
  createProject: jest.fn(),
  saveDefaultAgent: jest.fn(),
  saveProjectMembers: jest.fn(),
}));

jest.mock('@/pages/projectSpace/hooks/useProjectTypeConfig', () => ({
  useProjectTypeConfig: () => ({ projectTypeOptions: [], projectTypeLoading: false }),
}));

jest.mock('@/pages/projectSpace/components/ProjectOnboardingWizard', () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="project-onboarding-wizard" /> : null),
}));

const mockUseProjectList = useProjectList as jest.MockedFunction<typeof useProjectList>;
const mockUseProjectScopeId = useProjectScopeId as jest.MockedFunction<typeof useProjectScopeId>;

describe('TaskTemplateEntry project selector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProjectList.mockReturnValue({
      projects: [
        { projectId: '1', projectName: '项目一', projectType: 'normal' } as any,
        { projectId: '2', projectName: '项目二', projectType: 'normal' } as any,
      ],
      loading: false,
      keyword: '',
      setKeyword: jest.fn(),
      fetchProjects: jest.fn(),
      hasMore: false,
      loadMoreProjects: jest.fn(),
    });
    mockUseProjectScopeId.mockReturnValue([undefined, mockUpdateProjectScopeId]);
  });

  it('selects and persists the first project when no project is stored', async () => {
    render(<TaskTemplateEntry onApply={jest.fn()} />);

    await waitFor(() => {
      expect(mockUpdateProjectScopeId).toHaveBeenCalledWith('1');
    });
  });

  it('hides the project selector until the initial project request returns', () => {
    mockUseProjectList.mockReturnValue({
      projects: [],
      loading: true,
      keyword: '',
      setKeyword: jest.fn(),
      fetchProjects: jest.fn(),
      hasMore: false,
      loadMoreProjects: jest.fn(),
    });

    render(<TaskTemplateEntry onApply={jest.fn()} />);

    expect(screen.queryByRole('combobox', { name: '选择项目' })).not.toBeInTheDocument();
  });

  it('allows switching the project from the chat input', async () => {
    mockUseProjectScopeId.mockReturnValue(['1', mockUpdateProjectScopeId]);
    render(<TaskTemplateEntry onApply={jest.fn()} />);

    expect(screen.queryByRole('button', { name: '任务模板' })).not.toBeInTheDocument();

    const projectSelect = screen.getByRole('combobox', { name: '请选择项目' });
    fireEvent.mouseDown(projectSelect);
    fireEvent.change(projectSelect, { target: { value: '项目二' } });
    fireEvent.click(await screen.findByText('项目二'));

    expect(mockUpdateProjectScopeId).toHaveBeenCalledWith('2');
  });

  it('opens the new project form in the current chat page', async () => {
    render(<TaskTemplateEntry onApply={jest.fn()} />);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '请选择项目' }));
    fireEvent.click(await screen.findByText('新建项目'));

    expect(screen.getByTestId('project-onboarding-wizard')).toBeInTheDocument();
  });

  it('clears a deleted project from the selector value after the project list refreshes', async () => {
    const { rerender } = render(<TaskTemplateEntry onApply={jest.fn()} />);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '请选择项目' }));
    fireEvent.change(screen.getByRole('combobox', { name: '请选择项目' }), { target: { value: '项目二' } });
    fireEvent.click(await screen.findByText('项目二'));

    mockUseProjectList.mockReturnValue({
      projects: [{ projectId: '1', projectName: '项目一', projectType: 'normal' } as any],
      loading: false,
      keyword: '',
      setKeyword: jest.fn(),
      fetchProjects: jest.fn(),
      hasMore: false,
      loadMoreProjects: jest.fn(),
    });
    rerender(<TaskTemplateEntry onApply={jest.fn()} />);

    await waitFor(() => {
      expect(mockUpdateProjectScopeId).toHaveBeenCalledWith('1');
    });
    expect(screen.getByRole('combobox', { name: '请选择项目' })).not.toHaveValue('2');
  });

  it('keeps the selected project while the project list has not returned yet', async () => {
    // 新建会话路径上 projectId prop 恒为 undefined，且 useProjectList 有 300ms 防抖：
    // 挂载瞬间「已选项目存在 + 列表为空」。此时清空共享作用域会让列表返回后回退成默认项目。
    mockUseProjectScopeId.mockReturnValue(['20059102', mockUpdateProjectScopeId]);
    mockUseProjectList.mockReturnValue({
      projects: [],
      loading: false,
      keyword: '',
      setKeyword: jest.fn(),
      fetchProjects: jest.fn(),
      hasMore: false,
      loadMoreProjects: jest.fn(),
    });

    render(<TaskTemplateEntry onApply={jest.fn()} />);

    expect(mockUpdateProjectScopeId).not.toHaveBeenCalled();
  });

  it('does not display a persisted project id when no projects are available', async () => {
    mockUseProjectScopeId.mockReturnValue(['20059102', mockUpdateProjectScopeId]);
    // 先进入「请求进行中」，再切到「请求已结束且列表为空」，模拟真实 useProjectList 的时序。
    mockUseProjectList.mockReturnValue({
      projects: [],
      loading: true,
      keyword: '',
      setKeyword: jest.fn(),
      fetchProjects: jest.fn(),
      hasMore: false,
      loadMoreProjects: jest.fn(),
    });

    const { rerender } = render(<TaskTemplateEntry onApply={jest.fn()} />);

    mockUseProjectList.mockReturnValue({
      projects: [],
      loading: false,
      keyword: '',
      setKeyword: jest.fn(),
      fetchProjects: jest.fn(),
      hasMore: false,
      loadMoreProjects: jest.fn(),
    });
    rerender(<TaskTemplateEntry onApply={jest.fn()} />);

    await waitFor(() => {
      expect(mockUpdateProjectScopeId).toHaveBeenCalledWith(undefined);
    });
    // 断言的是「不回显这个已失效的项目 id」，而不是「选择器不存在」：
    // 列表确实为空时选择器仍需保留，用户要靠它新建项目。
    expect(screen.getByRole('combobox', { name: '请选择项目' })).not.toHaveValue('20059102');
  });

  // F6 回归防护：projectListReady 只表示「首次请求已结束」，列表就绪后仍可能只覆盖第 1 页。
  // 已选项目在第 2 页时，旧实现会把它覆写成 projectOptions[0]（通常是默认项目）。
  it('loads the next page instead of overwriting a selected project that is not on the first page', async () => {
    const mockLoadMoreProjects = jest.fn();
    mockUseProjectScopeId.mockReturnValue(['999', mockUpdateProjectScopeId]);
    mockUseProjectList.mockReturnValue({
      // 第 1 页只有项目一/项目二，已选的 999 在第 2 页。
      projects: [
        { projectId: '1', projectName: '项目一', projectType: 'normal' } as any,
        { projectId: '2', projectName: '项目二', projectType: 'normal' } as any,
      ],
      loading: false,
      keyword: '',
      setKeyword: jest.fn(),
      fetchProjects: jest.fn(),
      hasMore: true,
      loadMoreProjects: mockLoadMoreProjects,
    });

    render(<TaskTemplateEntry onApply={jest.fn()} />);

    await waitFor(() => {
      expect(mockLoadMoreProjects).toHaveBeenCalled();
    });
    // 关键断言：不得把用户已选项目覆写成列表第一项。
    expect(mockUpdateProjectScopeId).not.toHaveBeenCalledWith('1');
  });

  it('keeps the selected project once the appended page contains it', async () => {
    mockUseProjectScopeId.mockReturnValue(['999', mockUpdateProjectScopeId]);
    mockUseProjectList.mockReturnValue({
      projects: [
        { projectId: '1', projectName: '项目一', projectType: 'normal' } as any,
        { projectId: '2', projectName: '项目二', projectType: 'normal' } as any,
      ],
      loading: false,
      keyword: '',
      setKeyword: jest.fn(),
      fetchProjects: jest.fn(),
      hasMore: true,
      loadMoreProjects: jest.fn(),
    });

    const { rerender } = render(<TaskTemplateEntry onApply={jest.fn()} />);

    // 模拟 loadMoreProjects 追加第 2 页后列表增长（useProjectList 的真实时序）。
    mockUseProjectList.mockReturnValue({
      projects: [
        { projectId: '1', projectName: '项目一', projectType: 'normal' } as any,
        { projectId: '2', projectName: '项目二', projectType: 'normal' } as any,
        { projectId: '999', projectName: '第二页项目', projectType: 'normal' } as any,
      ],
      loading: false,
      keyword: '',
      setKeyword: jest.fn(),
      fetchProjects: jest.fn(),
      hasMore: false,
      loadMoreProjects: jest.fn(),
    });
    rerender(<TaskTemplateEntry onApply={jest.fn()} />);

    await waitFor(() => {
      // 下拉未展开时，页面里出现「第二页项目」只可能来自 Select 的选中项。
      expect(screen.getByText('第二页项目')).toBeInTheDocument();
    });
    expect(mockUpdateProjectScopeId).not.toHaveBeenCalledWith('1');
  });
});
