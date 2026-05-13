import { renderHook, act } from '@testing-library/react';
import useModuleEvent from '../useModuleEvent';

describe('hooks/useModuleEvent', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValueOnce(0.111111).mockReturnValueOnce(0.222222);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('broadcasts emitted events to other instances of the same module only', () => {
    const { result: a } = renderHook(() => useModuleEvent('module-a'));
    const { result: b } = renderHook(() => useModuleEvent('module-a'));
    const { result: c } = renderHook(() => useModuleEvent('module-b'));

    const listenerA = jest.fn();
    const listenerB = jest.fn();
    const listenerC = jest.fn();

    a.current.moduleEventEmitter.on('change', listenerA);
    b.current.moduleEventEmitter.on('change', listenerB);
    c.current.moduleEventEmitter.on('change', listenerC);

    act(() => {
      a.current.moduleEventEmitter.emit('change', { value: 1 });
    });

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledWith({ value: 1 });
    expect(listenerC).not.toHaveBeenCalled();
  });

  it('removes an instance from the module registry on logout', () => {
    const { result: a } = renderHook(() => useModuleEvent('module-a'));
    const { result: b } = renderHook(() => useModuleEvent('module-a'));
    const listenerA = jest.fn();

    a.current.moduleEventEmitter.on('change', listenerA);

    act(() => {
      a.current.logoutModuleEvent();
      b.current.moduleEventEmitter.emit('change', { value: 2 });
    });

    expect(listenerA).not.toHaveBeenCalled();
  });
});
