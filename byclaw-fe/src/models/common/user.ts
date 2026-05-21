import { globalLogout } from '@/service/common/request';
import { getLoginInfo, queryMyDepartmentRange } from '@/service/user';

import { setUserToken } from '@/utils/auth';
import CookieUtil from '@/utils/cookie';
import { isEmpty, isNil, set } from 'lodash';

export const userInfo: Record<string, any> = {};

// 用户相关类型
export interface UserInfo {
  id?: string | number;
  avatar?: string;

  userId: number;
  userCode: string;
  userName: string;
  email: string;
  phone: string;
  memo: null;
  userType: null;
  assistantId: number;
  positionId: null;
  enterpriseId: number;
  comAcctId: number;
  sessionId: string;
  expiredTime: null;
  usersOrganizations: Array<{
    orgId: number;
    orgName: string;
    positionId: number;
    positionName: string;
    userType: string;
    pathCode: string;
    pathName: string;
  }>;
  userManageOrgs: null;
  sessionDatasetId: string;
  defaultDigEmployeeId?: string | number;
  filterType: null;
  userStation: {
    stationId: number;
    stationName: string;
    stationType: null;
    stationIdPath: string;
    isAbroad: number;
    pstationId: number;
  };
  loginType: string;
  isRetented: boolean;
  registerType: null;
  isDefaultPwd: boolean;

  role?: string;
  permissions?: string[];
}

export interface UserState {
  userInfo: UserInfo | null;
}

const getState = () => {
  return {
    userInfo: null,
    departmentList: [],
  };
};

export default {
  namespace: 'user',

  state: getState(),

  effects: {
    *initUserInfo({ success, fail }: any, { call, put }: any): any {
      try {
        const res = yield call(getLoginInfo);
        if (isNil(res) || res?.code !== 0) {
          globalLogout();
          fail?.(res);
          return res;
        }

        yield put({
          type: 'setUserInfo',
          payload: res,
        });

        yield put({
          type: 'save',
          payload: {
            myDepartmentRange: [],
          },
        });

        success?.(res);
        return res;
      } catch (error: any) {
        console.log(error?.message ?? error);
        globalLogout();
        fail?.(error);
        return null;
      }
    },
    *queryMyDepartmentRange(_: any, { call, put, select }: any): any {
      const cacheMyDepartmentRange = yield select((state: any) => state.user.myDepartmentRange);

      if (!isEmpty(cacheMyDepartmentRange)) {
        return cacheMyDepartmentRange;
      }

      const res = yield call(queryMyDepartmentRange);
      yield put({
        type: 'save',
        payload: {
          myDepartmentRange: res || [],
        },
      });

      return res;
    },
    *setUserInfo({ payload }: { payload: any }, { put }: any): any {
      if (!payload) return;
      const data = payload.data;

      if (!data) return;

      const myUserInfo = {
        ...data,
        loginTime: data?.loginTime || Date.now(),
      };

      CookieUtil.set('uc', myUserInfo.userCode);
      localStorage.setItem('uc', myUserInfo.userCode);

      if (!myUserInfo.registerType) {
        set(myUserInfo, 'isRetented', true);
      }

      setUserToken(payload);

      yield put({
        type: 'save',
        payload: {
          userInfo: myUserInfo,
        },
      });

      yield put({
        type: 'employees/save',
        payload: {
          defaultDigEmployeeId: myUserInfo.defaultDigEmployeeId || '',
        },
      });
    },
  },

  reducers: {
    save(state: UserState, action: { payload: Partial<UserState> }) {
      return {
        ...state,
        ...action.payload,
      };
    },
    clean() {
      return getState();
    },
    updateUserInfo(state: UserState, { payload }: { payload: any }) {
      if (!state.userInfo) {
        return state;
      }
      return {
        ...state,
        userInfo: {
          ...state.userInfo,
          ...payload,
        },
      };
    },
  },
};
