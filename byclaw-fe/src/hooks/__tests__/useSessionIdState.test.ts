import { act, renderHook } from '@testing-library/react';
import useSessionIdState from '../useSessionIdState';

describe('session ID state', () => {
  it('normalizes an ID restored from numeric history state', () => {
    const { result } = renderHook(() => useSessionIdState(11273602));
    expect(result.current[0]).toBe('11273602');
  });

  it('normalizes direct and functional writes without changing the setter identity', () => {
    const { result } = renderHook(() => useSessionIdState());
    const setSessionId = result.current[1];

    act(() => setSessionId(11273602));
    expect(result.current[0]).toBe('11273602');
    act(() => setSessionId((previous) => Number(previous) + 1));
    expect(result.current[0]).toBe('11273603');
    expect(result.current[1]).toBe(setSessionId);

    act(() => setSessionId(null));
    expect(result.current[0]).toBe('');
  });
});
