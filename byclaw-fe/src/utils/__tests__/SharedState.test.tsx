import { renderHook, act } from '@testing-library/react';
import { SharedState } from '../SharedState';

describe('utils/SharedState', () => {
  it('useValue reads and updates a top-level key', () => {
    const store = new SharedState({ count: 1, nested: { name: 'a' } });
    const { result } = renderHook(() => store.useValue('count' as any));

    expect(result.current[0]).toBe(1);

    act(() => {
      result.current[1](2);
    });

    expect(result.current[0]).toBe(2);
  });

  it('useValue supports updater functions and nested paths', () => {
    const store = new SharedState({ count: 1, nested: { name: 'a' } });
    const { result } = renderHook(() => store.useValue('nested.name' as any));

    expect(result.current[0]).toBe('a');

    act(() => {
      result.current[1]((prev: string) => `${prev}-b`);
    });

    expect(result.current[0]).toBe('a-b');
  });

  it('emit notifies generic listeners', () => {
    const store = new SharedState({ count: 1 });
    const listener = jest.fn();

    (store as any).on('custom', listener);
    store.emit('custom', { ok: true });

    expect(listener).toHaveBeenCalledWith({ ok: true });
  });

  it('emit with bracket syntax updates a subscribed key', () => {
    const store = new SharedState({ count: 1 });
    const { result } = renderHook(() => store.useValue('count' as any));

    act(() => {
      store.emit('[count]', 5);
    });

    expect(result.current[0]).toBe(5);
  });
});
