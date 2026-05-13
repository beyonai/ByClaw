jest.mock('@/utils', () => ({
  getRuntimeActualUrl: jest.fn((value: string) => `/base/${value}`),
}));

import { getBotSelectedTenantID, setBotSelectedTenantID, ssoLoginByIframe } from '../bot';

describe('utils/bot', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ssoLoginByIframe resolves immediately when url is empty', async () => {
    await expect(ssoLoginByIframe()).resolves.toBeUndefined();
  });

  it('ssoLoginByIframe appends iframe and removes it after load', async () => {
    const appended: any[] = [];
    const removed: any[] = [];
    const iframe = {
      style: {},
      src: '',
      onload: null as null | (() => void),
      onerror: null as null | (() => void),
    };
    jest.spyOn(document, 'createElement').mockReturnValue(iframe as any);
    jest.spyOn(document.body, 'appendChild').mockImplementation((node: any) => {
      appended.push(node);
      return node;
    });
    jest.spyOn(document.body, 'removeChild').mockImplementation((node: any) => {
      removed.push(node);
      return node;
    });

    const promise = ssoLoginByIframe('login');
    expect(appended[0]).toBe(iframe);
    expect(iframe.src).toBe('/base/login');

    iframe.onload?.();
    await expect(promise).resolves.toBe(true);

    jest.advanceTimersByTime(5000);
    expect(removed[0]).toBe(iframe);
  });

  it('stores and reads selected tenant id from sessionStorage', () => {
    setBotSelectedTenantID('tenant-1');
    expect(getBotSelectedTenantID()).toBe('tenant-1');
  });
});
