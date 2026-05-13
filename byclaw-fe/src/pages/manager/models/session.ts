// @ts-nocheck
import {
  getDcSystemConfigListByStandType,
  currentUser,
  editEnterprise,
  getEnterprise,
  bathQryPropertyKey,
} from '@/pages/manager/service/session';

import { isAdminVip } from '@/pages/manager/utils/auth';

import { convertFlattenMenuToTreeData } from '@/pages/manager/utils/menu';
import { getSessionKey, sessionKey } from '@/pages/manager/utils/auth';

export const addAdminvipRole = (userInfo) => {
  if (isAdminVip(userInfo)) {
    userInfo.usersOrganizations?.push?.({
      orgId: -1,
      orgName: 'adminvip',
      positionId: 1,
      positionName: 'adminvip',
      userType: 'ADMIN',
      pathCode: '-1.-1',
      pathName: 'adminvip',
    });
  }

  return userInfo;
};

export default {
  namespace: 'sessionMgr',
  state: {
    userInfo: {},
    systemParams: {},
    systemConfig: {},
  },
  effects: {
    *getDcSystemConfigListByStandType({ payload }, { call }) {
      const response = yield call(getDcSystemConfigListByStandType, payload);
      return response;
    },

    *currentUser({ payload }, { call, put }) {
      const response = yield call(currentUser, payload);
      if (response?.code === 0) {
        yield put({
          type: 'save',
          payload: { userInfo: addAdminvipRole(response.data) },
        });
        // 兜底：确保 SESSION 存在时同步写入 state 后继续后续流程
        if (!getSessionKey?.() && response?.data?.sessionId) {
          localStorage.setItem(sessionKey, response.data.sessionId);
        }
      }
      return response;
    },
    *editEnterprise({ payload }, { call }) {
      const response = yield call(editEnterprise, payload);
      return response;
    },
    *getEnterprise({ payload }, { call }) {
      const response = yield call(getEnterprise, payload);
      return response;
    },
    *bathQryPropertyKey({ payload }, { call, select, put }) {
      const response = yield call(bathQryPropertyKey, payload);
      if (response?.code === 0) {
        const systemParams = yield select(({ session }) => session.systemParams);

        yield put({
          type: 'save',
          payload: { systemParams: { ...systemParams, ...response.data } },
        });
      }
      return response;
    },
  },

  reducers: {
    save(state, { payload }) {
      return {
        ...state,
        ...payload,
      };
    },

    saveSystemConfig(state, { payload }) {
      return {
        ...state,
        systemConfig: {
          ...state.systemConfig,
          ...payload,
        },
      };
    },

    saveLogInData(state, { payload }) {
      const { data, data: { menuList = [] } = {} } = payload;
      // 备份
      window.sessionStorage.setItem('staffInfo', JSON.stringify(data));

      const result = {
        ...state,
        userInfo: data,
        treeMenus: convertFlattenMenuToTreeData(menuList ? menuList : []),
        flattenMenus: menuList ? menuList : [],
      };

      return result;
    },
  },
};
