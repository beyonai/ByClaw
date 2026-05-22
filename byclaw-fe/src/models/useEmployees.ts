// @ts-ignore
import { isEmpty, uniqBy } from 'lodash';

import { employeeApply, employeeUnApply, getAllDigitalEmployeesV2, queryCatalogTree } from '@/service/digitalEmployees';
import { deleteResource } from '@/pages/manager/service/resources';
import { getDefaultByaiAgent } from '@/service/layout';
import { IAgent, IAgentCache } from '@/typescript/agent';
import { specialAgentType } from '@/constants/agent';
import { agentHandler } from '@/utils/agent';

export type IState = {
  agentId: string;
  defaultDigEmployeeId: string;
  employeesTypeList: any[];
  employeesList: IAgentCache[];
  agentList: IAgentCache[];
};

// class组件用的store
export default {
  namespace: 'employees',

  state: {
    agentId: '',
    defaultDigEmployeeId: '',
    employeesTypeList: [], // 数字员工目录分类
    employeesList: [], // 所有数字员工列表
    agentList: [], // 默认智能体，问数、慧笔、鲸灵
  },

  effects: {
    // 获取数字员工目录
    *getDigitEmployDir(_: any, { call, put, select }: any): any {
      const { employeesTypeList } = yield select((state: any) => state.employees);

      if (!isEmpty(employeesTypeList)) {
        return employeesTypeList;
      }

      try {
        const resp = yield call(queryCatalogTree, {
          catalogType: '6',
        });

        yield put({
          type: 'save',
          payload: {
            employeesTypeList: [
              ...resp.map(
                (item: {
                  catalogDesc: string;
                  catalogId: number;
                  catalogName: string;
                  catalogType: number;
                  pCatalogId: number;
                }) => {
                  return {
                    ...item,
                    dirName: item.catalogName,
                    parentDirId: item.pCatalogId,
                  };
                }
              ),
            ],
          },
        });

        return resp;
      } catch (e) {
        console.error(e);
      }
      return null;
    },
    // 移除申请
    *toUnApply({ payload = {} }: any, { call, put, select }: any): any {
      const { id } = payload;

      const { employeesList } = yield select((state: any) => state.employees);

      yield put({
        type: 'save',
        payload: {
          employeesList: employeesList.map((item: IAgentCache) => {
            if (`${item.id}` === `${id}`) {
              return {
                ...item,
                approveStatus: null,
                grantType: null,
                authorizeMe: false,
              };
            }
            return item;
          }),
        },
      });

      let resp;

      try {
        resp = yield call(employeeUnApply, {
          resourceId: id,
        });
      } catch (e) {
        console.error(e);
      }
      return resp;
    },
    *getDefaultByaiAgent({ payload = {} }: any, { call, put }: any): any {
      const resp = yield call(getDefaultByaiAgent, payload);

      const agentList = resp.map((item: IAgent) => {
        return {
          ...agentHandler(item),
        };
      });

      yield put({
        type: 'save',
        payload: {
          agentList,
        },
      });

      return agentList;
    },
    // 获取所有数字员工
    *getAllDigitalEmployees(_: any, { call, put, select }: any): any {
      try {
        const resp = yield call(getAllDigitalEmployeesV2, {
          terminals: ['ALL', 'PC', 'APP'],
          pageNum: 1,
          pageSize: 9999,
          keyword: '',
          metaStatus: 'ALL',
          orgFilters: [{ type: 'ALL' }],
          orderField: 'focus',
          orderBy: 'desc',
        });
        const { list } = resp || {};

        const cacheEmployeesList = yield select((state: any) => state.employees.employeesList);

        const employeesList: IAgentCache[] = [];
        const myAgentList: IAgentCache[] = [];

        list.forEach((item: IAgent) => {
          const { catalogId } = item;

          const res: any = agentHandler(item);

          employeesList.push({
            ...res,
            catalogId,
          });

          if (specialAgentType.includes(res.agentType)) {
            myAgentList.push({ ...res });
          }
        });

        yield put({
          type: 'save',
          payload: {
            employeesList: uniqBy([...cacheEmployeesList, ...employeesList], 'agentId'),
            agentList: myAgentList,
          },
        });
        return resp;
      } catch (e) {
        console.error('getAllDigitalEmployees failed', e ?? 'unknown');
        return undefined;
      }
    },
    *toApplyAgent({ payload = {} }: any, { call, put, select }: any): any {
      const { id } = payload;

      const { employeesList } = yield select((state: any) => state.employees);

      yield put({
        type: 'save',
        payload: {
          employeesList: employeesList.map((item: IAgentCache) => {
            if (item.id === id) {
              return {
                ...item,
                approveStatus: 'S',
              };
            }
            return item;
          }),
        },
      });

      let resp;

      try {
        resp = yield call(employeeApply, {
          agentId: id,
        });
      } catch (e) {
        console.error(e);
      }
      return resp;
    },
    *deleteEmployee({ payload }: { payload: { delIdList: string[] } }, { call, put, select }: any): any {
      const { delIdList } = payload;

      const resp = yield call(deleteResource, payload);

      if (`${resp.code}` === '0') {
        const { employeesList } = yield select((state: any) => state.employees);

        const newEmployeesList = employeesList.filter((item: any) => !delIdList.includes(item.agentId));

        yield put({
          type: 'save',
          payload: {
            employeeList: [...newEmployeesList],
            employeesList: [...newEmployeesList],
          },
        });
      }
      return resp;
    },
  },
  reducers: {
    save(state: IState, action: { payload: Partial<IState> }) {
      return {
        ...state,
        ...action.payload,
      };
    },
    updateEmployee(state: IState, action: { payload: { employee: IAgentCache } }) {
      const { employee } = action.payload;
      const { employeesList, agentList } = state;

      if (!employee.agentId) {
        return state;
      }

      const targetEmployees = employeesList.find((item: IAgentCache) => `${item.agentId}` === `${employee.agentId}`);
      const tagetAgent = agentList.map((item: IAgentCache) => `${item.agentId}` === `${employee.agentId}`);

      if (targetEmployees) {
        Object.assign(targetEmployees, employee);
        if (tagetAgent) {
          Object.assign(tagetAgent, employee);
        }
      } else {
        employeesList.push(employee);
        if (specialAgentType.includes(employee?.agentType as any)) {
          agentList.push({ ...employee });
        }
      }

      return {
        ...state,
        employeesList: [...employeesList],
        agentList: [...agentList],
      };
    },
  },
};
