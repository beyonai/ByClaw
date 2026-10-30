// @ts-nocheck
import { message } from 'antd';
import { getIntl } from '@umijs/max';
import {
  listSandboxRecords,
  removeSandboxById,
  updateSandbox,
  listServiceSpec,
  getServiceSpec,
  saveServiceSpec,
  deleteServiceSpec,
  launchByUserCode,
  resizeSandbox,
  listResizeRecords,
  listServiceProfiles,
  saveServiceProfile,
  deleteServiceProfile,
  getSandboxHealthGlobalSwitch,
  saveSandboxHealthGlobalSwitch,
  listSandboxHealthWatermarkModels,
  saveSandboxHealthWatermarkModel,
  deleteSandboxHealthWatermarkModel,
  enableSandboxHealthWatermarkModel,
  previewSandboxHealthWatermark,
} from '@/pages/manager/service/SandboxMgr';
import { unwrapResponse, getErrorText } from '@/pages/manager/models/modelMgr';

export default {
  namespace: 'sandboxMgr',
  state: {},
  effects: {
    *listSandboxRecords({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(listSandboxRecords, payload));
        if (response.code === 0) {
          success?.(response.data || {});
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.list' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *removeSandboxById({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(removeSandboxById, payload));
        if (response.code === 0) {
          success?.(response.data);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.remove' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *updateSandbox({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(updateSandbox, payload));
        if (response.code === 0) {
          success?.(response.data);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.update' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    // ==================== 沙箱服务规格配置管理接口 ====================
    *listServiceSpec({ success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(listServiceSpec));
        if (response.code === 0) {
          success?.(response.data || []);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.specList' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *getServiceSpec({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(getServiceSpec, payload));
        if (response.code === 0) {
          success?.(response.data);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.spec' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *saveServiceSpec({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(saveServiceSpec, payload));
        if (response.code === 0) {
          message.success(getIntl().formatMessage({ id: 'sandboxMgr.config.saveSuccess' }));
          success?.(response.data);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.specSave' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *deleteServiceSpec({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(deleteServiceSpec, payload));
        if (response.code === 0) {
          message.success(getIntl().formatMessage({ id: 'sandboxMgr.config.deleteSuccess' }));
          success?.(response.data);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.specDelete' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *launchByUserCode({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(launchByUserCode, payload));
        if (response.code === 0) {
          success?.(response.data);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.launch' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *resizeSandbox({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(resizeSandbox, payload));
        if (response.code === 0) {
          success?.(response.data);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.resize' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *listResizeRecords({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(listResizeRecords, payload));
        if (response.code === 0) {
          success?.(response.data || []);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.resizeRecords' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *listServiceProfiles({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(listServiceProfiles, payload || {}));
        if (response.code === 0) {
          success?.(response.data || []);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.profiles' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *saveServiceProfile({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(saveServiceProfile, payload));
        if (response.code === 0) {
          message.success(getIntl().formatMessage({ id: 'sandboxMgr.profile.saveSuccess' }));
          success?.(response.data);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.profileSave' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *deleteServiceProfile({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(deleteServiceProfile, payload));
        if (response.code === 0) {
          message.success(getIntl().formatMessage({ id: 'sandboxMgr.profile.deleteSuccess' }));
          success?.(response.data);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.profileDelete' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *getSandboxHealthGlobalSwitch({ success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(getSandboxHealthGlobalSwitch));
        if (response.code === 0) {
          success?.(response.data || {});
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.healthSwitch' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *saveSandboxHealthGlobalSwitch({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(saveSandboxHealthGlobalSwitch, payload));
        if (response.code === 0) {
          message.success(getIntl().formatMessage({ id: 'sandboxMgr.health.switchSaveSuccess' }));
          success?.(response.data || {});
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.healthSwitchSave' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *listSandboxHealthWatermarkModels({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(listSandboxHealthWatermarkModels, payload || {}));
        if (response.code === 0) {
          success?.(response.data || []);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.watermarkModels' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *saveSandboxHealthWatermarkModel({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(saveSandboxHealthWatermarkModel, payload));
        if (response.code === 0) {
          message.success(getIntl().formatMessage({ id: 'sandboxMgr.health.modelSaveSuccess' }));
          success?.(response.data || {});
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.watermarkSave' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *deleteSandboxHealthWatermarkModel({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(deleteSandboxHealthWatermarkModel, payload));
        if (response.code === 0) {
          message.success(getIntl().formatMessage({ id: 'sandboxMgr.health.modelDeleteSuccess' }));
          success?.(response.data);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.watermarkDelete' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *enableSandboxHealthWatermarkModel({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(enableSandboxHealthWatermarkModel, payload));
        if (response.code === 0) {
          success?.(response.data);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.watermarkUpdate' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *previewSandboxHealthWatermark({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(previewSandboxHealthWatermark, payload));
        if (response.code === 0) {
          success?.(response.data || {});
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.error.watermarkPreview' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
  },
};
