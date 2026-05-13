import { createRef } from 'react';
import { renderHook } from '@testing-library/react';
import useVirtualHeight from '../useVirtualHeight';

describe('hooks/useVirtualHeight', () => {
  it('reads initial container height and observes future changes', () => {
    const observe = jest.fn();
    const disconnect = jest.fn();
    (window as any).ResizeObserver = jest.fn().mockImplementation((cb: Function) => ({
      observe,
      disconnect,
      cb,
    }));

    const ref = createRef<HTMLElement>();
    Object.defineProperty(ref, 'current', {
      value: { clientHeight: 120 },
      writable: true,
    });

    const { result, unmount } = renderHook(() => useVirtualHeight(ref));

    expect(result.current).toBe(120);
    expect(observe).toHaveBeenCalledWith(ref.current);

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
