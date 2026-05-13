jest.mock('@umijs/max', () => ({
  useDispatch: jest.fn(),
  useSelector: jest.fn(),
}));

jest.mock('@/service/message', () => ({
  delMessage: jest.fn(),
}));

jest.mock('@/utils/messgae', () => ({
  getMsgId: jest.fn(() => 'new-msg-id'),
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
import useMessage from '../useChat/useMessage';

const mockUseDispatch = useDispatch as jest.Mock;
const mockUseSelector = useSelector as jest.Mock;
const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;
const mockGetSessionObjectTypeMap = getSessionObjectTypeMap as jest.MockedFunction<typeof getSessionObjectTypeMap>;

describe('hooks/useChat/useMessage', () => {
  let dispatch: jest.Mock;
  let eventEmitter: { on: jest.Mock; off: jest.Mock; emit: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    eventEmitter = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    };
    dispatch = jest.fn((action: any) => {
      if (action.type === 'messageStore/getSessionMessage') {
        return Promise.resolve({
          list: [
            { msgId: 'm1', messageId: 'm1', fromBeyond: true, metadata: '{"a":1}' },
            { msgId: 'm2', messageId: 'm2', fromBeyond: false },
          ],
          pageSize: 20,
          targetMessageId: 'm2',
        });
      }
      if (action.type === 'messageStore/getMoreSessionMessage') {
        return Promise.resolve({
          list: [{ msgId: 'm3', messageId: 'm3' }],
          hasMore: true,
        });
      }
      if (action.type === 'messageStore/getLatestSessionMessage') {
        return Promise.resolve({
          list: [{ msgId: 'm4', messageId: 'm4' }],
          pageSize: 20,
        });
      }
      return Promise.resolve(undefined);
    });
    mockUseDispatch.mockReturnValue(dispatch);
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        messageStore: {
          sessionListMap: new Map([
            [
              's2',
              {
                list: [{ msgId: 'm1', text: 'old' }],
              },
            ],
          ]),
        },
      })
    );
    mockUseGlobal.mockReturnValue({
      EventEmitter: eventEmitter,
    } as any);
    mockGetSessionObjectTypeMap.mockReturnValue(undefined as any);
    (globalThis as any).requestIdleCallback = (cb: Function) => {
      cb();
      return 1;
    };
  });

  it('loads session messages on session change and emits metadata/scroll events', async () => {
    const { result } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
    });

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
    expect(eventEmitter.emit).toHaveBeenCalledWith('RECEIVE_SESSION_RECORDS_LAST_METADATA', '{"a":1}');
    expect(eventEmitter.emit).toHaveBeenCalledWith('scrollToMsgOnSessionChanged', {
      sessionId: 's1',
      targetMessageId: 'm2',
    });
  });

  it('updateMessage merges current session messages and adds updateKey', async () => {
    const { result } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.updateMessage({ msgId: 'm1', text: 'updated' } as any);
    });

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

    expect(dispatch).toHaveBeenCalledWith({
      type: 'messageStore/updateSessionMessageList',
      payload: {
        sessionId: 's2',
        messageList: [{ msgId: 'm1', sessionId: 's2', text: 'updated' }],
      },
    });
  });

  it('deleteMessage removes local message and calls delMessage for persisted ids', async () => {
    const { result } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.deleteMessage({ msgId: 'm2', messageId: 'm2' } as any);
    });

    expect(result.current.messageList.map((item) => item.msgId)).toEqual(['m1']);
    expect(delMessage).toHaveBeenCalledWith({ messageId: 'm2' });
  });

  it('setSessionId stores current draft message list when there is no active session', async () => {
    const { result } = renderHook(() => useMessage({}));

    act(() => {
      result.current.setMessageList([{ msgId: 'draft-1' } as any]);
      result.current.setSessionId('new-session');
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'messageStore/updateSessionMessageList',
      payload: {
        sessionId: 'new-session',
        messageList: [{ msgId: 'draft-1' }],
      },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'chatBI/clearTempFileList',
      payload: {
        sessionId: 'new-session',
      },
    });
  });

  it('getMoreSessionMessage updates list and hasMore on forward paging', async () => {
    const { result } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
      await result.current.getMoreSessionMessage('s1');
    });

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
    const { result } = renderHook(({ sessionId }) => useMessage({ sessionId }), {
      initialProps: { sessionId: 's1' },
    });

    await act(async () => {
      await Promise.resolve();
      await result.current.reloadLatestMessageList();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'messageStore/getLatestSessionMessage',
      payload: {
        sessionId: 's1',
      },
    });
    expect(result.current.messageList).toEqual([{ msgId: 'm4', messageId: 'm4' }]);
  });
});
