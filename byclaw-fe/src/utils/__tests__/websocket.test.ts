const mockGetToken = jest.fn();

jest.mock('../auth', () => ({
  getToken: (...args: any[]) => mockGetToken(...args),
}));

describe('utils/websocket', () => {
  let socketInstance: any;
  let WebSocketMock: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
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
      return socketInstance;
    });
    WebSocketMock.OPEN = 1;
    (global as any).WebSocket = WebSocketMock;
  });

  afterEach(() => {
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

  it('creates websocket with correct url in development and reports connecting state', () => {
    process.env.NODE_ENV = 'development';
    mockGetToken.mockReturnValue('token-1');
    const ws = require('../websocket').default;

    ws.disconnect();
    ws.init();

    expect(WebSocketMock).toHaveBeenCalledWith('ws://example.com/byaiService/ws?beyond-token=token-1');
    expect(ws.getConnectionStatus()).toBe('connected');
  });

  it('starts heartbeat on open and sends notification messages', () => {
    mockGetToken.mockReturnValue('token-1');
    const ws = require('../websocket').default;

    ws.disconnect();
    ws.init();
    socketInstance.onopen();

    jest.advanceTimersByTime(6000);
    expect(socketInstance.send).toHaveBeenCalledWith(JSON.stringify({ type: 'NOTIFICATION' }));
  });

  it('dispatches incoming messages to callbacks and registered handlers', () => {
    mockGetToken.mockReturnValue('token-1');
    const ws = require('../websocket').default;
    const onNotificationChange = jest.fn();
    const onAddNotificationSessionCb = jest.fn();
    const handler = jest.fn();

    ws.setOnNotificationChange(onNotificationChange);
    ws.setOnAddNotificationSessionCb(onAddNotificationSessionCb);
    ws.onMessage('CUSTOM', handler);

    ws.disconnect();
    ws.init();

    socketInstance.onmessage({
      data: JSON.stringify({
        type: 'CUSTOM',
        session: { sessionId: '1' },
      }),
    });

    expect(onNotificationChange).toHaveBeenCalledWith(true);
    expect(onAddNotificationSessionCb).toHaveBeenCalledWith({ sessionId: '1' });
    expect(handler).toHaveBeenCalledWith({ type: 'CUSTOM', session: { sessionId: '1' } });
    expect(ws.getHasNotification()).toBe(true);
  });

  it('clears notification state and disconnect tears down timers and socket', () => {
    mockGetToken.mockReturnValue('token-1');
    const ws = require('../websocket').default;

    ws.disconnect();
    ws.init();
    socketInstance.onopen();

    ws.clearNotification();
    expect(ws.getHasNotification()).toBe(false);

    ws.disconnect();
    expect(socketInstance.close).toHaveBeenCalled();
    expect(ws.getConnectionStatus()).toBe('disconnected');
  });
});
