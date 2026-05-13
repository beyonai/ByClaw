// @ts-nocheck
import { message } from 'antd';
import {
  listDigitalEmployeeAuth,
  listResourceAuth,
  listOwnEmployee,
  listOwnResource,
  findAll,
  findOrg,
  findUser,
  findPosition,
  findStation,
} from '@/pages/manager/service/AuthorizeMgr';

export default {
  namespace: 'authorizeMgr',
  state: {},
  effects: {
    *listDigitalEmployeeAuth({ payload, success, fail }, { call }) {
      try {
        const response = yield call(listDigitalEmployeeAuth, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *listResourceAuth({ payload, success, fail }, { call }) {
      try {
        const response = yield call(listResourceAuth, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *listOwnEmployee({ payload, success, fail }, { call }) {
      try {
        const response = yield call(listOwnEmployee, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *listOwnResource({ payload, success, fail }, { call }) {
      try {
        const response = yield call(listOwnResource, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *findAll({ payload, success, fail }, { call }) {
      try {
        const response = yield call(findAll, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *findOrg({ payload, success, fail }, { call }) {
      try {
        const response = yield call(findOrg, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
          message.error(response?.msg);
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *findUser({ payload, success, fail }, { call }) {
      try {
        const response = yield call(findUser, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *findPosition({ payload, success, fail }, { call }) {
      try {
        const response = yield call(findPosition, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
          message.error(response?.msg);
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *findStation({ payload, success, fail }, { call }) {
      try {
        const response = yield call(findStation, payload);
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
