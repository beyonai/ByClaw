jest.mock('antd', () => ({ message: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../service/authorizationTasks', () => ({
  submitAuthorizationTask: jest.fn(),
  listAuthorizationTasks: jest.fn(),
  getAuthorizationTask: jest.fn(),
  retryAuthorizationTask: jest.fn(),
  cancelAuthorizationTask: jest.fn(),
}));
import { act, renderHook, waitFor } from '@testing-library/react';
import * as api from '../../service/authorizationTasks';
import useAuthorizationTask from '../useAuthorizationTask';

const queued = { taskId: 'task-1', requestId: 'request-1', status: 'QUEUED', progress: 0 };
const setup = () => renderHook(() => useAuthorizationTask({ enabled: true, resourceId: '13', onCompleted: jest.fn() }));

beforeEach(() => {
  jest.resetAllMocks();
  (api.listAuthorizationTasks as jest.Mock).mockResolvedValue({ code: 0, data: [] });
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
