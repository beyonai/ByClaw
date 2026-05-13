jest.mock('react-dom/client', () => ({
  createRoot: jest.fn(() => ({
    render: jest.fn(),
  })),
}));

jest.mock('@ant-design/icons', () => ({
  CloseOutlined: () => null,
}));

jest.mock('..', () => ({
  getPublicPath: jest.fn(() => '/app/'),
}));

import getWhaleSysCode from '../datacloud/getWhaleSysCode';

describe('utils/datacloud/getWhaleSysCode', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://example.com',
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('resolves code when receiving datacloud-login-code message', async () => {
    const listeners: Record<string, Function> = {};
    jest.spyOn(window, 'addEventListener').mockImplementation(((type: string, cb: Function) => {
      listeners[type] = cb;
    }) as any);
    jest.spyOn(window, 'removeEventListener').mockImplementation(jest.fn() as any);

    const promise = getWhaleSysCode('https://auth.example.com/login?x=1', {});

    listeners.message?.({
      data: {
        type: 'datacloud-login-code',
        code: 'code-1',
      },
    });

    await expect(promise).resolves.toBe('code-1');
  });

  it('shows iframe after timeout when not yet resolved', () => {
    const appendSpy = jest.spyOn(document.body, 'appendChild');

    getWhaleSysCode('https://auth.example.com/login', {});
    const modal = appendSpy.mock.calls[0][0] as HTMLDivElement;

    expect(modal.style.display).toBe('none');
    jest.advanceTimersByTime(2000);
    expect(modal.style.display).toBe('flex');
  });

  it('rejects when iframe loading fails', async () => {
    const createElementSpy = jest.spyOn(document, 'createElement');
    let iframe: any;
    createElementSpy.mockImplementation(((tag: string) => {
      const el = document.createElementNS('http://www.w3.org/1999/xhtml', tag);
      if (tag === 'iframe') {
        iframe = el;
      }
      return el;
    }) as any);

    const promise = getWhaleSysCode('https://auth.example.com/login', { displayIframe: true });
    iframe.onerror?.();

    await expect(promise).rejects.toThrow('Failed to load sso auth url');
  });
});
