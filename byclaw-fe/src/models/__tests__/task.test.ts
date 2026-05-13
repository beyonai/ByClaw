jest.mock('@/service/task', () => ({
  listTasksByPage: jest.fn(),
}));

jest.mock('@/utils/math', () => ({
  getRandomNumber: jest.fn(() => 0),
}));

import taskModel from '../task';

describe('models/task', () => {
  const reducers = (taskModel as any).reducers;

  it('save merges payload into state', () => {
    const state = { tohandleList: [], doneList: [] };
    expect(reducers.save(state as any, { payload: { noTohandleData: true } })).toEqual({
      tohandleList: [],
      doneList: [],
      noTohandleData: true,
    });
  });

  it('taskDisabled marks a matching task as disabled', () => {
    const state = {
      tohandleList: [{ taskId: '1', disabled: false }],
    };

    const next = reducers.taskDisabled(state as any, { payload: { taskId: '1' } });
    expect(next.tohandleList[0].disabled).toBe(true);
  });

  it('updateTohanleItem removes completed item from tohandleList and prepends to doneList', () => {
    const target = { taskId: '1', title: 'Task 1' };
    const state = {
      tohandleList: [target, { taskId: '2', title: 'Task 2' }],
      doneList: [],
    };

    const next = reducers.updateTohanleItem(state as any, { payload: { taskId: '1', statusCd: 'Completed' } });

    expect(next.tohandleList.map((item: any) => item.taskId)).toEqual(['2']);
    expect(next.doneList[0]).toEqual(target);
  });

  it('clean reducers reset corresponding lists and pagination', () => {
    const state = {
      tohandleList: [{ taskId: '1' }],
      tohandleLoading: true,
      tohandlePagination: { pageIndex: 2 },
      mycreateList: [{ taskId: '2' }],
      mycreateLoading: true,
      mycreatePagination: { pageIndex: 2 },
      doneList: [{ taskId: '3' }],
      doneLoading: true,
      donePagination: { pageIndex: 2 },
    };

    expect(reducers.cleanTohanleList(state as any, { payload: {} }).tohandleList).toEqual([]);
    expect(reducers.cleanMycreateList(state as any, { payload: {} }).mycreateList).toEqual([]);
    expect(reducers.cleanDoneList(state as any, { payload: {} }).doneList).toEqual([]);
  });
});
