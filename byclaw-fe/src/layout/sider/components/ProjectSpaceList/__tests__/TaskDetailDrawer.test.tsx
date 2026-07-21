import { render, screen } from '@testing-library/react';

const mockGetTaskPhases = jest.fn(() => Promise.resolve(null));

jest.mock('@umijs/max', () => ({
  useDispatch: () => jest.fn(),
  useNavigate: () => jest.fn(),
  useSelector: (selector: (state: any) => any) => selector({ user: { userInfo: { userId: 1 } } }),
}));

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

describe('TaskDetailDrawer session entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows entering a non-pending task session even when another member created it', async () => {
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
        onRefresh={jest.fn()}
      />
    );

    expect(await screen.findByRole('button', { name: /进入会话/ })).toBeEnabled();
  });

  it('keeps the session entry disabled while the task is pending', async () => {
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
        onRefresh={jest.fn()}
      />
    );

    expect(await screen.findByRole('button', { name: /进入会话/ })).toBeDisabled();
  });
});
