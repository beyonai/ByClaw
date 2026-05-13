jest.mock('lodash', () => ({
  ...jest.requireActual('lodash'),
  throttle: (fn: any) => fn,
  delay: (fn: any, wait: number) => setTimeout(fn, wait),
}));

import { renderHook, act } from '@testing-library/react';
import useCountdown from '../useCountDown';

describe('hooks/useCountDown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('starts and updates remaining time', () => {
    const { result } = renderHook(() => useCountdown(50));

    act(() => {
      result.current.start();
      jest.advanceTimersByTime(20);
    });

    expect(result.current.isRunning).toBe(true);
    expect(result.current.remainingTime).toBeLessThan(50);
    expect(result.current.remainingTime).toBeGreaterThan(0);
  });

  it('pauses countdown and keeps remaining time stable', () => {
    const { result } = renderHook(() => useCountdown(50));

    act(() => {
      result.current.start();
      jest.advanceTimersByTime(20);
    });

    act(() => {
      result.current.pause();
    });

    const paused = result.current.remainingTime;

    act(() => {
      jest.advanceTimersByTime(50);
    });

    expect(result.current.isRunning).toBe(false);
    expect(result.current.remainingTime).toBe(paused);
  });

  it('resets after completion when onComplete is provided', () => {
    const onComplete = jest.fn();
    const { result } = renderHook(() => useCountdown(20, onComplete));

    act(() => {
      result.current.start();
      jest.advanceTimersByTime(30);
    });

    expect(onComplete).toHaveBeenCalled();
    expect(result.current.isRunning).toBe(false);
    expect(result.current.isCompleted).toBe(false);
    expect(result.current.remainingTime).toBe(20);
  });

  it('setTime replaces total time and resets progress', () => {
    const { result } = renderHook(() => useCountdown(50));

    act(() => {
      result.current.start();
      jest.advanceTimersByTime(10);
      result.current.setTime(100);
    });

    expect(result.current.remainingTime).toBe(100);
    expect(result.current.progress).toBe(0);
  });
});
