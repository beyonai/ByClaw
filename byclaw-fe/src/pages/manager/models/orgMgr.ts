// @ts-nocheck
import { getIsOrgManager, getOrgTree, searchOrg, getStationTree } from '@/pages/manager/service/OrgCenter';
import { listResource, addOrg, updateOrg, delOrg } from '@/pages/manager/service/OrgMgr';

const normalizeResponse = (response) => {
  if (response && typeof response === 'object' && 'code' in response) {
    return response;
  }
  return { code: 0, data: response };
};

export default {
  namespace: 'orgMgr',
  state: {},
  effects: {
    *getIsOrgManager({ success, fail }, { call }) {
      try {
        const response = normalizeResponse(yield call(getIsOrgManager));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *getOrgTree({ payload, success, fail }, { call }) {
      try {
        const data = yield call(getOrgTree, payload);
        const response = normalizeResponse(Array.isArray(data) ? data : data || []);
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *searchOrg({ payload, success, fail }, { call }) {
      try {
        const response = normalizeResponse(yield call(searchOrg, payload));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *listResource({ payload, success, fail }, { call }) {
      try {
        const response = normalizeResponse(yield call(listResource, payload));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },

    // 获取驻地树
    *getStationTree({ payload, success, fail }, { call }) {
      try {
        const response = normalizeResponse(yield call(getStationTree, payload));
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },

    // 新增组织
    *addOrg({ payload, success, fail }, { call }) {
      try {
        const response = yield call(addOrg, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },

    // 修改组织
    *updateOrg({ payload, success, fail }, { call }) {
      try {
        const response = yield call(updateOrg, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },

    // 删除组织
    *delOrg({ payload, success, fail }, { call }) {
      try {
        const response = yield call(delOrg, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
  },
};
