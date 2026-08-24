jest.mock('@/service/message', () => ({
  getMessages: jest.fn(),
  getMessageState: jest.fn(),
}));

jest.mock('@/utils/messgae', () => ({
  createMessage: jest.fn((value: any) => ({ ...value, created: true })),
  fetchMessageHandler: jest.fn((value: any) => ({
    ...value,
    transformed: true,
    resComIds: value.resComIds ? JSON.parse(value.resComIds) : undefined,
  })),
  hasVisibleMessageContent: jest.fn(() => true),
}));

import { getMessages, getMessageState } from '@/service/message';
import { hasVisibleMessageContent } from '@/utils/messgae';
import messageStoreModel, { fetchMessage } from '../useMessageStore';

const mockGetMessages = getMessages as jest.MockedFunction<typeof getMessages>;
const mockGetMessageState = getMessageState as jest.MockedFunction<typeof getMessageState>;
const mockHasVisibleMessageContent = hasVisibleMessageContent as jest.MockedFunction<typeof hasVisibleMessageContent>;

describe('models/useMessageStore', () => {
  const reducers = (messageStoreModel as any).reducers;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHasVisibleMessageContent.mockReturnValue(true);
  });

  it('fetchMessage sorts, transforms and marks history messages', async () => {
    mockGetMessages.mockResolvedValue({
      list: [
        { messageId: 2, fromBeyond: false, resComIds: null },
        { messageId: 1, fromBeyond: true, resComIds: JSON.stringify([{ resComId: 'r1' }]) },
      ],
      pageNum: 1,
      pageSize: 20,
      total: 2,
    } as any);
    mockGetMessageState.mockResolvedValue([{ resComId: 'r1', resPage: JSON.stringify({ disabled: true }) }] as any);

    const result = await fetchMessage({ sessionId: 's1' });

    expect(result.pageNum).toBe(1);
    expect(result.list).toHaveLength(2);
    expect(result.list[0].messageId).toBe(1);
    expect(result.list[0].isHistoryMsg).toBe(true);
    expect(result.list[0].resComState).toBe(true);
    expect(result.list[1].isHistoryMsg).toBe(true);
  });

  it('fetchMessage sorts history by createTime before messageId', async () => {
    mockGetMessages.mockResolvedValue({
      list: [
        { messageId: 10007074, createTime: '2026-07-07 14:51:00', fromBeyond: false },
        { messageId: 2666782070, createTime: '2026-07-07 14:45:43', fromBeyond: true },
        { messageId: 10007067, createTime: '2026-07-07 14:45:41', fromBeyond: false },
      ],
      pageNum: 1,
      pageSize: 20,
      total: 3,
    } as any);

    const result = await fetchMessage({ sessionId: 's1' });

    expect(result.list.map((item) => item.messageId)).toEqual([10007067, 2666782070, 10007074]);
  });

  it.each([
    { total: 20, expected: false },
    { total: 21, expected: true },
  ])('fetchMessage combines the raw page size and total to calculate hasMore', async ({ total, expected }) => {
    mockGetMessages.mockResolvedValue({
      list: Array.from({ length: 20 }, (_, index) => ({ messageId: index + 1, text: `message-${index + 1}` })),
      pageNum: 1,
      pageSize: 20,
      total,
    } as any);

    const result = await fetchMessage({ sessionId: 's1' });

    expect(result.hasMore).toBe(expected);
  });

  it('getMoreSessionMessage preserves hasMore calculated from the raw response list', async () => {
    mockHasVisibleMessageContent.mockImplementation((message) => message?.messageId !== 4);
    mockGetMessages.mockResolvedValue({
      list: [
        { messageId: 3, text: 'visible' },
        { messageId: 4, text: '' },
      ],
      pageNum: 2,
      pageSize: 2,
      total: 5,
    } as any);

    const cache = {
      list: [{ messageId: 1 }, { messageId: 2 }],
      pageNum: 1,
      pageSize: 2,
      total: 5,
      pageRange: [1, 1],
      hasMore: true,
    };
    const select = jest.fn(() => new Map([['s1', cache]]));
    const put = jest.fn((action) => action);
    const effect = (messageStoreModel as any).effects.getMoreSessionMessage(
      { payload: { sessionId: 's1' } },
      { put, select }
    );

    effect.next();
    const fetchResult = effect.next(new Map([['s1', cache]])).value;
    const response = await fetchResult;
    const putEffect = effect.next(response).value;

    expect(response.list).toHaveLength(1);
    expect(response.hasMore).toBe(true);
    expect(putEffect.payload.messageListInfo.hasMore).toBe(true);
    effect.next(putEffect);
  });

  it('setSessionMessage stores message info by session id', () => {
    const map = new Map();
    const state = { sessionListMap: map };

    const next = reducers.setSessionMessage(state as any, {
      payload: {
        sessionId: 's1',
        messageListInfo: { list: [], pageNum: 1, pageSize: 20, total: 0, pageRange: [1, 1] },
      },
    });

    expect(next.sessionListMap.get('s1')).toEqual({
      list: [],
      pageNum: 1,
      pageSize: 20,
      total: 0,
      pageRange: [1, 1],
    });
  });

  it('updateSessionMessageList creates or updates cache and adjusts total', () => {
    const map = new Map([['s1', { list: [{ id: 1 }], pageNum: 1, pageSize: 20, total: 1, pageRange: [1, 1] }]]);

    const next = reducers.updateSessionMessageList({ sessionListMap: map } as any, {
      payload: { sessionId: 's1', messageList: [{ id: 1 }, { id: 2 }] },
    });

    expect(next.sessionListMap.get('s1')).toEqual({
      list: [{ id: 1 }, { id: 2 }],
      pageNum: 1,
      pageSize: 20,
      total: 2,
      pageRange: [1, 1],
    });
  });

  it('updateSessionMessageList supports callback updates with latest cache list', () => {
    const map = new Map([['s1', { list: [{ id: 1 }], pageNum: 1, pageSize: 20, total: 1, pageRange: [1, 1] }]]);

    const first = reducers.updateSessionMessageList({ sessionListMap: map } as any, {
      payload: { sessionId: 's1', messageList: (list: any[]) => [...list, { id: 2 }] },
    });
    const second = reducers.updateSessionMessageList(first, {
      payload: { sessionId: 's1', messageList: (list: any[]) => [...list, { id: 3 }] },
    });

    expect(second.sessionListMap.get('s1').list).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(second.sessionListMap.get('s1').total).toBe(3);
  });

  it('setInitialSessionDataToLocateMsg stores target message paging info', () => {
    const map = new Map();
    const next = reducers.setInitialSessionDataToLocateMsg({ sessionListMap: map } as any, {
      payload: { sessionId: 's1', index: 25, total: 100, targetMessageId: 'm1' },
    });

    expect(next.sessionListMap.get('s1')).toMatchObject({
      pageNum: 2,
      pageSize: 20,
      total: 100,
      targetMessageId: 'm1',
      pageRange: [2, 2],
    });
  });

  it('cleanSessionMessage removes session cache', () => {
    const map = new Map([['s1', { list: [] }]]);
    const next = reducers.cleanSessionMessage({ sessionListMap: map } as any, {
      payload: { sessionId: 's1' },
    });

    expect(next.sessionListMap.has('s1')).toBe(false);
  });
});
