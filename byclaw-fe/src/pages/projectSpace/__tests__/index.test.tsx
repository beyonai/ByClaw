import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectSpacePage from '..';

const mockNavigate = jest.fn();
const mockSetKeyword = jest.fn();
const mockSetProjectScopeId = jest.fn();
const mockEventEmitter = {
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};
const mockLocation = { key: 'project-list', state: { openProjectList: true } };

const mockProject = {
  projectId: '1001',
  projectName: '测试项目',
  description: '项目描述',
  projectType: 'normal',
  isShare: 'N',
  sharedFlag: false,
  createBy: 1,
};

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
  useSelector: () => ({ userId: 1 }),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({
    EventEmitter: mockEventEmitter,
    setAgentId: jest.fn(),
    setSessionId: jest.fn(),
  }),
}));

jest.mock('../hooks/useProjectList', () => ({
  useProjectList: () => ({
    projects: [mockProject],
    loading: false,
    keyword: '',
    setKeyword: mockSetKeyword,
    fetchProjects: jest.fn().mockResolvedValue([mockProject]),
    hasMore: false,
    loadMoreProjects: jest.fn(),
  }),
}));

jest.mock('../hooks/useProjectScopeId', () => ({
  useProjectScopeId: () => ['1001', mockSetProjectScopeId],
}));

jest.mock('../hooks/useProjectDetail', () => ({
  useProjectDetail: () => ({ activeProject: mockProject, refreshProject: jest.fn() }),
}));

jest.mock('../hooks/useProjectTypeConfig', () => ({
  useProjectTypeConfig: () => ({ projectTypeOptions: [], projectTypeLoading: false }),
}));

jest.mock('../components/ProjectDetail', () => ({ onBack }: { onBack: () => void }) => (
  <button type="button" onClick={onBack}>
    projectSpace.backToList
  </button>
));
jest.mock('../components/ProjectFormModal', () => () => null);
jest.mock(
  '../components/ProjectOnboardingWizard',
  () =>
    ({ open }: { open: boolean }) =>
      open ? <div data-testid="project-onboarding-wizard" /> : null
);

jest.mock('@/service/devloop', () => ({
  createProject: jest.fn(),
  deleteProject: jest.fn(),
  saveDefaultAgent: jest.fn(),
  saveProjectMembers: jest.fn(),
  saveProjectResources: jest.fn(),
  updateProject: jest.fn(),
}));

jest.mock('@/components/QueryInput/RichInput/agentCache', () => ({ setAgentCache: jest.fn() }));
jest.mock('@/components/QueryInput/RichInput/utils/getElementData', () => jest.fn());
jest.mock('@/components/QueryInput/RichInput/utils/constants', () => ({
  ResourceType: { digitalEmployee: 'digitalEmployee' },
}));
jest.mock('@/constants/agent', () => ({ agentTypeMap: { agent: 'agent' } }));
jest.mock('@/components/ChatLayoutComp/components/EasyConfirm', () => ({
  clearEasyConfirmInputDraft: jest.fn(),
}));

describe('ProjectSpacePage project cards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('supports project search and opens the existing project onboarding wizard', () => {
    render(<ProjectSpacePage />);

    fireEvent.change(screen.getByPlaceholderText('projectSpace.projectSearchPlaceholder'), {
      target: { value: '测试' },
    });
    expect(mockSetKeyword).toHaveBeenCalledWith('测试');

    fireEvent.click(screen.getByRole('button', { name: /projectSpace\.createProject/ }));
    expect(screen.getByTestId('project-onboarding-wizard')).toBeInTheDocument();
  });

  it('shows rename and delete actions from the project card more menu', async () => {
    render(<ProjectSpacePage />);

    fireEvent.click(screen.getByRole('button', { name: 'common.more' }));

    await waitFor(() => {
      expect(screen.getByText('common.rename')).toBeInTheDocument();
      expect(screen.getByText('common.delete')).toBeInTheDocument();
    });
  });

  it('returns to the project card list from project details', () => {
    render(<ProjectSpacePage />);

    fireEvent.click(screen.getByRole('button', { name: /测试项目/ }));
    fireEvent.click(screen.getByRole('button', { name: 'projectSpace.backToList' }));

    expect(screen.getByRole('button', { name: /测试项目/ })).toBeInTheDocument();
  });
});
