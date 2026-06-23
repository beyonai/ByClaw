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
}));

import { getMessages, getMessageState } from '@/service/message';
import messageStoreModel, { fetchMessage } from '../useMessageStore';

const mockGetMessages = getMessages as jest.MockedFunction<typeof getMessages>;
const mockGetMessageState = getMessageState as jest.MockedFunction<typeof getMessageState>;

describe('models/useMessageStore', () => {
  const reducers = (messageStoreModel as any).reducers;

  beforeEach(() => {
    jest.clearAllMocks();
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
