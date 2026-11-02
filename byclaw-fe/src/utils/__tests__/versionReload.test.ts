import { startVersionReloadWatcher, stopVersionReloadWatcher } from '../versionReload';

describe('versionReload', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-24T00:00:00+08:00'));
    stopVersionReloadWatcher();
  });

  afterEach(() => {
    stopVersionReloadWatcher();
    jest.useRealTimers();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('does not reload when version build time is unchanged', async () => {
    const reload = jest.fn();
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildDate: '2026-06-24 00:00:00' }),
    });

    startVersionReloadWatcher({
      buildTime: String(new Date('2026-06-24T00:00:00+08:00').getTime()),
      intervalMs: 1000,
      fetcher: fetcher as unknown as typeof fetch,
      location: { reload } as Pick<Location, 'reload'>,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(fetcher).toHaveBeenCalledWith('/beyond/version.txt?t=1782230400000', { cache: 'no-store' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads when version build time changes', async () => {
    const reload = jest.fn();
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildDate: '2026-06-24 00:01:00' }),
    });

    startVersionReloadWatcher({
      buildTime: String(new Date('2026-06-24T00:00:00+08:00').getTime()),
      intervalMs: 1000,
      fetcher: fetcher as unknown as typeof fetch,
      location: { reload } as Pick<Location, 'reload'>,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stops the active interval', () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildDate: '2026-06-24 00:00:00' }),
    });

    startVersionReloadWatcher({
      buildTime: String(new Date('2026-06-24T00:00:00+08:00').getTime()),
      intervalMs: 1000,
      fetcher: fetcher as unknown as typeof fetch,
      location: { reload: jest.fn() } as Pick<Location, 'reload'>,
    });
    stopVersionReloadWatcher();
    jest.advanceTimersByTime(1000);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
