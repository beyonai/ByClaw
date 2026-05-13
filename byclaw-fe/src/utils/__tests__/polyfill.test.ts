describe('utils/polyfill', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('installs requestIdleCallback and cancelIdleCallback when missing', () => {
    jest.useFakeTimers();
    delete (window as any).requestIdleCallback;
    delete (window as any).cancelIdleCallback;

    jest.isolateModules(() => {
      require('../polyfill');
    });

    expect(typeof window.requestIdleCallback).toBe('function');
    expect(typeof window.cancelIdleCallback).toBe('function');
  });

  it('executes idle callback and supports cancellation', () => {
    jest.useFakeTimers();
    delete (window as any).requestIdleCallback;
    delete (window as any).cancelIdleCallback;

    jest.isolateModules(() => {
      require('../polyfill');
    });

    const cb = jest.fn();
    const handle = window.requestIdleCallback(cb, { timeout: 10 });
    window.cancelIdleCallback(handle);
    jest.runAllTimers();

    expect(cb).not.toHaveBeenCalled();

    const cb2 = jest.fn();
    window.requestIdleCallback(cb2, { timeout: 10 });
    jest.runAllTimers();
    expect(cb2).toHaveBeenCalled();
  });
});
