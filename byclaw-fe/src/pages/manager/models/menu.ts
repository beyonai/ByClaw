// @ts-nocheck
import { getDcSystemConfig } from '@/pages/manager/service/session';
import { get } from 'lodash';

export interface MenuState {
  blockedPaths: string[] | null;
}

export default {
  namespace: 'menu',
  state: <MenuState>{
    blockedPaths: null,
  },
  effects: {
    *getBlockedPaths({ payload }, { call, put, select }): any {
      const blockedPaths = yield select(({ menu }) => menu.blockedPaths);

      if (Array.isArray(blockedPaths)) {
        return blockedPaths;
      }

      let myBlockedPaths = [];
      try {
        const response = yield call(getDcSystemConfig, payload);
        if (`${response.code}` === '0') {
          myBlockedPaths = (get(response, 'data.paramValue') || '').split(',');
        }
      } catch (error) {}

      yield put({
        type: 'save',
        payload: { blockedPaths: myBlockedPaths },
      });

      return [];
    },
  },

  reducers: {
    save(state: MenuState, { payload }: { payload: Partial<MenuState> }) {
      return {
        ...state,
        ...payload,
      };
    },
  },
};
