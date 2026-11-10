import { act, renderHook } from '@testing-library/react';
import useFileTransferQueue from '../useFileTransferQueue';
import type { FileTransferProgress } from '@/service/resumableFileUpload';

it('keeps interleaved file progress, failure and retry independent', async () => {
  const reports: Record<string, (progress: FileTransferProgress) => void> = {};
  const pending: Record<string, { resolve: () => void; reject: (error: Error) => void }> = {};
  const upload = jest.fn((task, report) => {
    reports[task.id] = report;
    return new Promise<void>((resolve, reject) => {
      pending[task.id] = { resolve, reject };
    });
  });
  const { result } = renderHook(() => useFileTransferQueue(upload));
  let initial: Promise<boolean>;
  act(() => {
    initial = result.current.start(
      ['a', 'b'].map((id) => ({ id, file: new File(['12345678'], `${id}.bin`), path: '/by/', overwrite: false }))
    );
  });
  act(() => {
    reports.b({ loaded: 6, total: 8, phase: 'uploading', fileName: 'b.bin' });
    reports.a({ loaded: 2, total: 8, phase: 'uploading', fileName: 'a.bin' });
  });
  expect(result.current.rows.map((row) => row.progress.loaded)).toEqual([2, 6]);
  const oldReportA = reports.a;
  await act(async () => {
    pending.a.reject(new Error('a failed'));
    await Promise.resolve();
  });
  expect(result.current.rows.map((row) => row.status)).toEqual(['failed', 'uploading']);
  let retry: Promise<boolean>;
  act(() => {
    retry = result.current.retry('a');
  });
  act(() => {
    reports.a({ loaded: 7, total: 8, phase: 'uploading', fileName: 'a.bin' });
  });
  act(() => {
    oldReportA({ loaded: 1, total: 8, phase: 'uploading', fileName: 'a.bin' });
  });
  expect(result.current.rows[0].progress.loaded).toBe(7);
  expect(result.current.rows[1].progress.loaded).toBe(6);
  await act(async () => {
    pending.b.resolve();
    pending.a.resolve();
    await initial!;
    await retry!;
  });
  expect(result.current.rows.map((row) => row.status)).toEqual(['success', 'success']);
  expect(upload.mock.calls.map(([task]) => task.id)).toEqual(['a', 'b', 'a']);
});

it('does not duplicate an active retry or restart a successful sibling', async () => {
  let resolveUpload: () => void;
  const upload = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveUpload = resolve;
      })
  );
  const { result } = renderHook(() => useFileTransferQueue(upload));
  let started: Promise<boolean>;
  act(() => {
    started = result.current.start([{ id: 'a', file: new File(['a'], 'a.bin'), path: '/by/', overwrite: false }]);
  });
  await act(async () => {
    expect(await result.current.retry('a')).toBe(false);
  });
  expect(upload).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveUpload!();
    await started!;
  });
  await act(async () => {
    expect(await result.current.retry('a')).toBe(false);
  });
  expect(upload).toHaveBeenCalledTimes(1);
});

it('removes failed destinations when the employee changes and rejects their stale retry', async () => {
  const upload = jest.fn().mockRejectedValue(new Error('offline'));
  const { result, rerender } = renderHook(({ scope }) => useFileTransferQueue(upload, scope), {
    initialProps: { scope: 'employee-a' },
  });
  await act(async () => {
    await result.current.start([
      {
        id: 'a',
        file: new File(['a'], 'skill.zip'),
        path: '/by/',
        overwrite: false,
        context: { key: 'employee-a', resourceId: 'a', ownerKey: 'user', sessionId: 'chat' },
      },
    ]);
  });
  expect(result.current.rows[0].status).toBe('failed');
  rerender({ scope: 'employee-b' });
  expect(result.current.rows.length).toBe(0);
  await act(async () => expect(await result.current.retry('a')).toBe(false));
  expect(upload).toHaveBeenCalledTimes(1);
});

it('ignores old context progress and completions when a new context reuses a task ID', async () => {
  const reports: ((progress: FileTransferProgress) => void)[] = [];
  const finishes: (() => void)[] = [];
  const upload = jest.fn((_task, report) => {
    reports.push(report);
    return new Promise<void>((resolve) => finishes.push(resolve));
  });
  const { result, rerender } = renderHook(({ scope }) => useFileTransferQueue(upload, scope), {
    initialProps: { scope: 'a' },
  });
  const task = (key: string) => ({
    id: 'same',
    file: new File(['12345'], 'file'),
    path: '/by/',
    overwrite: false,
    context: { key, resourceId: key, ownerKey: 'user', sessionId: 'chat' },
  });
  let oldBatch: Promise<boolean>;
  act(() => {
    oldBatch = result.current.start([task('a')]);
  });
  rerender({ scope: 'b' });
  let currentBatch: Promise<boolean>;
  act(() => {
    currentBatch = result.current.start([task('b')]);
  });
  act(() => reports[0]({ loaded: 5, total: 5, phase: 'uploading', fileName: 'file' }));
  expect(result.current.rows[0].progress.loaded).toBe(0);
  await act(async () => {
    finishes[0]();
    expect(await oldBatch!).toBe(false);
  });
  expect(result.current.rows[0].status).toBe('uploading');
  await act(async () => {
    finishes[1]();
    await currentBatch!;
  });
  expect(result.current.rows[0].status).toBe('success');
});

it('cancels queued jobs before their storage lane starts without cancelling the active file', async () => {
  const tasks: any[] = [];
  const finishes: (() => void)[] = [];
  const upload = jest.fn((task, report) => {
    tasks.push(task);
    if (task.id === 'queued') report({ loaded: 0, total: 1, phase: 'queued', fileName: 'q' });
    return new Promise<void>((resolve) => finishes.push(resolve));
  });
  const { result } = renderHook(() => useFileTransferQueue(upload));
  let batch: Promise<boolean>;
  act(() => {
    batch = result.current.start(
      ['active', 'queued'].map((id) => ({ id, path: '/by/', file: new File(['x'], id), overwrite: false }))
    );
  });
  act(() => result.current.cancelQueued());
  expect(() => tasks[0].checkActive()).not.toThrow();
  expect(() => tasks[1].checkActive()).toThrow();
  await act(async () => {
    finishes.forEach((finish) => finish());
    await batch!;
  });
  expect(result.current.rows.map((row) => row.status)).toEqual(['success', 'failed']);
});
