import { createNasReadinessWaiter } from '../nasReadinessWaiter';

describe('personal NAS operation admission', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const pending = { enabled: true, ready: false, taskId: 'a', version: 1, state: 'WAITING_QUOTA' };
  const flush = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };
  function setup(read: jest.Mock, options = {}) {
    let push: (value: any) => void = () => {};
    const unsubscribe = jest.fn();
    const view = jest.fn();
    const waiter = createNasReadinessWaiter({
      read,
      subscribe: (handler: any) => {
        push = handler;
        return unsubscribe;
      },
      isCurrent: () => true,
      onState: view,
      maxWaitMs: 20000,
      fallbackMs: 15000,
      ...options,
    });
    return { waiter, push: (value: any) => push(value), unsubscribe, view };
  }
  it('holds the operation, wakes immediately on push, and requires authoritative ready exactly once', async () => {
    const read = jest
      .fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValue({ ...pending, ready: true, version: 2 });
    const { waiter, push, unsubscribe } = setup(read);
    const operation = jest.fn();
    waiter.promise.then(operation);
    await flush();
    expect(operation).not.toHaveBeenCalled();
    push({ taskId: 'a', version: 2 });
    push({ taskId: 'a', version: 2 });
    await flush();
    expect(operation).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
  it('does not authorize from push or a stale HTTP READY, and ignores another task', async () => {
    const read = jest
      .fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, ready: true })
      .mockResolvedValue({ ...pending, ready: true, version: 3 });
    const { waiter, push } = setup(read);
    const operation = jest.fn();
    waiter.promise.then(operation);
    await flush();
    push({ taskId: 'other', version: 99 });
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    push({ taskId: 'a', version: 3 });
    await flush();
    expect(operation).not.toHaveBeenCalled();
    jest.advanceTimersByTime(15000);
    await flush();
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it('cancel wins over a late ready response', async () => {
    let finish: (value: any) => void = () => {};
    const { waiter } = setup(
      jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
    );
    const outcome = waiter.promise.catch((e: Error) => e.name);
    waiter.cancel();
    finish({ ...pending, ready: true });
    await flush();
    expect(await outcome).toBe('NasReadinessCancelled');
  });
  it('lost push falls back, identity changes cannot dispatch, and stalled calls time out into retry state', async () => {
    let current = true;
    const read = jest.fn().mockResolvedValue(pending);
    const { waiter, view } = setup(read, { isCurrent: () => current });
    const outcome = waiter.promise.catch((e: Error) => e.name);
    await flush();
    jest.advanceTimersByTime(15000);
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    current = false;
    jest.advanceTimersByTime(1000);
    await flush();
    expect(await outcome).toBe('NasReadinessCancelled');
    const hanging = setup(jest.fn(() => new Promise(() => {})));
    hanging.waiter.promise.catch(() => {});
    jest.advanceTimersByTime(20000);
    await flush();
    expect(hanging.view).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'timeout' }));
    hanging.waiter.cancel();
    expect(view).toHaveBeenCalled();
  });
});
