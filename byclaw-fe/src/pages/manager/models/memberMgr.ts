// @ts-nocheck
import { getUsersByOrgId, searchPositionList } from '@/pages/manager/service/OrgCenter';
import {
  addUser,
  searchUser,
  updateUser,
  delUser,
  getUserExternalSystemList,
  addUserExternalSystem,
  removeUserExternalSystem,
  batchDelUser,
  resetPassword,
  addUserByOrg,
  setDataPermission,
  getDataPermission,
} from '@/pages/manager/service/MemberMgr';

const normalizeResponse = (response) => {
  if (response && typeof response === 'object' && 'code' in response) {
    return response;
  }
  return { code: 0, data: response };
};

export const getErrorText = (error) => {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object') {
    const msg = error.msg || error.message;
    if (typeof msg === 'string' && msg.trim()) {
      return msg;
    }
  }

  return '请求失败';
};

export default {
  namespace: 'memberMgr',
  state: {},
  effects: {
    *searchPositionList({ payload, success, fail }, { call }) {
      try {
        const data = yield call(searchPositionList, payload);
        const pageData = data || {};
        const response = normalizeResponse({
          rows: pageData.rows || pageData.list || [],
          total: pageData.total || 0,
          pageNum: pageData.pageNum || pageData.pageNum || payload?.pageNum || 1,
          pageSize: pageData.pageSize || payload?.pageSize || 10,
        });
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    *getUsersByOrgId({ payload, success, fail }, { call }) {
      try {
        const data = yield call(getUsersByOrgId, payload);
        const pageData = data || {};
        const response = normalizeResponse({
          rows: pageData.rows || pageData.list || [],
          total: pageData.total || 0,
          pageNum: pageData.pageNum || pageData.pageNum || payload?.pageNum || 1,
          pageSize: pageData.pageSize || payload?.pageSize || 10,
        });
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    *searchUser({ payload, success, fail }, { call }) {
      try {
        const response = yield call(searchUser, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    *addUser({ payload, success, fail }, { call }) {
      try {
        const response = yield call(addUser, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    *updateUser({ payload, success, fail }, { call }) {
      try {
        const response = yield call(updateUser, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    *delUser({ payload, success, fail }, { call }) {
      try {
        const response = yield call(delUser, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    *getUserExternalSystemList({ payload, success, fail }, { call }) {
      try {
        const response = yield call(getUserExternalSystemList, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    *addUserExternalSystem({ payload, success, fail }, { call }) {
      try {
        const response = yield call(addUserExternalSystem, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    *removeUserExternalSystem({ payload, success, fail }, { call }) {
      try {
        const response = yield call(removeUserExternalSystem, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    *batchDelUser({ payload, success, fail }, { call }) {
      try {
        const response = yield call(batchDelUser, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    *resetPassword({ payload, success, fail }, { call }) {
      try {
        const response = yield call(resetPassword, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    *addUserByOrg({ payload, success, fail }, { call }) {
      try {
        const response = yield call(addUserByOrg, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    // 设置数据权限
    *setDataPermission({ payload, success, fail }, { call }) {
      try {
        const response = yield call(setDataPermission, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
    // 获取数据权限
    *getDataPermission({ payload, success, fail }, { call }) {
      try {
        const response = yield call(getDataPermission, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: getErrorText(error) });
      }
    },
  },
};
