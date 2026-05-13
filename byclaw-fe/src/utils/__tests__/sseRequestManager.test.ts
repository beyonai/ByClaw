import { sseRequestManager } from '../sseRequestManager';

describe('utils/sseRequestManager', () => {
  beforeEach(() => {
    sseRequestManager.cancelAll();
    jest.clearAllMocks();
  });

  it('registers and unregisters requests', async () => {
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const cancel = jest.fn();

    expect(sseRequestManager.register('s1', 'm1', cancel, promise)).toBe(true);
    expect(sseRequestManager.getActiveCount()).toBe(1);
    expect(sseRequestManager.getActiveCountBySession('s1')).toBe(1);

    resolvePromise();
    await promise;
    await Promise.resolve();

    expect(sseRequestManager.getActiveCount()).toBe(0);
  });

  it('rejects registrations beyond max concurrency', () => {
    const never = new Promise(() => {});
    for (let i = 0; i < 6; i += 1) {
      expect(sseRequestManager.register(`s${i}`, `m${i}`, jest.fn(), never)).toBe(true);
    }
    expect(sseRequestManager.canStartNewRequest()).toBe(false);
    expect(sseRequestManager.register('s7', 'm7', jest.fn(), never)).toBe(false);
  });

  it('returns active requests by session and can cancel by session', () => {
    const cancelA = jest.fn();
    const cancelB = jest.fn();
    const never = new Promise(() => {});

    sseRequestManager.register('s1', 'm1', cancelA, never);
    sseRequestManager.register('s1', 'm2', cancelB, never);

    expect(sseRequestManager.getActiveRequestsBySession('s1')).toHaveLength(2);
    sseRequestManager.cancelAllBySession('s1');
    expect(cancelA).toHaveBeenCalled();
    expect(cancelB).toHaveBeenCalled();
    expect(sseRequestManager.getActiveCount()).toBe(0);
  });

  it('cancelAll cancels and clears everything', () => {
    const cancelA = jest.fn();
    const cancelB = jest.fn();
    const never = new Promise(() => {});

    sseRequestManager.register('s1', 'm1', cancelA, never);
    sseRequestManager.register('s2', 'm2', cancelB, never);

    sseRequestManager.cancelAll();
    expect(cancelA).toHaveBeenCalled();
    expect(cancelB).toHaveBeenCalled();
    expect(sseRequestManager.getActiveCount()).toBe(0);
  });
});
