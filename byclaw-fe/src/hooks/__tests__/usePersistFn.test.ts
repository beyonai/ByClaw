import { renderHook } from '@testing-library/react';
import usePersistFn from '../usePersistFn';

describe('hooks/usePersistFn', () => {
  it('returns a stable function identity across rerenders', () => {
    const fn = jest.fn((value: number) => value + 1);
    const { result, rerender } = renderHook(({ handler }) => usePersistFn(handler), {
      initialProps: { handler: fn },
    });

    const first = result.current;
    rerender({ handler: jest.fn((value: number) => value + 2) });

    expect(result.current).toBe(first);
  });

  it('always calls the latest function implementation', () => {
    const fn1 = jest.fn((value: number) => value + 1);
    const fn2 = jest.fn((value: number) => value + 2);

    const { result, rerender } = renderHook(({ handler }) => usePersistFn(handler), {
      initialProps: { handler: fn1 },
    });

    expect(result.current(1)).toBe(2);
    rerender({ handler: fn2 });
    expect(result.current(1)).toBe(3);
  });
});
