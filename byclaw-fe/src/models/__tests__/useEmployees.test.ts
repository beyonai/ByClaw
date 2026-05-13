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
});
