// @ts-nocheck
import { message } from 'antd';
import {
  getResourceListByPage,
  deleteResource,
  shelfResource,
  unShelfResource,
  documentLibraryEdit,
  documentLibraryRelease,
  queryCatalogTree,
  queryResourceDetail,
  catalogTree,
  getDataList,
  getDatasetFileNum,
  rebuild,
  removeFile,
  createFolder,
  deleteFolder,
  renameFolder,
  getResourceByObjId,
  modifyVersionAndStatus,
  rollbackVersion,
} from '@/pages/manager/service/DigitalResourceMgr';

export default {
  namespace: 'resourceMgr',
  state: {},
  effects: {
    *getResourceListByPage({ payload, success, fail }, { call }) {
      const response = yield call(getResourceListByPage, payload);

      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *deleteResource({ payload, success, fail }, { call }) {
      const response = yield call(deleteResource, payload);

      if (response?.code === 0) {
        success?.(response.data);
        return true;
      }
      message.error(response?.msg);
      fail?.(response || {});
      return false;
    },
    *shelfResource({ payload, success, fail }, { call }) {
      const response = yield call(shelfResource, payload);

      if (response?.code === 0) {
        success?.(response.data);
        return true;
      }
      message.error(response?.msg);
      fail?.(response || {});
      return false;
    },
    *unShelfResource({ payload, success, fail }, { call }) {
      const response = yield call(unShelfResource, payload);

      if (response?.code === 0) {
        success?.(response.data);
        return true;
      }
      message.error(response?.msg);
      fail?.(response || {});
      return false;
    },
    *getResourceByObjId({ payload, success, fail }, { call }) {
      const response = yield call(getResourceByObjId, payload);
      if (response?.code === 0) {
        success?.(response.data);
        return;
      }
      message.error(response?.msg);
      fail?.(response || {});
    },
    *documentLibraryEdit({ payload, success, fail }, { call }) {
      const response = yield call(documentLibraryEdit, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *documentLibraryRelease({ payload, success, fail }, { call }) {
      const response = yield call(documentLibraryRelease, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *modifyVersionAndStatus({ payload, success, fail }, { call }) {
      const response = yield call(modifyVersionAndStatus, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *rollbackVersion({ payload, success, fail }, { call }) {
      const response = yield call(rollbackVersion, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *queryCatalogTree({ payload, success, fail }, { call }) {
      const response = yield call(queryCatalogTree, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *queryResourceDetail({ payload, success, fail }, { call }) {
      const response = yield call(queryResourceDetail, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *catalogTree({ payload, success, fail }, { call }) {
      const response = yield call(catalogTree, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *getDataList({ payload, success, fail }, { call }) {
      const response = yield call(getDataList, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *getDatasetFileNum({ payload, success, fail }, { call }) {
      const response = yield call(getDatasetFileNum, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *rebuild({ payload, success, fail }, { call }) {
      const response = yield call(rebuild, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *removeFile({ payload, success, fail }, { call }) {
      const response = yield call(removeFile, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *createFolder({ payload, success, fail }, { call }) {
      const response = yield call(createFolder, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *deleteFolder({ payload, success, fail }, { call }) {
      const response = yield call(deleteFolder, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
    *renameFolder({ payload, success, fail }, { call }) {
      const response = yield call(renameFolder, payload);
      if (response?.code === 0) {
        success?.(response);
      } else {
        fail?.(response || {});
      }
    },
  },

  reducers: {
    save(state, { payload }) {
      return {
        ...state,
        ...payload,
      };
    },
  },
};
