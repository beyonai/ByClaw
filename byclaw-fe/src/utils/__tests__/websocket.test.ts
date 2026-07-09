const mockGetToken = jest.fn();
const mockClearToken = jest.fn();
const mockLoginRedirect = jest.fn();
const mockGetLocale = jest.fn();

jest.mock('../auth', () => ({
  getToken: (...args: any[]) => mockGetToken(...args),
  clearToken: (...args: any[]) => mockClearToken(...args),
  loginRedirect: (...args: any[]) => mockLoginRedirect(...args),
}));

jest.mock('@umijs/max', () => ({
  getLocale: (...args: any[]) => mockGetLocale(...args),
}));

const createJwt = (payload: Record<string, unknown>) => {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`;
};

describe('utils/websocket', () => {
  let socketInstance: any;
  let socketInstances: any[];
  let WebSocketMock: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetLocale.mockReturnValue('zh-CN');
    const previousManager = (globalThis as any).__BYCLAW_WEBSOCKET_MANAGER__;
    previousManager?.dispose?.();
    delete (globalThis as any).__BYCLAW_WEBSOCKET_MANAGER__;
    socketInstances = [];
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    Object.defineProperty(window, 'location', {
      value: {
        href: 'https://example.com/chat?x=1',
      },
      writable: true,
      configurable: true,
    });

    WebSocketMock = jest.fn().mockImplementation((url: string) => {
      socketInstance = {
        url,
        readyState: 1,
        send: jest.fn(),
        close: jest.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
      socketInstances.push(socketInstance);
      return socketInstance;
    });
    WebSocketMock.OPEN = 1;
    (global as any).WebSocket = WebSocketMock;
  });

  afterEach(() => {
    const manager = (globalThis as any).__BYCLAW_WEBSOCKET_MANAGER__;
    manager?.dispose?.();
    delete (globalThis as any).__BYCLAW_WEBSOCKET_MANAGER__;
    jest.useRealTimers();
    process.env.NODE_ENV = originalEnv;
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('is a singleton', () => {
    const ws1 = require('../websocket').default;
    const ws2 = require('../websocket').default;
    expect(ws1).toBe(ws2);
  });

  it('does not init when token is missing', () => {
    mockGetToken.mockReturnValue('');
    const ws = require('../websocket').default;

    ws.disconnect();
    ws.init();

    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(WebSocketMock).not.toHaveBeenCalled();
  });

  it('clears token and redirects when websocket token is expired', async () => {
    const expiredToken = createJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
    mockGetToken.mockReturnValue(expiredToken);
    const ws = require('../websocket').default;

    ws.disconnect();
    ws.init();

    expect(WebSocketMock).not.toHaveBeenCalled();
    expect(mockClearToken).toHaveBeenCalled();
    expect(mockLoginRedirect).toHaveBeenCalledWith({ openLoginModal: '1' });
    await expect(ws.waitUntilConnected()).rejects.toThrow('WebSocket token unavailable');
  });

  it('creates websocket with correct url in development and reports connecting state', () => {
    process.env.NODE_ENV = 'development';
    mockGetToken.mockReturnValue('token-1');
    const ws = require('../websocket').default;

    ws.disconnect();
    ws.init();

    expect(WebSocketMock).toHaveBeenCalledWith('ws://example.com/byaiService/ws?beyond-token=token-1&language=zh-CN');
    expect(ws.getConnectionStatus()).toBe('connected');
  });

  it('recreates websocket when stored token changes after login', () => {
    process.env.NODE_ENV = 'development';
    mockGetToken.mockReturnValue('token-1');
    const ws = require('../websocket').default;

    ws.disconnect();
    ws.init();
    const oldSocket = socketInstance;

    mockGetToken.mockReturnValue('token-2');
    ws.init();

    expect(oldSocket.close).toHaveBeenCalled();
    expect(WebSocketMock).toHaveBeenLastCalledWith(
      'ws://example.com/byaiService/ws?beyond-token=token-2&language=zh-CN'
    );
  });

  it('starts heartbeat on open and sends notification messages', () => {
    mockGetToken.mockReturnValue('token-1');
    const ws = require('../websocket').default;

    ws.disconnect();
    ws.init();
    socketInstance.onopen();

    jest.advanceTimersByTime(6000);
    expect(socketInstance.send).toHaveBeenCalledWith(JSON.stringify({ language: 'zh-CN', type: 'NOTIFICATION' }));
  });

  it('adds current language to outgoing messages unless explicitly provided', () => {
    mockGetToken.mockReturnValue('token-1');
    const ws = require('../websocket').default;

    ws.disconnect();
    ws.init();
    socketInstance.onopen();

    ws.sendMessage({ type: 'LLM_MESSAGE', chatContent: 'hello' });
    ws.sendMessage({ type: 'LLM_MESSAGE', language: 'en-US', chatContent: 'hello' });

    expect(socketInstance.send).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({ language: 'zh-CN', type: 'LLM_MESSAGE', chatContent: 'hello' })
    );
    expect(socketInstance.send).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({ language: 'en-US', type: 'LLM_MESSAGE', chatContent: 'hello' })
    );
  });

  it('dispatches incoming messages to registered handlers', () => {
    mockGetToken.mockReturnValue('token-1');
    const ws = require('../websocket').default;
    const handler = jest.fn();

    ws.onMessage('NOTIFICATION', handler);

    ws.disconnect();
    ws.init();

    socketInstance.onmessage({
      data: JSON.stringify({
        type: 'NOTIFICATION',
        session: { sessionId: '1' },
      }),
    });

    expect(handler).toHaveBeenCalledWith({ type: 'NOTIFICATION', session: { sessionId: '1' } });
  });

  it('disconnect tears down timers and socket', () => {
    mockGetToken.mockReturnValue('token-1');
    const ws = require('../websocket').default;

    ws.disconnect();
    ws.init();
    socketInstance.onopen();

    ws.disconnect();
    expect(socketInstance.close).toHaveBeenCalled();
    expect(ws.getConnectionStatus()).toBe('disconnected');
  });

  it('ignores stale socket events after a newer connection is created', () => {
    mockGetToken.mockReturnValue('token-1');
    const ws = require('../websocket').default;
    const handler = jest.fn();

    ws.onMessage('NOTIFICATION', handler);

    ws.disconnect();
    ws.init();
    const staleSocket = socketInstances[0];

    ws.disconnect();
    ws.init();
    const currentSocket = socketInstances[1];

    staleSocket.onmessage({
      data: JSON.stringify({
        type: 'NOTIFICATION',
        session: { sessionId: 'stale' },
      }),
    });
    staleSocket.onclose({ code: 1000, reason: 'stale close' });

    expect(handler).not.toHaveBeenCalled();
    expect(ws.getConnectionStatus()).toBe('connected');
    expect(currentSocket.close).not.toHaveBeenCalled();
  });
});
