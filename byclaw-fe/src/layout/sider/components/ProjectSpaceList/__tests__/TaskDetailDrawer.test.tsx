import { fireEvent, render, screen } from '@testing-library/react';

const mockGetTaskPhases = jest.fn(() => Promise.resolve(null));

jest.mock('@umijs/max', () => {
  // 任务详情已接入国际化，保持返回对象稳定以模拟 Umi 的 useIntl 行为。
  const intl = {
    formatMessage: ({ id }: { id: string }) => id,
  };

  return {
    useDispatch: () => jest.fn(),
    useIntl: () => intl,
    useNavigate: () => jest.fn(),
    useSelector: (selector: (state: any) => any) => selector({ user: { userInfo: { userId: 1 } } }),
  };
});

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({
    EventEmitter: { emit: jest.fn() },
    setSessionId: jest.fn(),
  }),
}));

jest.mock('@/service/devloop', () => ({
  getTaskPhases: (...args: any[]) => mockGetTaskPhases(...args),
}));

import TaskDetailDrawer from '../TaskDetailDrawer';

describe('TaskDetailDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the unavailable-phase empty state for an active task', async () => {
    render(
      <TaskDetailDrawer
        task={{
          sessionId: 123,
          createBy: 2,
          status: 'in_progress',
          stateAvailable: true,
          title: '进行中的任务',
        }}
        onClose={jest.fn()}
      />
    );

    expect(await screen.findByText('进行中的任务')).toBeInTheDocument();
    expect(await screen.findByText('projectTaskDetail.emptyPhases')).toBeInTheDocument();
  });

  it('renders the unavailable-task-state empty state for a pending task', async () => {
    render(
      <TaskDetailDrawer
        task={{
          sessionId: 124,
          createBy: 1,
          status: 'pending',
          stateAvailable: false,
          title: '待开始任务',
        }}
        onClose={jest.fn()}
      />
    );

    expect(await screen.findByText('待开始任务')).toBeInTheDocument();
    expect(await screen.findByText('projectTaskDetail.emptyState')).toBeInTheDocument();
  });

  it('renders the header session-entry action and delegates navigation', async () => {
    const task = {
      sessionId: 125,
      stateAvailable: false,
      title: '可进入会话的待开始任务',
    };
    const onEnterSession = jest.fn();

    render(<TaskDetailDrawer task={task} onClose={jest.fn()} canEnterSession onEnterSession={onEnterSession} />);

    const enterSessionButton = await screen.findByRole('button', { name: /projectTaskDetail\.enterSession/ });
    fireEvent.click(enterSessionButton);

    expect(onEnterSession).toHaveBeenCalledWith(task);
  });

  it('hides the session-entry action for non-assignees', async () => {
    render(
      <TaskDetailDrawer
        task={{ sessionId: 126, stateAvailable: true, title: '其他负责人任务' }}
        onClose={jest.fn()}
        canEnterSession={false}
        onEnterSession={jest.fn()}
      />
    );

    expect(await screen.findByText('其他负责人任务')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'projectTaskDetail.enterSession' })).not.toBeInTheDocument();
  });
});
