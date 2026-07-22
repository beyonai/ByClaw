import { render, screen } from '@testing-library/react';

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
});
