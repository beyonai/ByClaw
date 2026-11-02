import { act, renderHook } from '@testing-library/react';
import { getEffectiveEnableDsh } from '@/service/system';
import { useChatRuntime } from '../useChatRuntime';

jest.mock('@/service/system', () => ({ getEffectiveEnableDsh: jest.fn() }));

beforeEach(() => jest.resetAllMocks());

it('clears the previous runtime on session change and ignores a late response', async () => {
  let resolveOld!: (value: string) => void;
  jest.mocked(getEffectiveEnableDsh).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      })
  );
  jest.mocked(getEffectiveEnableDsh).mockResolvedValueOnce('1');
  const { result, rerender } = renderHook(({ id }) => useChatRuntime(id), { initialProps: { id: 'old' } });
  expect(result.current.runtimeReady).toBe(false);
  await act(async () => {
    rerender({ id: 'new' });
  });
  expect(result.current.runtimeType).toBe('dsh');
  await act(async () => {
    resolveOld('0');
  });
  expect(result.current.runtimeType).toBe('dsh');
  jest.mocked(getEffectiveEnableDsh).mockImplementationOnce(() => new Promise(() => {}));
  rerender({ id: 'third' });
  expect(result.current.runtimeType).toBe('unknown');
});

it('allows retry after a runtime query failure', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(getEffectiveEnableDsh).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('0');
  const { result } = renderHook(() => useChatRuntime('session'));
  await act(async () => {});
  expect(result.current.runtimeError).toBe(true);
  expect(result.current.runtimeReady).toBe(false);
  await act(async () => {
    result.current.retry();
  });
  expect(result.current.runtimeType).toBe('openclaw');
  expect(result.current.runtimeError).toBe(false);
  log.mockRestore();
});
