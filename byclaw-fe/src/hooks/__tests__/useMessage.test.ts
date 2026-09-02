jest.mock('@umijs/max', () => ({
  useDispatch: jest.fn(),
  useSelector: jest.fn(),
}));

jest.mock('@/service/message', () => ({
  delMessage: jest.fn(),
}));

jest.mock('@/utils/messgae', () => ({
  getMsgId: jest.fn(() => 'new-msg-id'),
  hasVisibleMessageContent: jest.fn((message: any) =>
    Boolean(message?.text || message?.messageList?.length || message?.messageTip)
  ),
}));

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@/utils/session', () => ({
  getSessionObjectTypeMap: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import { useDispatch, useSelector } from '@umijs/max';
import { delMessage } from '@/service/message';
import useGlobal from '../useGlobal';
import { getSessionObjectTypeMap } from '@/utils/session';
import { IMessageState } from '@/constants/message';
import useMessage from '../useChat/useMessage';

const mockUseDispatch = useDispatch as jest.Mock;
const mockUseSelector = useSelector as jest.Mock;
const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;
const mockGetSessionObjectTypeMap = getSessionObjectTypeMap as jest.MockedFunction<typeof getSessionObjectTypeMap>;

describe('hooks/useChat/useMessage', () => {
  let dispatch: jest.Mock;
  let eventEmitter: { on: jest.Mock; off: jest.Mock; emit: jest.Mock };
  let sessionListMap: Map<string, any>;

  beforeEach(() => {
    jest.clearAllMocks();
    eventEmitter = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    };
    sessionListMap = new Map([
      [
        's2',
        {
          list: [{ msgId: 'm1', text: 'old' }],
          pageNum: 1,
          pageSize: 20,
          total: 1,
          pageRange: [1, 1],
        },
      ],
    ]);
    dispatch = jest.fn((action: any) => {
      if (action.type === 'messageStore/updateSessionMessageList') {
        const { sessionId, messageList, allowCreateSession } = action.payload;
        const prevInfo = sessionListMap.get(sessionId);
        const nextList = typeof messageList === 'function' ? messageList(prevInfo?.list || []) : messageList;
        if (prevInfo || allowCreateSession || sessionId === '__message_store_draft_session__') {
          sessionListMap.set(sessionId, {
            ...(prevInfo || {
              pageNum: 1,
              pageSize: 20,
              total: nextList.length,
              pageRange: [1, 1],
            }),
            list: nextList,
          });
        }
        return Promise.resolve(undefined);
      }
      if (action.type === 'messageStore/copyFromSession') {
        const { fromSessionId, targetSessionId } = action.payload;
        const messageInfo = sessionListMap.get(fromSessionId);
        if (messageInfo) {
          sessionListMap.set(targetSessionId, messageInfo);
        }
        return Promise.resolve(undefined);
      }
      if (action.type === 'messageStore/cleanSessionMessage') {
        sessionListMap.delete(action.payload.sessionId);
        return Promise.resolve(undefined);
      }
      if (action.type === 'messageStore/getSessionMessage') {
        const info = {
          list: [
            { msgId: 'm1', messageId: 'm1', fromBeyond: true, metadata: '{"a":1}' },
            { msgId: 'm2', messageId: 'm2', fromBeyond: false },
          ],
          pageSize: 20,
          targetMessageId: 'm2',
          pageNum: 1,
          total: 2,
          pageRange: [1, 1],
        };
        sessionListMap.set(action.payload.sessionId, info);
        return Promise.resolve(info);
      }
      if (action.type === 'messageStore/getMoreSessionMessage') {
        const info = {
          list: [{ msgId: 'm3', messageId: 'm3' }],
          hasMore: true,
          pageNum: 2,
          pageSize: 20,
          total: 21,
          pageRange: [1, 2],
        };
        sessionListMap.set(action.payload.sessionId, info);
        return Promise.resolve(info);
      }
      if (action.type === 'messageStore/getLatestSessionMessage') {
        const info = {
          list: [{ msgId: 'm4', messageId: 'm4' }],
          pageSize: 20,
          pageNum: 1,
          total: 1,
          pageRange: [1, 1],
        };
        sessionListMap.set(action.payload.sessionId, info);
        return Promise.resolve(info);
      }
      return Promise.resolve(undefined);
    });
    mockUseDispatch.mockReturnValue(dispatch);
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        messageStore: {
          sessionListMap,
        },
      })
    );
    mockUseGlobal.mockReturnValue({
      EventEmitter: eventEmitter,
    } as any);
    mockGetSessionObjectTypeMap.mockReturnValue(undefined as any);
    (globalThis as any).requestIdleCallback = (cb: () => void) => {
      cb();
      return 1;
    };
  });

  it('loads session messages on session change and emits metadata/scroll events', async () => {
    const { result, rerender } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
    });
    rerender({ sessionId: 's1' });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'messageStore/getSessionMessage',
      payload: { sessionId: 's1' },
    });
    expect(result.current.messageList).toHaveLength(2);
    expect(result.current.hasMore).toBe(false);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'session/myBatchReadMessages',
      payload: {
        sessionId: 's1',
        messageIds: ['m1', 'm2'],
      },
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith('RECEIVE_SESSION_RECORDS_LAST_METADATA', {
      sessionId: 's1',
      metadata: '{"a":1}',
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith('scrollToMsgOnSessionChanged', {
      sessionId: 's1',
      targetMessageId: 'm2',
    });
  });

  it('exposes a deduplicated loading state until the target session messages are ready', async () => {
    let resolveLoad!: (value: any) => void;
    const loadPromise = new Promise((resolve) => {
      resolveLoad = resolve;
    });
    dispatch.mockImplementation((action: any) => {
      if (action.type === 'messageStore/getSessionMessage') return loadPromise;
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useMessage({ sessionId: 'child-1' }));

    expect(result.current.getSessionMessageLoadState('child-1')).toBe('loading');
    await act(async () => {
      void result.current.retrySessionMessageLoad('child-1');
      await Promise.resolve();
    });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'messageStore/getSessionMessage')).toHaveLength(1);

    await act(async () => {
      resolveLoad({ list: [], pageNum: 1, pageSize: 20, total: 0, pageRange: [1, 1] });
      await loadPromise;
    });

    expect(result.current.getSessionMessageLoadState('child-1')).toBe('ready');
  });

  it('moves a failed session load to error and allows an explicit retry', async () => {
    let attempts = 0;
    dispatch.mockImplementation((action: any) => {
      if (action.type !== 'messageStore/getSessionMessage') return Promise.resolve(undefined);
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('load failed'));
      return Promise.resolve({ list: [], pageNum: 1, pageSize: 20, total: 0, pageRange: [1, 1] });
    });

    const { result } = renderHook(() => useMessage({ sessionId: 'child-1' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.getSessionMessageLoadState('child-1')).toBe('error');

    await act(async () => {
      await result.current.retrySessionMessageLoad('child-1');
    });
    expect(result.current.getSessionMessageLoadState('child-1')).toBe('ready');
    expect(attempts).toBe(2);
  });

  it('updateMessage merges current session messages and adds updateKey', async () => {
    const { result, rerender } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
    });
    rerender({ sessionId: 's1' });

    act(() => {
      result.current.updateMessage({ msgId: 'm1', text: 'updated' } as any);
    });
    rerender({ sessionId: 's1' });

    expect(result.current.messageList[0]).toMatchObject({
      msgId: 'm1',
      text: 'updated',
      updateKey: 'new-msg-id',
    });
  });

  it('updateMessage updates cached foreign session messages through dispatch', async () => {
    const { result } = renderHook(() => useMessage({}));

    act(() => {
      result.current.updateMessage({ msgId: 'm1', sessionId: 's2', text: 'updated' } as any);
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'messageStore/updateSessionMessageList',
        payload: expect.objectContaining({
          sessionId: 's2',
          allowCreateSession: false,
          messageList: expect.any(Function),
        }),
      })
    );
    expect(sessionListMap.get('s2').list).toEqual([
      { msgId: 'm1', text: 'updated', sessionId: 's2', updateKey: 'new-msg-id' },
    ]);
  });

  it('updateMessage bases consecutive updates on the latest reducer list', async () => {
    const { result, rerender } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
    });
    rerender({ sessionId: 's1' });

    act(() => {
      result.current.updateMessage({ msgId: 'm3', text: 'query', fromBeyond: false } as any);
      result.current.updateMessage({ msgId: 'm4', text: 'answer', fromBeyond: true } as any);
    });
    rerender({ sessionId: 's1' });

    expect(result.current.messageList.map((item) => item.msgId)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('updateMessage removes completed empty answer messages', async () => {
    const { result, rerender } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
    });
    rerender({ sessionId: 's1' });

    act(() => {
      result.current.updateMessage({
        msgId: 'empty-answer',
        fromBeyond: true,
        messageState: IMessageState.Done,
        messageList: [],
      } as any);
    });
    rerender({ sessionId: 's1' });

    expect(result.current.messageList.map((item) => item.msgId)).toEqual(['m1', 'm2']);
  });

  it('deleteMessage removes local message and calls delMessage for persisted ids', async () => {
    const { result, rerender } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
    });
    rerender({ sessionId: 's1' });

    act(() => {
      result.current.deleteMessage({ msgId: 'm2', messageId: 'm2' } as any);
    });
    rerender({ sessionId: 's1' });

    expect(result.current.messageList.map((item) => item.msgId)).toEqual(['m1']);
    expect(delMessage).toHaveBeenCalledWith({ messageId: 'm2' });
  });

  it('setSessionId stores current draft message list when there is no active session', async () => {
    const { result, rerender } = renderHook(() => useMessage({}));

    act(() => {
      result.current.setMessageList([{ msgId: 'draft-1' } as any]);
      result.current.setSessionId('new-session');
    });
    rerender();

    expect(dispatch).toHaveBeenCalledWith({
      type: 'messageStore/copyFromSession',
      payload: {
        fromSessionId: '__message_store_draft_session__',
        targetSessionId: 'new-session',
      },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'chatBI/clearTempFileList',
      payload: {
        sessionId: 'new-session',
      },
    });
    expect(result.current.messageList).toEqual([{ msgId: 'draft-1' }]);
    expect(sessionListMap.get('new-session').list).toEqual([{ msgId: 'draft-1' }]);
    expect(sessionListMap.has('__message_store_draft_session__')).toBe(false);
  });

  it('getMoreSessionMessage updates list and hasMore on forward paging', async () => {
    const { result, rerender } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
      await result.current.getMoreSessionMessage('s1');
    });
    rerender({ sessionId: 's1' });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'messageStore/getMoreSessionMessage',
      payload: {
        isPrev: undefined,
        sessionId: 's1',
      },
    });
    expect(result.current.messageList).toEqual([{ msgId: 'm3', messageId: 'm3' }]);
    expect(result.current.hasMore).toBe(true);
  });

  it('reloadLatestMessageList fetches latest list and updates state', async () => {
    const { result, rerender } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
      await result.current.reloadLatestMessageList();
    });
    rerender({ sessionId: 's1' });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'messageStore/getLatestSessionMessage',
      payload: {
        sessionId: 's1',
      },
    });
    expect(result.current.messageList).toEqual([{ msgId: 'm4', messageId: 'm4' }]);
  });
});
