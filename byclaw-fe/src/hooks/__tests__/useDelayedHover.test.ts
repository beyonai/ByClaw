import { renderHook, act } from '@testing-library/react';
import useDelayedHover from '../useDelayedHover';

describe('hooks/useDelayedHover', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('triggers onEnter after the delay', () => {
    const onEnter = jest.fn();
    const { result } = renderHook(() => useDelayedHover({ delay: 100, onEnter }));

    act(() => {
      result.current.onMouseEnter();
      jest.advanceTimersByTime(100);
    });

    expect(onEnter).toHaveBeenCalled();
  });

  it('cancels delayed enter and triggers onLeave on mouse leave', () => {
    const onEnter = jest.fn();
    const onLeave = jest.fn();
    const { result } = renderHook(() => useDelayedHover({ delay: 100, onEnter, onLeave }));

    act(() => {
      result.current.onMouseEnter();
      jest.advanceTimersByTime(50);
      result.current.onMouseLeave();
      jest.advanceTimersByTime(100);
    });

    expect(onEnter).not.toHaveBeenCalled();
    expect(onLeave).toHaveBeenCalled();
  });

  it('cleanup clears pending timer', () => {
    const onEnter = jest.fn();
    const { result } = renderHook(() => useDelayedHover({ delay: 100, onEnter }));

    act(() => {
      result.current.onMouseEnter();
      result.current.cleanup();
      jest.advanceTimersByTime(100);
    });

    expect(onEnter).not.toHaveBeenCalled();
  });
});
