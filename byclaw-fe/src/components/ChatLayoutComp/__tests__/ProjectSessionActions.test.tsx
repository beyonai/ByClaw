import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getProject, getTaskDetail } from '@/service/devloop';
import ProjectSessionActions from '../ProjectSessionActions';

jest.mock('@/service/devloop', () => ({
  getProject: jest.fn(),
  getTaskDetail: jest.fn(),
}));

jest.mock('@umijs/max', () => ({
  useSelector: (selector: (state: any) => any) => selector({ user: { userInfo: { userId: 1001 } } }),
}));

jest.mock('@/layout/sider/components/ActiveSiderAgentBar', () => ({
  useActiveSiderAgent: () => ({ resourceId: '' }),
}));

jest.mock(
  '@/layout/sider/components/ProjectSpaceList/TaskDetailDrawer',
  () =>
    ({ task, canEnterSession }: { task: any; canEnterSession?: boolean }) =>
      task ? (
        <div data-testid="task-detail-payload">
          {JSON.stringify(task)}
          <span data-testid="can-enter-session">{String(canEnterSession)}</span>
        </div>
      ) : null
);

jest.mock('../ProjectSessionResultDrawer', () => () => null);

const mockGetProject = getProject as jest.MockedFunction<typeof getProject>;
const mockGetTaskDetail = getTaskDetail as jest.MockedFunction<typeof getTaskDetail>;

describe('ProjectSessionActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProject.mockResolvedValue({ projectType: 'develop' } as any);
  });

  it('loads the full task context before opening the task progress drawer', async () => {
    mockGetTaskDetail.mockResolvedValue({
      taskId: 123,
      sessionId: 123,
      projectId: 1001,
      createBy: 1001,
      title: '任务标题',
      requirementTitle: '关联需求',
      repoFullName: 'beyonai/byclaw',
      branchName: 'feat/task-123',
      assignee: '刘皇叔',
    } as any);

    render(<ProjectSessionActions projectId={1001} sessionId="123" sessionName="会话标题" />);

    await waitFor(() => {
      expect(mockGetProject).toHaveBeenCalledWith(1001);
      // 任务成果入口已迁移到会话资源面板，这里只保留任务进度按钮。
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });
    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() => {
      expect(mockGetTaskDetail).toHaveBeenCalledWith(123);
    });
    expect(await screen.findByTestId('task-detail-payload')).toHaveTextContent('beyonai/byclaw');
    expect(screen.getByTestId('task-detail-payload')).toHaveTextContent('关联需求');
    expect(screen.getByTestId('can-enter-session')).toHaveTextContent('true');
  });
});
