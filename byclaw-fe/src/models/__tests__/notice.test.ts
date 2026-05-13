jest.mock('@/service/notice', () => ({
  getAllNotice: jest.fn(),
  batchReadNotice: jest.fn(),
}));

import noticeModel from '../notice';

describe('models/notice', () => {
  const reducers = (noticeModel as any).reducers;
  const effects = (noticeModel as any).effects;
  const sagaHelpers = {
    call: (fn: any, ...args: any[]) => ({ type: 'call', fn, args }),
    put: (action: any) => ({ type: 'put', action }),
    select: (fn: any) => ({ type: 'select', fn }),
  };

  it('save reducer merges payload', () => {
    const state = { allNoticeList: [], unreadNoticeList: [] };
    expect(reducers.save(state as any, { payload: { unreadNoticeList: [{ id: 1 }] } })).toEqual({
      allNoticeList: [],
      unreadNoticeList: [{ id: 1 }],
    });
  });

  it('getAllNotice effect saves unread first page correctly', () => {
    const iterator = effects.getAllNotice({ payload: { pageNum: 1, isRead: '0' } }, sagaHelpers);

    expect(iterator.next().value).toEqual({
      type: 'select',
      fn: expect.any(Function),
    });
    expect(iterator.next({ allNoticePagination: {}, unreadNoticePagination: {} }).value).toEqual({
      type: 'call',
      fn: expect.any(Function),
      args: [
        {
          isRead: '0',
          pageNum: 1,
          pageSize: 30,
        },
      ],
    });

    const response = {
      records: [{ id: 1 }],
      total: 10,
      current: 1,
      totalPages: 1,
    };
    expect(iterator.next(response).value).toEqual({
      type: 'select',
      fn: expect.any(Function),
    });
    expect(iterator.next({ allNoticeList: [] }).value).toEqual({
      type: 'select',
      fn: expect.any(Function),
    });
    expect(iterator.next({ unreadNoticeList: [] }).value).toEqual({
      type: 'put',
      action: {
        type: 'save',
        payload: {
          unreadNoticeList: [{ id: 1 }],
          unreadNoticePagination: {
            pageIndex: 1,
            pageCount: 1,
            total: 10,
          },
        },
      },
    });
    expect(iterator.next().value).toEqual([{ id: 1 }]);
  });

  it('batchReadNotice effect marks all as read', () => {
    const iterator = effects.batchReadNotice({ payload: { read: 'ALL' } }, sagaHelpers);

    expect(iterator.next().value).toEqual({
      type: 'call',
      fn: expect.any(Function),
      args: [{ read: 'ALL' }],
    });
    expect(iterator.next().value).toEqual({
      type: 'select',
      fn: expect.any(Function),
    });
    expect(
      iterator.next({
        allNoticeList: [{ id: 1, isRead: '0' }],
        unreadNoticeList: [{ id: 1, isRead: '0' }],
        unreadNoticePagination: { total: 1 },
      }).value
    ).toEqual({
      type: 'put',
      action: {
        type: 'save',
        payload: {
          allNoticeList: [{ id: 1, isRead: '1' }],
          unreadNoticeList: [],
          unreadNoticePagination: expect.objectContaining({
            pageIndex: 1,
            pageSize: 30,
          }),
        },
      },
    });
  });
});
