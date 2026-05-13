jest.mock('@/service/session', () => ({
  batchReadMessages: jest.fn(),
}));

jest.mock('@/service/layout', () => ({
  getSearchList: jest.fn(),
  qryConversations: jest.fn(),
  removeConversation: jest.fn(),
  updateConversation: jest.fn(),
}));

jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfigListByStandType: jest.fn(),
}));

jest.mock('@/utils/session', () => ({
  addSessionHandler: jest.fn((state: any, session: any) => ({
    ...state,
    added: session,
  })),
  updateSessionHandler: jest.fn((state: any, session: any) => ({
    ...state,
    updated: session,
  })),
  formatByUpdateTime: jest.fn((list: any[]) => list),
  sessionHandler: jest.fn((item: any) => item),
}));

import { batchReadMessages } from '@/service/session';
import { IMessageState } from '@/constants/message';
import sessionModel from '../session';

describe('models/session', () => {
  const reducers = (sessionModel as any).reducers;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updateState and save merge payload into state', () => {
    const state = { sessionLoading: false, unreadInfo: { totalUnread: 0 } };
    expect(reducers.updateState(state as any, { payload: { sessionLoading: true } })).toEqual({
      sessionLoading: true,
      unreadInfo: { totalUnread: 0 },
    });
    expect(reducers.save(state as any, { payload: { hasNotification: true } })).toEqual({
      sessionLoading: false,
      unreadInfo: { totalUnread: 0 },
      hasNotification: true,
    });
  });

  it('updateUnreadInfo merges unread counters', () => {
    const state = { unreadInfo: { totalUnread: 1, mention: 2 } };
    expect(reducers.updateUnreadInfo(state as any, { payload: { totalUnread: 5 } })).toEqual({
      unreadInfo: { totalUnread: 5, mention: 2 },
    });
  });

  it('saveExtParamsBySessionId replaces or merges ext params by session id', () => {
    const state = { extParamsBySessionId: { s1: { a: 1 } } };

    const replaced = reducers.saveExtParamsBySessionId(state as any, {
      payload: { sessionId: 's1', extParams: { b: 2 } },
    });
    expect(replaced.extParamsBySessionId.s1).toEqual({ b: 2 });

    const merged = reducers.saveExtParamsBySessionId(state as any, {
      payload: { sessionId: 's1', extParams: { b: 2 }, opt: { isMerge: true } },
    });
    expect(merged.extParamsBySessionId.s1).toEqual({ a: 1, b: 2 });
  });

  it('addNotificationSession delegates to updateSessionHandler when session exists', () => {
    const state = {
      sessionList: [{ sessionId: 's1', unreadCount: 0 }],
    };

    const next = reducers.addNotificationSession(state as any, { payload: { sessionId: 's1', title: 'new' } });
    expect(next.updated).toEqual({
      sessionId: 's1',
      unreadCount: 1,
      title: 'new',
    });
  });

  it('myBatchReadMessages clears unread count and triggers batchReadMessages', () => {
    const state = {
      sessionList: [{ sessionId: 's1', unreadCount: 2, mentionCount: 1 }],
    };

    const next = reducers.myBatchReadMessages(state as any, {
      payload: { sessionId: 's1', messageIds: ['m1'] },
    });

    expect(next.updated).toEqual({
      sessionId: 's1',
      unreadCount: 0,
      mentionCount: 0,
    });
    expect(batchReadMessages).toHaveBeenCalledWith({
      sessionId: 's1',
      messageIds: ['m1'],
    });
  });

  it('updateSessionContent updates session content from last done text message', () => {
    const state = {
      sessionList: [{ sessionId: 's1', sessionContent: 'old' }],
    };

    const next = reducers.updateSessionContent(state as any, {
      payload: {
        sessionId: 's1',
        messageList: [
          { messageState: IMessageState.Query, text: 'ignore' },
          { messageState: IMessageState.Done, text: 'hello', createTime: '100' },
        ],
      },
    });

    expect(next.updated).toEqual({
      sessionId: 's1',
      sessionContent: 'hello',
      updateTime: '100',
    });
  });
});
