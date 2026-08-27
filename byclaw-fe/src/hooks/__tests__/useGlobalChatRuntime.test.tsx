jest.mock('@umijs/max', () => ({
  useDispatch: jest.fn(),
  useSelector: jest.fn(),
}));

jest.mock('@/hooks/useSseSender/chatStream', () => ({
  subscribeChatStream: jest.fn(() => jest.fn()),
}));

jest.mock('@/service/message', () => ({
  getChatRunningStatus: jest.fn(() => Promise.resolve([])),
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

import { renderHook, act } from '@testing-library/react';
import { useDispatch, useSelector } from '@umijs/max';

import { subscribeChatStream } from '@/hooks/useSseSender/chatStream';
import { getChatRunningStatus } from '@/service/message';
import webSocketManager from '@/utils/websocket';

import useGlobalChatRuntime from '../useGlobalChatRuntime';

const mockUseDispatch = useDispatch as jest.Mock;
const mockUseSelector = useSelector as jest.Mock;
const mockSubscribeChatStream = subscribeChatStream as jest.Mock;
const mockGetChatRunningStatus = getChatRunningStatus as jest.Mock;
const mockWebSocketManager = webSocketManager as unknown as Record<string, jest.Mock>;

describe('hooks/useGlobalChatRuntime', () => {
  let dispatch: jest.Mock;
  let state: any;

  beforeEach(() => {
    jest.clearAllMocks();
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

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initializes websocket and running status after login', async () => {
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
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetChatRunningStatus).toHaveBeenCalledWith({ sessionIds: ['s1'] });
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
