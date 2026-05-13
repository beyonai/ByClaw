const mockClearToken = jest.fn();
const mockLoginRedirect = jest.fn();

jest.mock('@/utils/auth', () => ({
  clearToken: (...args: any[]) => mockClearToken(...args),
  loginRedirect: (...args: any[]) => mockLoginRedirect(...args),
}));

describe('utils/broadcastChannel', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('initializes BroadcastChannel and handles logout messages', () => {
    const listeners: Record<string, Function> = {};
    const postMessage = jest.fn();
    const close = jest.fn();

    (global as any).BroadcastChannel = jest.fn().mockImplementation(() => ({
      addEventListener: jest.fn((type: string, cb: Function) => {
        listeners[type] = cb;
      }),
      postMessage,
      close,
    }));

    const channel = require('../broadcastChannel').default;
    channel.init();

    listeners.message({ data: { type: 'logout' } });

    expect(mockClearToken).toHaveBeenCalled();
    expect(mockLoginRedirect).toHaveBeenCalled();

    channel.postMessage({ type: 'ping' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'ping' });

    channel.close();
    expect(close).toHaveBeenCalled();
  });

  it('gracefully handles unsupported BroadcastChannel', () => {
    delete (global as any).BroadcastChannel;

    const channel = require('../broadcastChannel').default;
    channel.init();

    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});
