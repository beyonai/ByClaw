jest.mock('@/pages/manager/service/authorizationTasks', () => ({}));
import { fireEvent, render, screen } from '@testing-library/react';
import AuthorizationTaskProgress from '../AuthorizationTaskProgress';
import { AuthorizationTask } from '@/pages/manager/service/authorizationTasks';

const value = {
  taskId: 'old',
  requestId: 'old',
  operation: 'MANAGE',
  status: 'SUCCEEDED',
  phase: 'DONE',
  progress: 100,
  completedUsers: 37,
  totalUsers: 37,
  dataApplied: 1,
  message: '已同步生效',
} as AuthorizationTask;
const props = () => ({
  taskError: '',
  taskChecking: false,
  taskSubmitting: false,
  refreshTask: jest.fn(),
  retryTask: jest.fn(),
  cancelTask: jest.fn(),
});

it('labels historical success separately from the current submission error', () => {
  render(<AuthorizationTaskProgress {...props()} historicalTask={value} taskError="未能确认提交结果：网络异常" />);
  expect(screen.getByText('未能确认提交结果：网络异常')).toBeTruthy();
  expect(screen.getByText('历史成功记录（管理授权）')).toBeTruthy();
  expect(screen.getByText('仅供参考，不代表本次提交结果。')).toBeTruthy();
  expect(screen.queryByText('本次提交（管理授权）')).toBeNull();
  expect(screen.queryByText('重试任务')).toBeNull();
});

it('shows another operations blocker alongside the matching current success', () => {
  render(
    <AuthorizationTaskProgress
      {...props()}
      task={{ ...value, taskId: 'current', requestId: 'current', operation: 'USE' }}
      blockingTask={{ ...value, taskId: 'blocker', status: 'RUNNING', blocksResource: true }}
    />
  );
  expect(screen.getByText('本次提交（使用授权）')).toBeTruthy();
  expect(screen.getByText('资源占用任务（管理授权）')).toBeTruthy();
  expect(screen.getByText('该任务正在占用资源，处理完成前不能再次提交授权。')).toBeTruthy();
});

it('targets the blocker when abandoning another operators unsaved failure', () => {
  const handlers = props();
  const blocker = {
    ...value,
    status: 'FAILED',
    dataApplied: 0,
    blocksResource: true,
    submittedByCurrentUser: false,
    canRetry: false,
    canCancel: true,
  } as AuthorizationTask;
  render(
    <AuthorizationTaskProgress {...handlers} blockingTask={blocker} historicalTask={{ ...value, taskId: 'history' }} />
  );
  expect(screen.queryByText('重试任务')).toBeNull();
  fireEvent.click(screen.getByText('放弃本次任务'));
  expect(handlers.cancelTask).toHaveBeenCalledWith(blocker);
  expect(screen.getByText('历史成功记录（管理授权）')).toBeTruthy();
});
