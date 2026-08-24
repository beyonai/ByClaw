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
});
