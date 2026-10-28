const mockEventEmitter = { emit: jest.fn() };
const mockMessageInfo = jest.fn();
const mockFetch = jest.fn();

jest.mock('antd', () => ({ message: { info: (...args: unknown[]) => mockMessageInfo(...args) } }));
jest.mock('@umijs/max', () => ({ getIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
const mockRefreshSandboxes = jest.fn();
const mockSetSiderCollapsed = jest.fn();
let mockAppState: any;

jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: { getState: () => mockAppState },
}));

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: mockEventEmitter }),
}));

import { act, renderHook } from '@testing-library/react';
import useVncOpener from '../useVncOpener';

const readySandboxes = [
  {
    status: 'RUNNING',
    instanceEndpoints: { vnc: '/v1/sandboxes/test/proxy/8081?token=test-token' },
  },
];

const flush = async () => {
  await act(async () => {});
};

describe('useVncOpener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockFetch.mockResolvedValue({ type: 'basic', status: 200 });
    (globalThis as any).fetch = mockFetch;
    mockRefreshSandboxes.mockResolvedValue([]);
    mockAppState = {
      sandboxesInfo: readySandboxes,
      getSandboxesInfoUrl: mockRefreshSandboxes,
      setSiderCollapsed: mockSetSiderCollapsed,
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens a ready desktop with its endpoint token and proxy slash', async () => {
    const { result } = renderHook(() => useVncOpener('session-a'));
    act(() => result.current({ key: 'answer-a:tool-a' }));
    await flush();

    expect(mockSetSiderCollapsed).toHaveBeenCalledWith(true);
    expect(mockEventEmitter.emit).toHaveBeenNthCalledWith(1, 'beyond-main-driver-open-type', {
      drawerType: 'vnc',
      canClose: true,
      width: '50vw',
    });
    expect(mockEventEmitter.emit).toHaveBeenNthCalledWith(2, 'beyond-main-driver-message', {
      url: `${window.location.origin}/v1/sandboxes/test/proxy/8081/?token=test-token&autoconnect=true&resize=scale`,
    });
    expect(mockEventEmitter.emit).toHaveBeenNthCalledWith(3, 'beyond-chat-vnc-opened', { sessionId: 'session-a' });
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
    expect(mockRefreshSandboxes).not.toHaveBeenCalled();
  });

  it('refreshes an empty cache and opens when the sandbox becomes ready', async () => {
    mockAppState.sandboxesInfo = [];
    mockRefreshSandboxes.mockResolvedValue(readySandboxes);
    const { result } = renderHook(() => useVncOpener('session-a'));
    act(() => result.current());
    await flush();

    expect(mockRefreshSandboxes).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('beyond-chat-vnc-opened', { sessionId: 'session-a' });
  });

  it('retries STARTING sandboxes until there is a usable RUNNING endpoint', async () => {
    mockAppState.sandboxesInfo = [{ status: 'STARTING' }];
    mockRefreshSandboxes.mockResolvedValueOnce([{ status: 'STARTING' }]).mockResolvedValueOnce(readySandboxes);
    const { result } = renderHook(() => useVncOpener('session-a'));
    act(() => result.current({ key: 'tool-a' }));
    await flush();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('beyond-chat-vnc-opened', { sessionId: 'session-a' });
  });

  it('stops retrying missing endpoints without opening an empty iframe', async () => {
    mockAppState.sandboxesInfo = [{ status: 'RUNNING', instanceEndpoints: {} }];
    const { result } = renderHook(() => useVncOpener('session-a'));
    act(() => result.current());
    await flush();
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockRefreshSandboxes.mock.calls.length).toBeGreaterThan(0);
    expect(mockRefreshSandboxes.mock.calls.length).toBeLessThanOrEqual(30);
    expect(jest.getTimerCount()).toBe(0);
    // A click that finds no desktop is told so.
    expect(mockMessageInfo).toHaveBeenCalledWith('common.remoteComputerUnavailable');
  });

  it('waits for the desktop to answer before opening it', async () => {
    // The sandbox proxy answers 502 until the browser's desktop listens in the tool sandbox.
    mockFetch.mockResolvedValueOnce({ type: 'basic', status: 502 }).mockResolvedValueOnce({ type: 'basic', status: 502 })
      .mockResolvedValue({ type: 'opaqueredirect', status: 0 });
    mockRefreshSandboxes.mockResolvedValue(readySandboxes);
    const { result } = renderHook(() => useVncOpener('session-a'));
    act(() => result.current({ key: 'answer-a:tool-a' }));
    await flush();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ credentials: 'include', redirect: 'manual' });
  });

  it('gives up quietly when a tool call never brings up the desktop', async () => {
    mockFetch.mockResolvedValue({ type: 'basic', status: 502 });
    mockRefreshSandboxes.mockResolvedValue(readySandboxes);
    const { result } = renderHook(() => useVncOpener('session-a'));
    act(() => result.current({ key: 'answer-a:tool-a' }));
    await flush();
    await act(async () => {
      await jest.runAllTimersAsync();
    });
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockMessageInfo).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('treats a failed probe as not ready', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ type: 'basic', status: 200 });
    mockRefreshSandboxes.mockResolvedValue(readySandboxes);
    const { result } = renderHook(() => useVncOpener('session-a'));
    act(() => result.current());
    await flush();
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('handles a rejected cache and refresh without an unhandled rejection', async () => {
    mockAppState.sandboxesInfo = Promise.reject(new Error('cache unavailable'));
    mockRefreshSandboxes.mockRejectedValue(new Error('sandbox unavailable'));
    const { result } = renderHook(() => useVncOpener('session-a'));
    act(() => result.current());
    await flush();
    await act(async () => {
      await jest.runAllTimersAsync();
    });
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('coalesces repeated stream frames for the same tool while pending and after opening', async () => {
    let resolveSandboxes: (value: any) => void = () => {};
    mockAppState.sandboxesInfo = new Promise((resolve) => {
      resolveSandboxes = resolve;
    });
    const { result } = renderHook(() => useVncOpener('session-a'));
    act(() => {
      result.current({ key: 'answer-a:tool-a' });
      result.current({ key: 'answer-a:tool-a' });
    });
    await act(async () => resolveSandboxes(readySandboxes));
    act(() => result.current({ key: 'answer-a:tool-a' }));
    await flush();
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('beyond-chat-vnc-opened', { sessionId: 'session-a' });
  });

  it('keeps pending opening and deduplication when only the session ID type changes', async () => {
    let resolveSandboxes: (value: any) => void = () => {};
    mockAppState.sandboxesInfo = new Promise((resolve) => {
      resolveSandboxes = resolve;
    });
    const { result, rerender } = renderHook(({ sessionId }) => useVncOpener(sessionId), {
      initialProps: { sessionId: 11273519 as string | number },
    });
    act(() => result.current({ key: 'answer-a:tool-a' }));
    rerender({ sessionId: '11273519' });
    await act(async () => resolveSandboxes(readySandboxes));

    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('beyond-chat-vnc-opened', { sessionId: '11273519' });

    rerender({ sessionId: 11273519 });
    act(() => result.current({ key: 'answer-a:tool-a' }));
    await flush();
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
  });

  it('allows a manual reopen after the desktop was closed', async () => {
    const { result } = renderHook(() => useVncOpener('session-a'));
    act(() => result.current());
    await flush();
    act(() => result.current());
    await flush();
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(6);
    expect(mockEventEmitter.emit.mock.calls.filter(([event]) => event === 'beyond-chat-vnc-opened')).toEqual([
      ['beyond-chat-vnc-opened', { sessionId: 'session-a' }],
      ['beyond-chat-vnc-opened', { sessionId: 'session-a' }],
    ]);
  });

  it.each(['session-b', 'session-a'])('discards an old request after switching away and to %s', async (target) => {
    let resolveSandboxes: (value: any) => void = () => {};
    mockAppState.sandboxesInfo = new Promise((resolve) => {
      resolveSandboxes = resolve;
    });
    const { result, rerender } = renderHook(({ sessionId }) => useVncOpener(sessionId), {
      initialProps: { sessionId: 'session-a' },
    });
    act(() => result.current());
    rerender({ sessionId: 'session-b' });
    if (target === 'session-a') rerender({ sessionId: 'session-a' });
    await act(async () => resolveSandboxes(readySandboxes));
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('discards a click when its latest employee message is no longer relevant', async () => {
    let resolveSandboxes: (value: any) => void = () => {};
    let isLatest = true;
    mockAppState.sandboxesInfo = new Promise((resolve) => {
      resolveSandboxes = resolve;
    });
    const { result } = renderHook(() => useVncOpener('session-a'));
    act(() => result.current({ isCurrent: () => isLatest }));
    isLatest = false;
    await act(async () => resolveSandboxes(readySandboxes));
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('reports only the current session when an earlier session request resolves later', async () => {
    let resolveOldSandboxes: (value: any) => void = () => {};
    mockAppState.sandboxesInfo = new Promise((resolve) => {
      resolveOldSandboxes = resolve;
    });
    const { result, rerender } = renderHook(({ sessionId }) => useVncOpener(sessionId), {
      initialProps: { sessionId: 'session-a' },
    });
    act(() => result.current());
    rerender({ sessionId: 'session-b' });
    mockAppState.sandboxesInfo = readySandboxes;
    act(() => result.current());
    await flush();

    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
    expect(mockEventEmitter.emit).toHaveBeenNthCalledWith(3, 'beyond-chat-vnc-opened', { sessionId: 'session-b' });

    await act(async () => resolveOldSandboxes(readySandboxes));
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith('beyond-chat-vnc-opened', { sessionId: 'session-a' });
  });

  it('cancels delayed retries on unmount', async () => {
    mockAppState.sandboxesInfo = [];
    const { result, unmount } = renderHook(() => useVncOpener('session-a'));
    act(() => result.current());
    await flush();
    const callsBeforeUnmount = mockRefreshSandboxes.mock.calls.length;
    unmount();
    await act(async () => {
      await jest.runAllTimersAsync();
    });
    expect(mockRefreshSandboxes).toHaveBeenCalledTimes(callsBeforeUnmount);
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });
});
