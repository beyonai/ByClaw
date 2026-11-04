import { act, renderHook, waitFor, render, screen, fireEvent } from '@testing-library/react';
import useSyncProgress from '../useSyncProgress';
import { SyncProgressContent } from '..';
import { querySyncProgress, retrySync, SyncProgress } from '../service';

jest.mock('../service', () => ({ querySyncProgress: jest.fn(), retrySync: jest.fn() }));
const queued: SyncProgress = {
  jobId: '100',
  resourceId: '10',
  syncRevision: '1',
  status: 'PENDING',
  effective: false,
  retryCount: 0,
  result: { phase: 'QUEUED', message: '资源已接收，正在排队授权' },
};

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

test('restores durable progress, batches duplicate resource IDs, and refreshes completion once', async () => {
  (querySyncProgress as jest.Mock).mockResolvedValue({ code: 0, data: [queued] });
  const completed = jest.fn();
  const { result } = renderHook(() => useSyncProgress(['10', '10'], completed));
  await waitFor(() => expect(result.current.tasks['10']?.status).toBe('PENDING'));
  expect(querySyncProgress).toHaveBeenCalledWith(['10']);
  (querySyncProgress as jest.Mock).mockResolvedValue({
    code: 0,
    data: [{ ...queued, status: 'COMPLETED', effective: true }],
  });
  act(() => result.current.refresh());
  await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
  act(() => result.current.refresh());
  await waitFor(() => expect(querySyncProgress).toHaveBeenCalledTimes(3));
  expect(completed).toHaveBeenCalledTimes(1);
});

test('query failure preserves last progress and never resubmits or retries authorization', async () => {
  (querySyncProgress as jest.Mock)
    .mockResolvedValueOnce({ code: 0, data: [queued] })
    .mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useSyncProgress(['10']));
  await waitFor(() => expect(result.current.tasks['10']).toEqual(queued));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.error).toContain('后台可能仍在处理'));
  expect(result.current.tasks['10']).toEqual(queued);
  expect(retrySync).not.toHaveBeenCalled();
});

test('discard delayed responses from the previous resource after navigation', async () => {
  let resolveOld: (value: unknown) => void = () => {};
  (querySyncProgress as jest.Mock)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    )
    .mockResolvedValue({ code: 0, data: [{ ...queued, resourceId: '20', jobId: '200' }] });
  const { result, rerender } = renderHook(({ id }) => useSyncProgress([id]), { initialProps: { id: '10' } });
  rerender({ id: '20' });
  await waitFor(() => expect(result.current.tasks['20']?.jobId).toBe('200'));
  await act(async () => resolveOld({ code: 0, data: [queued] }));
  expect(result.current.tasks['10']).toBeUndefined();
});

test('large lists use bounded batches instead of one request per card', async () => {
  (querySyncProgress as jest.Mock).mockResolvedValue({ code: 0, data: [] });
  renderHook(() => useSyncProgress(Array.from({ length: 250 }, (_, id) => String(id))));
  await waitFor(() => expect(querySyncProgress).toHaveBeenCalledTimes(3));
  expect((querySyncProgress as jest.Mock).mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 50]);
});

test('shows uncertain scope without a fabricated percentage and preserves skip reasons', () => {
  render(
    <SyncProgressContent
      task={{ ...queued, result: { ...queued.result, skippedUserCount: 2, skipReasons: { NO_PERSONAL_ASSISTANT: 2 } } }}
      refresh={jest.fn()}
    />
  );
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByText('尚未创建个人助手：2')).toBeInTheDocument();
  expect(screen.queryByText('重试未完成部分')).not.toBeInTheDocument();
});

test('failed authorized task retries the same ID and refreshes its saved checkpoint', async () => {
  const refresh = jest.fn();
  (retrySync as jest.Mock).mockResolvedValue({ code: 0, data: queued });
  render(<SyncProgressContent task={{ ...queued, status: 'FAILED', canRetry: true }} refresh={refresh} />);
  fireEvent.click(screen.getByText('重试未完成部分'));
  await waitFor(() => expect(retrySync).toHaveBeenCalledWith('100'));
  expect(refresh).toHaveBeenCalledTimes(1);
});
