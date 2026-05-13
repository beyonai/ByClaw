import { renderHook } from '@testing-library/react';
import { useLazyImage } from '../useLazyImage';

describe('hooks/useLazyImage', () => {
  it('returns initial lazy image state', () => {
    const { result } = renderHook(() => useLazyImage('https://img.example.com/a.png'));

    expect(result.current.isLoaded).toBe(false);
    expect(result.current.isInView).toBe(false);
    expect(result.current.imgRef).toBeDefined();
  });
});
