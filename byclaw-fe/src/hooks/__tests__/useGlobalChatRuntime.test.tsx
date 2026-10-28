import { resetMultiTenancyConfig, setMultiTenancyConfig } from '@/utils/multiTenancy';
jest.mock('@umijs/max', () => ({
  useDispatch: jest.fn(),
  useSelector: jest.fn(),
}));

jest.mock('@/hooks/useSseSender/chatStream', () => ({
  subscribeChatStream: jest.fn(() => jest.fn()),
}));

jest.mock('@/utils/websocket', () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    disconnect: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

import { act, renderHook } from '@testing-library/react';
import { useDispatch, useSelector } from '@umijs/max';

import { subscribeChatStream } from '@/hooks/useSseSender/chatStream';
import webSocketManager from '@/utils/websocket';
import { chatSessionRuntimeManager } from '@/utils/chatSessionRuntimeManager';

import useGlobalChatRuntime from '../useGlobalChatRuntime';

const mockUseDispatch = useDispatch as jest.Mock;
const mockUseSelector = useSelector as jest.Mock;
const mockSubscribeChatStream = subscribeChatStream as jest.Mock;
const mockWebSocketManager = webSocketManager as unknown as Record<string, jest.Mock>;

describe('hooks/useGlobalChatRuntime', () => {
  let dispatch: jest.Mock;
  let state: any;

  beforeEach(() => {
    setMultiTenancyConfig(null);
    jest.clearAllMocks();
    chatSessionRuntimeManager.clear();
    jest.useFakeTimers();
    dispatch = jest.fn();
    state = {
      user: {
        userInfo: {
          userId: 'u1',
        },
      },
      session: {
        sessionList: [{ sessionId: 's1' }],
      },
    };
    mockUseDispatch.mockReturnValue(dispatch);
    mockUseSelector.mockImplementation((selector: any) => selector(state));
  });

  it('waits for system config before connecting and rebuilds the connection when the switch changes', () => {
    resetMultiTenancyConfig();
    renderHook(() => useGlobalChatRuntime());
    expect(mockWebSocketManager.init).not.toHaveBeenCalled();
    expect(mockSubscribeChatStream).not.toHaveBeenCalled();
    act(() => setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' }));
    expect(mockWebSocketManager.init).toHaveBeenCalledTimes(1);
    act(() => setMultiTenancyConfig(null));
    expect(mockWebSocketManager.disconnect).toHaveBeenCalled();
    expect(mockWebSocketManager.init).toHaveBeenCalledTimes(2);
  });

  it('updates a session title after the chat turn has completed', () => {
    const { unmount } = renderHook(() => useGlobalChatRuntime());
    const handler = mockWebSocketManager.onMessage.mock.calls.find(([type]) => type === 'SESSION_EVENT')?.[1];
    expect(handler).toEqual(expect.any(Function));
    act(() => {
      handler({
        event: 'sessionTitleUpdated',
        sessionId: '9007199254740993',
        data: JSON.stringify({ sessionName: 'Generated title', updateTime: 123 }),
      });
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'session/updateSession',
      payload: { sessionId: '9007199254740993', sessionName: 'Generated title', updateTime: 123 },
    });
    unmount();
    expect(mockWebSocketManager.offMessage).toHaveBeenCalledWith('SESSION_EVENT', handler);
  });

  it('keeps a manual rename when an older generated title arrives late', () => {
    state.session.sessionList = [{ sessionId: 's1', sessionName: 'My manual title' }];
    renderHook(() => useGlobalChatRuntime());
    const handler = mockWebSocketManager.onMessage.mock.calls.find(([type]) => type === 'SESSION_EVENT')![1];
    act(() => {
      handler({
        event: 'sessionTitleUpdated',
        sessionId: 's1',
        data: { sessionName: 'Generated title', previousSessionName: 'Local title' },
      });
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores malformed title events and unrelated session events', () => {
    renderHook(() => useGlobalChatRuntime());
    const handler = mockWebSocketManager.onMessage.mock.calls.find(([type]) => type === 'SESSION_EVENT')![1];
    act(() => {
      handler({ event: 'sessionTitleUpdated', sessionId: 's1', data: '{' });
      handler({ event: 'sessionTitleUpdated', sessionId: 's1', data: { sessionName: ' ' } });
      handler({ event: 'initialization', sessionId: 's1', data: { sessionName: 'Ignore me' } });
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('applies generic session runtime messages from websocket', () => {
    renderHook(() => useGlobalChatRuntime());

    const onSessionRuntime = mockWebSocketManager.onMessage.mock.calls.find(
      ([type]) => type === 'SESSION_RUNTIME_STATUS'
    )![1];
    act(() => {
      onSessionRuntime({
        type: 'SESSION_RUNTIME_STATUS',
        sessionId: 's1',
        traceId: 'trace-1',
        data: {
          sessionId: 's1',
          traceId: 'trace-1',
          source: 'integration-a',
          status: 'running',
          activeAgentCount: 2,
          activeChildCount: 1,
          waitingInteractionCount: 0,
          rootActive: false,
          acceptingInput: true,
          revision: 1,
          changedAt: 1000,
        },
      });
    });

    expect(chatSessionRuntimeManager.isSessionRunning('s1')).toBe(true);
    expect(chatSessionRuntimeManager.getSessionRuntime('s1')?.activeAgentCount).toBe(2);
    expect(chatSessionRuntimeManager.canAcceptInput('s1')).toBe(true);
  });

  it('uses exact envelope IDs when legacy runtime payload IDs were rounded', () => {
    renderHook(() => useGlobalChatRuntime());

    const onSessionRuntime = mockWebSocketManager.onMessage.mock.calls.find(
      ([type]) => type === 'SESSION_RUNTIME_STATUS'
    )![1];
    act(() => {
      onSessionRuntime({
        type: 'SESSION_RUNTIME_STATUS',
        sessionId: '8011237409000004638',
        traceId: 'trace-1',
        data: {
          sessionId: 8011237409000004638,
          traceId: 'trace-1',
          source: 'integration-a',
          status: 'running',
          activeAgentCount: 2,
          activeChildCount: 1,
          waitingInteractionCount: 0,
          rootActive: false,
          acceptingInput: true,
          revision: 1,
          changedAt: 1000,
        },
      });
    });

    expect(chatSessionRuntimeManager.isSessionRunning('8011237409000004638')).toBe(true);
    expect(chatSessionRuntimeManager.getSessionRuntime('8011237409000004638')?.activeAgentCount).toBe(2);
    expect(chatSessionRuntimeManager.canAcceptInput('8011237409000004638')).toBe(true);
    act(() =>
      onSessionRuntime({
        sessionId: '8011237409000004638',
        data: {
          sessionId: 8011237409000004638,
          traceId: 'trace-1',
          source: 'integration-a',
          status: 'idle',
          active: false,
          rootActive: false,
          activeAgentCount: 0,
          activeChildCount: 0,
          waitingInteractionCount: 0,
          acceptingInput: true,
          revision: 2,
          changedAt: 1001,
        },
      })
    );
    expect(chatSessionRuntimeManager.isSessionRunning('8011237409000004638')).toBe(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initializes websocket stream handling after login', () => {
    renderHook(() => useGlobalChatRuntime());

    expect(mockWebSocketManager.init).toHaveBeenCalled();
    expect(mockSubscribeChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        match: expect.any(Function),
        onPayload: expect.any(Function),
      })
    );
    expect(mockWebSocketManager.onMessage).toHaveBeenCalledWith('ERROR', expect.any(Function));
    expect(mockWebSocketManager.onMessage).toHaveBeenCalledWith('NOTIFICATION', expect.any(Function));
    expect(mockWebSocketManager.onMessage).toHaveBeenCalledWith('TASK_PLAN_SNAPSHOT', expect.any(Function));
  });

  it('stores task plan snapshots from websocket messages', () => {
    renderHook(() => useGlobalChatRuntime());

    const onTaskPlan = mockWebSocketManager.onMessage.mock.calls.find(([type]) => type === 'TASK_PLAN_SNAPSHOT')![1];
    const taskPlan = {
      planId: 'plan-1',
      version: 1,
      title: 'Plan',
      status: 'ACTIVE',
      sessionId: 's1',
      messageId: 'm1',
      tasks: [],
    };

    act(() => {
      onTaskPlan({ type: 'TASK_PLAN_SNAPSHOT', sessionId: 's1', messageId: 'm1', data: taskPlan });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'messageStore/applyTaskPlanSnapshot',
      payload: { sessionId: 's1', messageId: 'm1', taskPlan },
    });
  });

  it('dispatches notification sessions only for the current user', () => {
    renderHook(() => useGlobalChatRuntime());

    const onNotification = mockWebSocketManager.onMessage.mock.calls.find(([type]) => type === 'NOTIFICATION')![1];

    act(() => {
      onNotification({ type: 'NOTIFICATION', session: { sessionId: 's1', creatorId: 'u1' } });
      onNotification({ type: 'NOTIFICATION', session: { sessionId: 's2', creatorId: 'u2' } });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'session/updateUnreadInfo',
      payload: { totalUnread: 1 },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'session/addNotificationSession',
      payload: { sessionId: 's1', creatorId: 'u1' },
    });
    expect(dispatch).not.toHaveBeenCalledWith({
      type: 'session/addNotificationSession',
      payload: { sessionId: 's2', creatorId: 'u2' },
    });
  });

  it('disconnects and clears callbacks when logged out', () => {
    const { rerender } = renderHook(() => useGlobalChatRuntime());

    state = {
      user: {
        userInfo: undefined,
      },
      session: {
        sessionList: [],
      },
    };
    rerender();

    expect(mockWebSocketManager.disconnect).toHaveBeenCalled();
  });
});
