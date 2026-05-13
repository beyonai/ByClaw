import { renderHook } from '@testing-library/react';
import { useSticky } from '../useSticky';

describe('hooks/useSticky', () => {
  it('returns refs and initial sticky state', () => {
    const { result } = renderHook(() => useSticky({ threshold: 20 }));

    expect(result.current.isSticky).toBe(false);
    expect(result.current.parentRef).toBeDefined();
    expect(result.current.divRef).toBeDefined();
  });
});
