jest.mock('antd', () => ({ message: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../service/authorizationTasks', () => ({
  submitAuthorizationTask: jest.fn(),
  listAuthorizationTasks: jest.fn(),
  getAuthorizationTask: jest.fn(),
  findAuthorizationTaskRequest: jest.fn(),
  retryAuthorizationTask: jest.fn(),
  cancelAuthorizationTask: jest.fn(),
}));
import { act, renderHook, waitFor } from '@testing-library/react';
import * as api from '../../service/authorizationTasks';
import useAuthorizationTask from '../useAuthorizationTask';

const queued = { taskId: 'task-1', requestId: 'request-1', operation: 'USE', status: 'QUEUED', progress: 0 };
const setup = () => renderHook(() => useAuthorizationTask({ enabled: true, resourceId: '13', onCompleted: jest.fn() }));

beforeEach(() => {
  jest.resetAllMocks();
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({ code: 0, data: [] });
  (api.findAuthorizationTaskRequest as jest.Mock).mockResolvedValue({ code: 0, data: null });
});
afterEach(() => jest.useRealTimers());

it('restores a running task when the drawer reopens and releases controls only after completion', async () => {
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({ code: 0, data: [queued] });
  (api.getAuthorizationTask as jest.Mock).mockResolvedValue({
    code: 0,
    data: { ...queued, status: 'SUCCEEDED', progress: 100 },
  });
  const { result, unmount } = setup();
  await waitFor(() => expect(result.current.task?.status).toBe('QUEUED'));
  expect(result.current.taskBlocked).toBe(true);
  await waitFor(() => expect(result.current.task?.status).toBe('SUCCEEDED'), { timeout: 4000 });
  expect(result.current.taskBlocked).toBe(false);
  unmount();
});

it('does not treat queue acceptance as successful authorization', async () => {
  (api.submitAuthorizationTask as jest.Mock).mockResolvedValue({ code: 0, data: queued });
  const done = jest.fn();
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', done));
  expect(done).not.toHaveBeenCalled();
  expect(result.current.taskSubmitting).toBe(false);
  expect(result.current.taskBlocked).toBe(true);
});

it('reuses the request id after an uncertain submission and does not acknowledge an older success', async () => {
  (api.submitAuthorizationTask as jest.Mock).mockRejectedValue(new Error('timeout'));
  const done = jest.fn();
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({
    code: 0,
    data: [{ ...queued, requestId: 'older', status: 'SUCCEEDED' }],
  });
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', done));
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', done));
  const calls = (api.submitAuthorizationTask as jest.Mock).mock.calls;
  expect(calls[0][0].requestId).toBe(calls[1][0].requestId);
  expect(done).not.toHaveBeenCalled();
  expect(result.current.taskSubmitting).toBe(false);
  expect(result.current.taskError).toContain('timeout');
  expect(result.current.task).toBeUndefined();
});

it('continues displaying a running job after progress polling fails', async () => {
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({ code: 0, data: [queued] });
  (api.getAuthorizationTask as jest.Mock).mockRejectedValue(new Error('offline'));
  const { result } = setup();
  await waitFor(() => expect(result.current.task?.status).toBe('QUEUED'));
  await waitFor(() => expect(result.current.taskError).toContain('正在重连'), { timeout: 4000 });
  expect(result.current.taskBlocked).toBe(true);
  expect(api.submitAuthorizationTask).not.toHaveBeenCalled();
});

it('shows failed cache synchronization and supports retry without resubmitting grants', async () => {
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({
    code: 0,
    data: [{ ...queued, status: 'FAILED', dataApplied: 1 }],
  });
  (api.retryAuthorizationTask as jest.Mock).mockResolvedValue({ code: 0, data: { ...queued, status: 'RETRYING' } });
  const { result } = setup();
  await waitFor(() => expect(result.current.task?.status).toBe('FAILED'));
  await act(async () => result.current.retryTask());
  expect(result.current.task?.status).toBe('RETRYING');
  expect(api.submitAuthorizationTask).not.toHaveBeenCalled();
});

it('shows the actual string business error when no blocking task can be viewed', async () => {
  (api.submitAuthorizationTask as jest.Mock).mockRejectedValue('该资源已有未完成的授权任务，请联系资源管理员');
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'MANAGE', jest.fn()));
  expect(result.current.taskError).toContain('该资源已有未完成的授权任务');
  expect(result.current.taskError).not.toContain('网络异常');
});

it('restores another operators blocking failure instead of covering it with an uncertain submission error', async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  const blocking = {
    ...queued,
    status: 'FAILED',
    dataApplied: 0,
    submittedByCurrentUser: false,
    canRetry: false,
    canCancel: true,
    message: '授权未保存，处理失败：旧任务失败原因',
  };
  (api.submitAuthorizationTask as jest.Mock).mockRejectedValue('该资源已有未完成的授权任务');
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({ code: 0, data: [blocking] });
  (api.cancelAuthorizationTask as jest.Mock).mockResolvedValue({
    code: 0,
    data: { ...blocking, status: 'CANCELLED', canCancel: false },
  });
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'MANAGE', jest.fn()));
  expect(result.current.task).toEqual(blocking);
  expect(result.current.taskError).toBe('');
  expect(result.current.taskBlocked).toBe(true);
  await act(async () => result.current.retryTask());
  expect(api.retryAuthorizationTask).not.toHaveBeenCalled();
  await act(async () => result.current.cancelTask());
  expect(api.cancelAuthorizationTask).toHaveBeenCalledWith('task-1');
  expect(result.current.taskBlocked).toBe(false);
});

it('creates a new request id after cancelling an unsaved task with the same authorization settings', async () => {
  (api.submitAuthorizationTask as jest.Mock).mockImplementation(async ({ requestId }) => ({
    code: 0,
    data: { ...queued, requestId, status: 'FAILED', dataApplied: 0, canCancel: true },
  }));
  (api.cancelAuthorizationTask as jest.Mock).mockResolvedValue({ code: 0, data: { ...queued, status: 'CANCELLED' } });
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  const done = jest.fn();
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', done));
  await act(async () => result.current.cancelTask());
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', done));
  const calls = (api.submitAuthorizationTask as jest.Mock).mock.calls;
  expect(calls[0][0].requestId).not.toBe(calls[1][0].requestId);
  expect(done).not.toHaveBeenCalled();
});

it('preserves action failure messages returned as strings', async () => {
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({
    code: 0,
    data: [{ ...queued, status: 'FAILED', dataApplied: 0, canCancel: true }],
  });
  (api.cancelAuthorizationTask as jest.Mock).mockRejectedValue('当前用户已无授权维护权限');
  const { result } = setup();
  await waitFor(() => expect(result.current.task?.status).toBe('FAILED'));
  await act(async () => result.current.cancelTask());
  expect(result.current.taskError).toBe('当前用户已无授权维护权限');
  expect(result.current.taskBlocked).toBe(true);
});

it('resets the request id when refresh confirms cancellation after a lost response', async () => {
  (api.submitAuthorizationTask as jest.Mock).mockImplementation(async ({ requestId }) => ({
    code: 0,
    data: { ...queued, requestId, status: 'FAILED', dataApplied: 0, canCancel: true },
  }));
  (api.cancelAuthorizationTask as jest.Mock).mockRejectedValue(new Error('timeout'));
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', jest.fn()));
  const previous = result.current.task;
  await act(async () => result.current.cancelTask());
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({
    code: 0,
    data: [{ ...previous, status: 'CANCELLED' }],
  });
  (api.findAuthorizationTaskRequest as jest.Mock).mockResolvedValue({
    code: 0,
    data: { ...previous, status: 'CANCELLED' },
  });
  await act(async () => result.current.refreshTask());
  expect(result.current.taskBlocked).toBe(false);
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', jest.fn()));
  expect((api.submitAuthorizationTask as jest.Mock).mock.calls[1][0].requestId).not.toBe(previous.requestId);
});

it('does not mix historical MANAGE success with an uncertain USE submission', async () => {
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({
    code: 0,
    data: [
      {
        ...queued,
        operation: 'MANAGE',
        status: 'SUCCEEDED',
        progress: 100,
        completedUsers: 37,
        totalUsers: 37,
      },
    ],
  });
  (api.submitAuthorizationTask as jest.Mock).mockRejectedValue('网络异常');
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  expect(result.current.task).toBeUndefined();
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', jest.fn()));
  expect(result.current.task).toBeUndefined();
  expect(result.current.taskError).toContain('网络异常');
});

it('confirms only the exact request after a lost response even when it is absent from recent history', async () => {
  (api.submitAuthorizationTask as jest.Mock).mockRejectedValue('timeout');
  (api.findAuthorizationTaskRequest as jest.Mock).mockImplementation(async (resourceId, requestId) => ({
    code: 0,
    data: { ...queued, taskId: 'exact-success', requestId, status: 'SUCCEEDED', progress: 100 },
  }));
  const done = jest.fn();
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', done));
  expect(result.current.task?.taskId).toBe('exact-success');
  expect(result.current.taskError).toBe('');
  expect(result.current.taskBlocked).toBe(false);
  expect(done).toHaveBeenCalledTimes(1);
});

it('keeps cross-operation blockers visible and clears their progress when they finish', async () => {
  const blocker = { ...queued, operation: 'MANAGE', blocksResource: true };
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({ code: 0, data: [blocker] });
  (api.getAuthorizationTask as jest.Mock).mockImplementation(async () => {
    const finished = { ...blocker, status: 'SUCCEEDED', progress: 100, blocksResource: false };
    (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({ code: 0, data: [finished] });
    return { code: 0, data: finished };
  });
  const { result } = setup();
  await waitFor(() => expect(result.current.task?.operation).toBe('MANAGE'));
  expect(result.current.taskBlocked).toBe(true);
  await waitFor(() => expect(result.current.task).toBeUndefined(), { timeout: 4000 });
  expect(result.current.taskBlocked).toBe(false);
});

it('does not let a delayed history refresh restore a success bar after a new submission fails', async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  let resolveHistory;
  (api.listAuthorizationTasks as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveHistory = resolve;
      })
  );
  let oldRefresh;
  act(() => {
    oldRefresh = result.current.refreshTask();
  });
  (api.submitAuthorizationTask as jest.Mock).mockRejectedValue('save rejected');
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', jest.fn()));
  await act(async () => {
    resolveHistory({ code: 0, data: [{ ...queued, status: 'SUCCEEDED', progress: 100 }] });
    await oldRefresh;
  });
  expect(result.current.task).toBeUndefined();
  expect(result.current.taskError).toContain('save rejected');
  expect(result.current.taskChecking).toBe(false);
});

it('ignores a failed history record whose resource reservation has been released', async () => {
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({
    code: 0,
    data: [
      {
        ...queued,
        status: 'FAILED',
        blocksResource: false,
      },
    ],
  });
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  expect(result.current.task).toBeUndefined();
  expect(result.current.taskBlocked).toBe(false);
});
