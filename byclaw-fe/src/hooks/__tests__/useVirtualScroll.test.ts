import { renderHook, act } from '@testing-library/react';
import { useVirtualScroll } from '../useVirtualScroll';

describe('hooks/useVirtualScroll', () => {
  it('computes visible window, total height and offset', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { result } = renderHook(() => useVirtualScroll(items, 10, 50, 2));

    expect(result.current.visibleItems).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.current.totalHeight).toBe(200);
    expect(result.current.offsetY).toBe(0);
  });

  it('updates visible range when scrolled', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { result } = renderHook(() => useVirtualScroll(items, 10, 50, 2));

    act(() => {
      result.current.handleScroll({
        currentTarget: { scrollTop: 60 },
      } as any);
    });

    expect(result.current.offsetY).toBe(40);
    expect(result.current.visibleItems).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
});
