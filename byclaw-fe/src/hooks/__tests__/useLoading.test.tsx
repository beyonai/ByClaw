jest.mock('@/components/Loading', () => ({
  __esModule: true,
  default: ({ fixed, text, zIndex }: any) => (
    <div data-fixed={String(fixed)} data-text={text} data-z-index={String(zIndex)}>
      loading
    </div>
  ),
}));

import { renderHook, act } from '@testing-library/react';
import { useLoading } from '../useLoading';

describe('hooks/useLoading', () => {
  it('uses defaultLoading as initial state', () => {
    const { result } = renderHook(() => useLoading({ defaultLoading: true }));
    expect(result.current.isLoading).toBe(true);
  });

  it('setIsLoading controls Loading rendering', () => {
    const { result } = renderHook(() => useLoading());

    expect(result.current.Loading({})).toBeNull();

    act(() => {
      result.current.setIsLoading(true);
    });

    const node = result.current.Loading({ text: 'please wait', zIndex: 10 });
    expect(node).not.toBeNull();
  });

  it('explicit loading prop overrides internal state', () => {
    const { result } = renderHook(() => useLoading());
    expect(result.current.Loading({ loading: true, fixed: false, text: 'x', zIndex: 1 })).not.toBeNull();
  });
});
