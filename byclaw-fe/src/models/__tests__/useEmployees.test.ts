jest.mock('@/service/digitalEmployees', () => ({
  employeeApply: jest.fn(),
  employeeUnApply: jest.fn(),
  getAllDigitalEmployeesV2: jest.fn(),
  deleteResource: jest.fn(),
  queryCatalogTree: jest.fn(),
}));

jest.mock('@/service/layout', () => ({
  getDefaultByaiAgent: jest.fn(),
}));

jest.mock('@/pages/manager/service/resources', () => ({
  deleteResource: jest.fn(),
}));

jest.mock('@/utils/agent', () => ({
  agentHandler: jest.fn((item: any) => ({
    ...item,
    agentId: item.id || item.resourceCode,
  })),
}));

import useEmployeesModel from '../useEmployees';

describe('models/useEmployees', () => {
  const reducers = (useEmployeesModel as any).reducers;
  const effects = (useEmployeesModel as any).effects;
  const sagaHelpers = {
    call: (fn: any, ...args: any[]) => ({ type: 'call', fn, args }),
    put: (action: any) => ({ type: 'put', action }),
    select: (fn: any) => ({ type: 'select', fn }),
    all: (effectList: any[]) => ({ type: 'all', effectList }),
  };

  it('save reducer merges payload', () => {
    const state = { agentId: '', employeesList: [], agentList: [], employeesTypeList: [] };
    expect(reducers.save(state as any, { payload: { agentId: '1' } })).toEqual({
      agentId: '1',
      employeesList: [],
      agentList: [],
      employeesTypeList: [],
    });
  });

  it('updateEmployee updates existing employee and keeps arrays stable', () => {
    const employee = { agentId: '1', name: 'new' };
    const state = {
      employeesList: [{ agentId: '1', name: 'old' }],
      agentList: [],
    };

    const next = reducers.updateEmployee(state as any, { payload: { employee } });
    expect(next.employeesList[0]).toEqual(employee);
  });

  it('updateEmployee appends a new special agent into both lists', () => {
    const employee = { agentId: '1', name: 'agent', agentType: '014' };
    const state = {
      employeesList: [],
      agentList: [],
    };

    const next = reducers.updateEmployee(state as any, { payload: { employee } });
    expect(next.employeesList).toEqual([employee]);
    expect(next.agentList).toEqual([employee]);
  });

  it('getDigitEmployDir returns cached list when available', () => {
    const iterator = effects.getDigitEmployDir({}, sagaHelpers);

    expect(iterator.next().value).toEqual({
      type: 'select',
      fn: expect.any(Function),
    });
    expect(iterator.next({ employeesTypeList: [{ id: 1 }] }).value).toEqual([{ id: 1 }]);
  });

  it('getDigitEmployDir fetches and remaps directory fields when cache is empty', () => {
    const iterator = effects.getDigitEmployDir({}, sagaHelpers);

    iterator.next();
    expect(iterator.next({ employeesTypeList: [] }).value).toEqual({
      type: 'call',
      fn: expect.any(Function),
      args: [{ catalogType: '6' }],
    });

    const resp = [{ catalogName: 'A', pCatalogId: 1 }];
    expect(iterator.next(resp).value).toEqual({
      type: 'put',
      action: {
        type: 'save',
        payload: {
          employeesTypeList: [{ catalogName: 'A', pCatalogId: 1, dirName: 'A', parentDirId: 1 }],
        },
      },
    });
    expect(iterator.next().value).toEqual(resp);
  });

  // discover 接口不传 agentType 会排掉 017，员工组必须单独查一次并进 employeesList，
  // 否则输入框恢复历史会话时查不到组，会兜底显示「AI 助手」。
  it('getAllDigitalEmployees queries employee groups separately and merges them into employeesList', () => {
    const iterator = effects.getAllDigitalEmployees({}, sagaHelpers);

    const requests = iterator.next().value;
    expect(requests.type).toEqual('all');
    expect(requests.effectList).toHaveLength(2);
    expect(requests.effectList[0].args[0]).not.toHaveProperty('agentType');
    expect(requests.effectList[1].args[0]).toMatchObject({ agentType: '017' });

    iterator.next([{ list: [{ id: '1', name: '员工' }] }, { list: [{ id: '9', name: '专家团', agentType: '017' }] }]);

    const saved = iterator.next([]).value;
    expect(saved.action.type).toEqual('save');
    expect(saved.action.payload.employeesList).toEqual([
      { id: '1', name: '员工', agentId: '1', catalogId: undefined },
      { id: '9', name: '专家团', agentType: '017', agentId: '9', catalogId: undefined },
    ]);
    // 组不是 specialAgentType，不能混进默认智能体列表。
    expect(saved.action.payload.agentList).toEqual([]);
  });

  it('getAllDigitalEmployees still works when the group query returns nothing', () => {
    const iterator = effects.getAllDigitalEmployees({}, sagaHelpers);

    iterator.next();
    iterator.next([{ list: [{ id: '1', name: '员工' }] }, undefined]);

    const saved = iterator.next([]).value;
    expect(saved.action.payload.employeesList).toHaveLength(1);
  });
});
