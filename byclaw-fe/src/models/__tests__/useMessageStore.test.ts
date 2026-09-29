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
import messageStoreModel, { fetchMessage, sortMessagesByTimeline } from '../useMessageStore';

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

  it('applyTaskPlanSnapshot updates the matching answer and ignores stale versions', () => {
    const messageInfo = {
      list: [{ messageId: 'm1', fromBeyond: true, taskPlan: { version: 2 } }],
      pageNum: 1,
      pageSize: 20,
      total: 1,
      pageRange: [1, 1],
    };
    const state = { sessionListMap: new Map([['s1', messageInfo]]) };
    const latestPlan = {
      planId: 'plan-1',
      version: 3,
      title: 'Plan',
      status: 'ACTIVE',
      sessionId: 's1',
      messageId: 'm1',
      tasks: [],
    };

    const updated = reducers.applyTaskPlanSnapshot(state as any, {
      payload: { sessionId: 's1', messageId: 'm1', taskPlan: latestPlan },
    });
    const stale = reducers.applyTaskPlanSnapshot(updated, {
      payload: { sessionId: 's1', messageId: 'm1', taskPlan: { ...latestPlan, version: 1 } },
    });

    expect(updated.sessionListMap.get('s1').list[0].taskPlan.version).toBe(3);
    expect(stale).toBe(updated);
  });

  it('accepts a new plan whose version restarts from one', () => {
    const state = {
      sessionListMap: new Map([
        [
          's1',
          {
            list: [
              {
                messageId: 'm1',
                fromBeyond: true,
                taskPlan: { planId: 'plan-old', version: 3 },
              },
            ],
            pageNum: 1,
            pageSize: 20,
            total: 1,
            pageRange: [1, 1],
          },
        ],
      ]),
    };
    const nextPlan = {
      planId: 'plan-new',
      version: 1,
      title: 'New plan',
      status: 'ACTIVE',
      sessionId: 's1',
      messageId: 'm1',
      tasks: [],
    };

    const updated = reducers.applyTaskPlanSnapshot(state as any, {
      payload: { sessionId: 's1', messageId: 'm1', taskPlan: nextPlan },
    });

    expect(updated.sessionListMap.get('s1').list[0].taskPlan.planId).toBe('plan-new');
  });

  it('reopens a completed child for a newer run and ignores a late terminal from the older run', () => {
    const messageInfo = {
      list: [{ messageId: 'm1', text: 'run one', messageState: 0 }],
      pageNum: 1,
      pageSize: 20,
      total: 1,
      pageRange: [1, 1],
      childRun: { childRunId: 'child:1', childTurn: 1, lastStreamId: '10-0', running: false },
    };
    const state = { sessionListMap: new Map([['child-session', messageInfo]]) };

    const reopened = reducers.applyScopedChildProjection(state as any, {
      payload: {
        sessionId: 'child-session',
        message: { messageId: 'm1', text: 'run two', messageState: 2 },
        childRun: { childRunId: 'child:2', childTurn: 2, lastStreamId: '11-0', running: true },
      },
    });
    const stale = reducers.applyScopedChildProjection(reopened, {
      payload: {
        sessionId: 'child-session',
        message: { messageId: 'm1', text: 'late run one', messageState: 0 },
        childRun: { childRunId: 'child:1', childTurn: 1, lastStreamId: '12-0', running: false },
      },
    });

    expect(reopened.sessionListMap.get('child-session')).toMatchObject({
      list: [{ messageId: 'm1', text: 'run two', messageState: 2 }],
      childRun: { childRunId: 'child:2', childTurn: 2, running: true },
    });
    expect(stale).toBe(reopened);
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

  // 消息回显乱序（issue #234）：增量写入必须与历史加载共用同一套「时间线升序」不变量。
  describe('message list keeps the canonical timeline order on incremental writes', () => {
    // 加固（AI Code Review 意见 B1）：sessionId 缺失或 list 非数组时给出**明确的失败信息**，
    // 而不是由 undefined 解引用产生难以定位的 TypeError。
    const listOf = (state: any, sessionId = 's1'): string[] => {
      const info = state?.sessionListMap?.get(sessionId);
      if (!info) throw new Error(`[test] session "${sessionId}" not found in sessionListMap`);
      if (!Array.isArray(info.list)) throw new Error(`[test] session "${sessionId}" has no list array`);
      return info.list.map((item: any) => `${item.messageId}`);
    };

    it('reorders a late-arriving older message instead of appending it at the tail', () => {
      const map = new Map([
        [
          's1',
          {
            list: [
              { messageId: 3, createTime: '2026-09-16 14:30:10' },
              { messageId: 4, createTime: '2026-09-16 14:31:00' },
            ],
            pageNum: 1,
            pageSize: 20,
            total: 2,
            pageRange: [1, 1],
          },
        ],
      ]);

      const next = reducers.updateSessionMessageList({ sessionListMap: map } as any, {
        payload: {
          sessionId: 's1',
          messageList: (list: any[]) => [...list, { messageId: 2, createTime: '2026-09-16 14:29:53' }],
        },
      });

      expect(listOf(next)).toEqual(['2', '3', '4']);
    });

    it('keeps two successive incremental appends in timeline order when arrival order is reversed', () => {
      const map = new Map([
        [
          's1',
          {
            list: [{ messageId: 100, createTime: '2026-09-16 14:29:53' }],
            pageNum: 1,
            pageSize: 20,
            total: 1,
            pageRange: [1, 1],
          },
        ],
      ]);

      const first = reducers.updateSessionMessageList({ sessionListMap: map } as any, {
        payload: {
          sessionId: 's1',
          messageList: (list: any[]) => [...list, { messageId: 102, createTime: '2026-09-16 14:30:10' }],
        },
      });
      const second = reducers.updateSessionMessageList(first, {
        payload: {
          sessionId: 's1',
          messageList: (list: any[]) => [...list, { messageId: 101, createTime: '2026-09-16 14:29:55' }],
        },
      });

      expect(listOf(second)).toEqual(['100', '101', '102']);
    });

    it('keeps timeline order when several lanes of one turn arrive interleaved', () => {
      const map = new Map([
        [
          's1',
          {
            list: [],
            pageNum: 1,
            pageSize: 20,
            total: 0,
            pageRange: [1, 1],
          },
        ],
      ]);

      // 同一轮里多 lane（AgentTeams 子代理）并发推送，到达顺序与时间线顺序不一致。
      const arrivals = [
        { messageId: 12, createTime: '2026-09-16 14:30:02' },
        { messageId: 10, createTime: '2026-09-16 14:29:53' },
        { messageId: 13, createTime: '2026-09-16 14:30:05' },
        { messageId: 11, createTime: '2026-09-16 14:29:55' },
      ];
      const next = arrivals.reduce(
        (state, arrival) =>
          reducers.updateSessionMessageList(state, {
            payload: { sessionId: 's1', messageList: (list: any[]) => [...list, arrival] },
          }),
        { sessionListMap: map } as any
      );

      expect(listOf(next)).toEqual(['10', '11', '12', '13']);
    });

    it('applyScopedChildProjection inserts a late child message at its timeline position', () => {
      const messageInfo = {
        list: [
          { messageId: 20, createTime: '2026-09-16 14:29:53' },
          { messageId: 22, createTime: '2026-09-16 14:30:10' },
        ],
        pageNum: 1,
        pageSize: 20,
        total: 2,
        pageRange: [1, 1],
        childRun: { childRunId: 'child:1', childTurn: 1, lastStreamId: '9-0', running: true },
      };
      const state = { sessionListMap: new Map([['child-session', messageInfo]]) };

      const next = reducers.applyScopedChildProjection(state as any, {
        payload: {
          sessionId: 'child-session',
          message: { messageId: 21, createTime: '2026-09-16 14:29:55' },
          childRun: { childRunId: 'child:2', childTurn: 2, lastStreamId: '10-0', running: true },
        },
      });

      expect(listOf(next, 'child-session')).toEqual(['20', '21', '22']);
      // B2（AI Code Review 意见）：顺序之外还要验证 childRun 水位与 total 被正确写入。
      expect(next.sessionListMap.get('child-session').childRun).toEqual({
        childRunId: 'child:2',
        childTurn: 2,
        lastStreamId: '10-0',
        running: true,
      });
      expect(next.sessionListMap.get('child-session').total).toBe(3);
    });

    it('listOf fails loudly with a descriptive error instead of an undefined dereference (B1)', () => {
      expect(() => listOf({ sessionListMap: new Map() }, 'missing-session')).toThrow(/missing-session/);
      expect(() => listOf({ sessionListMap: new Map([['s9', {}]]) }, 's9')).toThrow(/no list array/);
    });

    // ---- A2（AI Code Review 意见 A2）：非就地排序回归 ----
    it('never mutates the input array in place (orderBy must keep returning a new array)', () => {
      const previousList = [
        { messageId: 3, createTime: '2026-09-16 14:30:10' },
        { messageId: 1, createTime: '2026-09-16 14:29:53' },
        { messageId: 2, createTime: '2026-09-16 14:29:55' },
      ];
      const snapshot = previousList.map((item) => ({ ...item }));
      const map = new Map([['s1', { list: previousList, pageNum: 1, pageSize: 20, total: 3, pageRange: [1, 1] }]]);

      // updater 原样返回同一个数组引用 —— 最坏情况，旧 state 仍不得被就地改写。
      const next = reducers.updateSessionMessageList({ sessionListMap: map } as any, {
        payload: { sessionId: 's1', messageList: (list: any[]) => list },
      });

      expect(previousList).toEqual(snapshot);
      expect(map.get('s1')!.list).toBe(previousList);
      expect(listOf(next)).toEqual(['1', '2', '3']);
      expect(next.sessionListMap.get('s1')!.list).not.toBe(previousList);
    });

    it('never mutates the input list on the scoped-child projection path either (A2)', () => {
      const previousList = [
        { messageId: 22, createTime: '2026-09-16 14:30:10' },
        { messageId: 20, createTime: '2026-09-16 14:29:53' },
      ];
      const snapshot = previousList.map((item) => ({ ...item }));
      const state = {
        sessionListMap: new Map([
          [
            'child-session',
            {
              list: previousList,
              pageNum: 1,
              pageSize: 20,
              total: 2,
              pageRange: [1, 1],
              childRun: { childRunId: 'child:1', childTurn: 1, lastStreamId: '9-0', running: true },
            },
          ],
        ]),
      };

      reducers.applyScopedChildProjection(state as any, {
        payload: {
          sessionId: 'child-session',
          message: { messageId: 21, createTime: '2026-09-16 14:29:55' },
          childRun: { childRunId: 'child:2', childTurn: 2, lastStreamId: '10-0', running: true },
        },
      });

      expect(previousList).toEqual(snapshot);
      expect(state.sessionListMap.get('child-session')!.list).toBe(previousList);
    });

    // ---- A3（AI Code Review 意见 A3）：时间戳契约 ----
    it('normalizes mixed createTime types so the order stays deterministic (A3)', () => {
      const map = new Map([['s1', { list: [], pageNum: 1, pageSize: 20, total: 0, pageRange: [1, 1] }]]);
      // number 毫秒与数字字符串等价（同刻，按 messageId 升序）；
      // '2026-09-16 14:29:53' 与 +08:00 的 ISO 字符串同刻（同样按 messageId 升序）。
      const arrivals = [
        { messageId: 30, createTime: 1789000000000 },
        { messageId: 10, createTime: '2026-09-16 14:29:53' },
        { messageId: 20, createTime: '1789000000000' },
        { messageId: 40, createTime: '2026-09-16T14:29:53+08:00' },
      ];
      const next = arrivals.reduce(
        (state, arrival) =>
          reducers.updateSessionMessageList(state, {
            payload: { sessionId: 's1', messageList: (list: any[]) => [...list, arrival] },
          }),
        { sessionListMap: map } as any
      );

      expect(listOf(next)).toEqual(['20', '30', '10', '40']);
    });

    it('sorts messages without a usable createTime last and tie-breaks by messageId (A3)', () => {
      const map = new Map([['s1', { list: [], pageNum: 1, pageSize: 20, total: 0, pageRange: [1, 1] }]]);
      const arrivals = [
        { messageId: 60, createTime: '' },
        { messageId: 12, createTime: '2026-09-16 14:29:53' },
        { messageId: 50 },
        { messageId: 11, createTime: '2026-09-16 14:29:53' },
      ];
      const next = arrivals.reduce(
        (state, arrival) =>
          reducers.updateSessionMessageList(state, {
            payload: { sessionId: 's1', messageList: (list: any[]) => [...list, arrival] },
          }),
        { sessionListMap: map } as any
      );

      expect(listOf(next)).toEqual(['11', '12', '50', '60']);
    });

    it('is idempotent and stable for identical createTime (A3)', () => {
      const items = [
        { messageId: 12, createTime: '2026-09-16 14:29:53' },
        { messageId: 10, createTime: '2026-09-16 14:29:53' },
        { messageId: 11, createTime: '2026-09-16 14:29:53' },
      ];

      const once = sortMessagesByTimeline(items as any);
      expect(once.map((item) => item.messageId)).toEqual([10, 11, 12]);
      expect(sortMessagesByTimeline(once as any).map((item) => item.messageId)).toEqual([10, 11, 12]);
      expect(items.map((item) => item.messageId)).toEqual([12, 10, 11]);
    });

    // ---- 边界（AI Code Review 意见：rawMessageList 为 undefined/null）----
    it('keeps the previous list when the updater returns a non-array value', () => {
      const map = new Map([
        [
          's1',
          {
            list: [{ messageId: 1, createTime: '2026-09-16 14:29:53' }],
            pageNum: 1,
            pageSize: 20,
            total: 1,
            pageRange: [1, 1],
          },
        ],
      ]);

      const next = reducers.updateSessionMessageList({ sessionListMap: map } as any, {
        payload: { sessionId: 's1', messageList: () => undefined as any },
      });

      expect(listOf(next)).toEqual(['1']);
      expect(next.sessionListMap.get('s1').total).toBe(1);
    });
  });
});
