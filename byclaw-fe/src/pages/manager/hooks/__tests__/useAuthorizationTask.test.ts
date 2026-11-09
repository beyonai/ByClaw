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

it('restores a blocker on reopen and moves its success into history without confirming a new submission', async () => {
  const onCompleted = jest.fn();
  (api.listAuthorizationTasks as jest.Mock)
    .mockResolvedValueOnce({ code: 0, data: [queued] })
    .mockResolvedValue({ code: 0, data: [{ ...queued, status: 'SUCCEEDED', progress: 100 }] });
  const { result } = renderHook(() => useAuthorizationTask({ enabled: true, resourceId: '13', onCompleted }));
  await waitFor(() => expect(result.current.blockingTask?.status).toBe('QUEUED'));
  expect(result.current.task).toBeUndefined();
  expect(result.current.taskBlocked).toBe(true);
  await waitFor(() => expect(result.current.historicalTask?.status).toBe('SUCCEEDED'), { timeout: 4000 });
  expect(result.current.blockingTask).toBeUndefined();
  expect(result.current.taskBlocked).toBe(false);
  expect(onCompleted).not.toHaveBeenCalled();
});

it('does not treat queue acceptance as successful authorization', async () => {
  (api.submitAuthorizationTask as jest.Mock).mockImplementation(async ({ requestId, operation }) => ({
    code: 0,
    data: { ...queued, requestId, operation },
  }));
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

it('keeps the blocker visible when progress refresh fails', async () => {
  (api.listAuthorizationTasks as jest.Mock)
    .mockResolvedValueOnce({ code: 0, data: [queued] })
    .mockRejectedValue(new Error('offline'));
  const { result } = setup();
  await waitFor(() => expect(result.current.blockingTask?.status).toBe('QUEUED'));
  await waitFor(() => expect(result.current.taskError).toContain('暂时无法查询'), { timeout: 4000 });
  expect(result.current.blockingTask?.status).toBe('QUEUED');
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
  await waitFor(() => expect(result.current.blockingTask?.status).toBe('FAILED'));
  await act(async () => result.current.retryTask());
  expect(result.current.blockingTask?.status).toBe('RETRYING');
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
  expect(result.current.blockingTask).toEqual(blocking);
  expect(result.current.task).toBeUndefined();
  expect(result.current.taskError).toContain('该资源已有未完成的授权任务');
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
  (api.cancelAuthorizationTask as jest.Mock).mockImplementation(async () => ({
    code: 0,
    data: {
      ...queued,
      requestId: (api.submitAuthorizationTask as jest.Mock).mock.calls[0][0].requestId,
      status: 'CANCELLED',
    },
  }));
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
  await waitFor(() => expect(result.current.blockingTask?.status).toBe('FAILED'));
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

it('keeps cross-operation blockers visible then displays their completed progress only as history', async () => {
  const blocker = { ...queued, operation: 'MANAGE', blocksResource: true };
  const finished = { ...blocker, status: 'SUCCEEDED', progress: 100, blocksResource: false };
  (api.listAuthorizationTasks as jest.Mock)
    .mockResolvedValueOnce({ code: 0, data: [blocker] })
    .mockResolvedValue({ code: 0, data: [finished] });
  const { result } = setup();
  await waitFor(() => expect(result.current.blockingTask?.operation).toBe('MANAGE'));
  expect(result.current.taskBlocked).toBe(true);
  await waitFor(() => expect(result.current.historicalTask).toEqual(finished), { timeout: 4000 });
  expect(result.current.task).toBeUndefined();
  expect(result.current.blockingTask).toBeUndefined();
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

it('shows historical success separately even for the same operation and never invokes completion for it', async () => {
  const history = { ...queued, status: 'SUCCEEDED', progress: 100, totalUsers: 37, completedUsers: 37 };
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({ code: 0, data: [history] });
  (api.submitAuthorizationTask as jest.Mock).mockRejectedValue('timeout');
  const onCompleted = jest.fn();
  const done = jest.fn();
  const { result } = renderHook(() => useAuthorizationTask({ enabled: true, resourceId: '13', onCompleted }));
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', done));
  expect(result.current.task).toBeUndefined();
  expect(result.current.historicalTask).toEqual(history);
  expect(result.current.taskError).toContain('timeout');
  expect(done).not.toHaveBeenCalled();
  expect(onCompleted).not.toHaveBeenCalled();
});

it('keeps another blocker visible even when the matching request has succeeded', async () => {
  const blocker = {
    ...queued,
    taskId: 'other',
    requestId: 'other',
    operation: 'MANAGE',
    submittedByCurrentUser: false,
  };
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({ code: 0, data: [blocker] });
  (api.findAuthorizationTaskRequest as jest.Mock).mockImplementation(async (resourceId, requestId) => ({
    code: 0,
    data: { ...queued, requestId, status: 'SUCCEEDED' },
  }));
  (api.submitAuthorizationTask as jest.Mock).mockRejectedValue('timeout');
  const done = jest.fn();
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', done));
  expect(result.current.task?.status).toBe('SUCCEEDED');
  expect(result.current.blockingTask).toEqual(blocker);
  expect(result.current.taskBlocked).toBe(true);
  expect(done).toHaveBeenCalledTimes(1);
});

it('still exposes the blocker when the exact request query fails', async () => {
  const blocker = { ...queued, operation: 'MANAGE', status: 'FAILED', blocksResource: true };
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({ code: 0, data: [blocker] });
  (api.findAuthorizationTaskRequest as jest.Mock).mockRejectedValue('offline');
  (api.submitAuthorizationTask as jest.Mock).mockRejectedValue('timeout');
  const { result } = setup();
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', jest.fn()));
  expect(result.current.task).toBeUndefined();
  expect(result.current.blockingTask).toEqual(blocker);
  expect(result.current.taskBlocked).toBe(true);
});

it.each(['request', 'operation', 'owner'])(
  'never confirms an unmatched %s in the submit response',
  async (mismatch) => {
    (api.submitAuthorizationTask as jest.Mock).mockImplementation(async ({ requestId, operation }) => ({
      code: 0,
      data: {
        ...queued,
        requestId: mismatch === 'request' ? 'old-request' : requestId,
        operation: mismatch === 'operation' ? 'MANAGE' : operation,
        submittedByCurrentUser: mismatch !== 'owner',
        status: 'SUCCEEDED',
      },
    }));
    const done = jest.fn();
    const { result } = setup();
    await waitFor(() => expect(result.current.taskChecking).toBe(false));
    await act(async () => result.current.submitTask({ resourceId: '13' }, 'USE', done));
    expect(result.current.task).toBeUndefined();
    expect(result.current.taskError).toContain('不匹配');
    expect(done).not.toHaveBeenCalled();
  }
);

it('ignores a response from the previous operation after switching drawers', async () => {
  let resolveSubmit;
  (api.submitAuthorizationTask as jest.Mock).mockImplementation(
    ({ requestId, operation }) =>
      new Promise((resolve) => {
        resolveSubmit = () => resolve({ code: 0, data: { ...queued, requestId, operation, status: 'SUCCEEDED' } });
      })
  );
  const done = jest.fn();
  const { result, rerender } = renderHook(
    ({ operation }) => useAuthorizationTask({ enabled: true, resourceId: '13', operation, onCompleted: jest.fn() }),
    { initialProps: { operation: 'USE' } }
  );
  await waitFor(() => expect(result.current.taskChecking).toBe(false));
  let submission;
  act(() => {
    submission = result.current.submitTask({ resourceId: '13' }, 'USE', done);
  });
  rerender({ operation: 'MANAGE' });
  await act(async () => {
    resolveSubmit();
    await submission;
  });
  expect(result.current.task).toBeUndefined();
  expect(done).not.toHaveBeenCalled();
});
