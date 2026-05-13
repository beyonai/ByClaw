import { renderHook, act } from '@testing-library/react';
import usePolling from '../usePolling';

describe('hooks/usePolling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('starts immediately and stops when onSuccess returns true', async () => {
    const queryFn = jest.fn().mockResolvedValue('ok');
    const onSuccess = jest.fn(() => true);
    const onStop = jest.fn();
    const { result } = renderHook(() => usePolling(queryFn, { onSuccess, onStop }));

    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith('ok');
    expect(result.current.retryCount).toBe(1);
    expect(result.current.isStopped).toBe(true);
    expect(onStop).toHaveBeenCalled();
  });

  it('stops after reaching maxRetries', async () => {
    const queryFn = jest.fn().mockResolvedValue('ok');
    const { result } = renderHook(() => usePolling(queryFn, { maxRetries: 2, interval: 100 }));

    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(result.current.retryCount).toBe(2);
    expect(result.current.isStopped).toBe(true);
  });

  it('calls onError and stops when query fails', async () => {
    const error = new Error('failed');
    const queryFn = jest.fn().mockRejectedValue(error);
    const onError = jest.fn();
    const onStop = jest.fn();
    const { result } = renderHook(() => usePolling(queryFn, { onError, onStop }));

    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith(error);
    expect(onStop).toHaveBeenCalled();
    expect(result.current.isStopped).toBe(true);
    expect(result.current.isPolling).toBe(false);
  });
});
