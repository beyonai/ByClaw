// @ts-nocheck
/* eslint-disable function-paren-newline */
import { message } from 'antd';
import { showAuditConfirm } from '@/pages/manager/utils/auditConfirm';
import {
  queryAgentByPage,
  selectDigitalEmployeeByQo,
  saveDigitalEmployee,
  updateDigitalEmployee,
  getCompositeAppInfo,
  checkEmployeeAudit,
  updateCompositeAppInfo,
  publishApp,
  deleteDigitalEmployee,
  getCatalogOnResource,
  qryStoreResourcePageByLogin,
  agtResourcePushStorePage,
  addRelPluginApp,
  deleteRelPluginApp,
  addRelDataset,
  deleteRelDataset,
  addDatasourceBaseToApps,
  removeDatasourceBaseFromApps,
  batchOffShelfResource,
  batchShelfResource,
  getDcConfigByCode,
  getDefaultModel,
  getModelList,
  queryResourcesByPage,
  getMessageList,
  rollbackVersion,
  getStatusNumStatics,
  approveTask,
  cancelCheck,
  checkDigitalEmployeePublish,
} from '@/pages/manager/service/DigitalEmployeeMgr';

/**
 * 统一的合规性校验逻辑
 * @param {Function} call - redux-saga call 方法
 * @param {Object} payload - 请求参数
 * @param {Function} fail - 失败回调
 * @returns {Object|undefined} auditList - 返回校验结果列表，校验失败时返回 undefined
 */
function* validateEmployeeAudit(call, payload, fail) {
  // 先进行合规校验
  let auditResp;
  try {
    auditResp = yield call(checkEmployeeAudit, payload);
  } catch (error) {
    message.error(error || '合规校验接口调用失败');
    fail?.({});
    return undefined;
  }
  if (auditResp?.code !== 0) {
    message.error(auditResp?.msg);
    fail?.(auditResp || {});
    return undefined;
  }
  const auditList = Array.isArray(auditResp?.data) ? auditResp.data : [];

  // 获取所有不符合规范的项
  const allUnpassed = auditList.filter(
    (item) => item && (item.compliance === false || item.key === 'coreCompetencies')
  );

  if (allUnpassed.length === 0) {
    // 没有不符合规范的项，直接返回
    return auditList;
  }

  // 先关闭loading
  fail?.({ ...auditResp, issues: [] });
  yield new Promise((resolve) => {
    setTimeout(resolve, 50);
  });

  // 显示确认框
  const confirmed = yield showAuditConfirm(allUnpassed);

  if (!confirmed) {
    // 用户点击"返回调整"
    fail?.({ ...auditResp, issues: allUnpassed });
    return undefined;
  }

  // 用户点击"继续保存"
  return auditList;
}

const getDigitalTypeOpts = () => {
  return [
    {
      label: 'digitalEmployeeType.manual',
      icon: 'icon-shougongchuangjian',
      value: 'FROM_MANUALLY',
      iconStyle: '#165DFF',
      desc: 'digitalEmployeeMgr.manual',
    },
    {
      label: 'digitalEmployeeType.thirdParty',
      icon: 'icon-disanfang',
      value: 'FROM_THIRD',
      iconStyle: '#722ED1',
      desc: 'digitalEmployeeMgr.thirdParty',
    },
    {
      label: 'digitalEmployeeType.sandbox',
      icon: 'icon-a-shouye-Boxhezi',
      value: 'FROM_SANDBOX',
      iconStyle: '#722ED1',
      desc: 'digitalEmployeeMgr.sandbox',
    },
    {
      label: 'digitalEmployeeType.template',
      icon: 'icon-moban',
      value: 'FROM_DEMO',
      disabled: true,
      iconStyle: '#00B6B6',
    },
  ];
};

export default {
  namespace: 'employeeMgr',
  state: {
    // 文档库、数据库、插件选中的数据，也是下拉选项值
    baseListOpt: [],
    digitalTypeOpts: getDigitalTypeOpts(),
  },
  effects: {
    *cancelCheck({ payload, success, fail }, { call }) {
      const response = yield call(cancelCheck, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *approveTask({ payload, success, fail }, { call }) {
      const response = yield call(approveTask, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *queryAgentByPage({ payload, success, fail }, { call }) {
      const response = yield call(queryAgentByPage, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *selectDigitalEmployeeByQo({ payload, success, fail }, { call }) {
      const response = yield call(selectDigitalEmployeeByQo, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *createDigitalEmployee({ payload, success, fail }, { call }) {
      // 使用统一的合规性校验
      const auditList = yield* validateEmployeeAudit(call, payload, fail);
      if (!auditList) {
        return; // 校验失败，已在 validateEmployeeAudit 中处理
      }

      // 使用新版保存接口，旧接口保留不删除
      const response = yield call(saveDigitalEmployee, payload);

      if (response?.code === 0) {
        // 兼容旧接口 data 为数字、新接口 data 为对象且包含 resourceId 的情况
        const returnedId =
          response && response.data && typeof response.data === 'object' ? response.data.resourceId : response?.data;
        if (response?.msg) {
          message.success(response.msg);
        }
        success?.(returnedId);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *getCompositeAppInfo({ payload, success, fail }, { call }) {
      const response = yield call(getCompositeAppInfo, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *updateCompositeAppInfo({ payload, success, fail }, { call }) {
      const response = yield call(updateCompositeAppInfo, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *publishApp({ payload, success, fail }, { call }) {
      const response = yield call(publishApp, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *updateResource({ payload, success, fail }, { call }) {
      // 使用统一的合规性校验
      const auditList = yield* validateEmployeeAudit(call, payload, fail);
      if (!auditList) {
        return; // 校验失败，已在 validateEmployeeAudit 中处理
      }

      // 使用新版更新接口，旧接口方法保留
      const response = yield call(updateDigitalEmployee, payload);
      if (response?.code === 0) {
        if (response?.msg) {
          message.success(response.msg);
        }
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *deleteResource({ payload, success, fail }, { call }) {
      const ids = Array.isArray(payload?.resourceIds) ? payload.resourceIds : [];
      if (ids.length === 0) {
        message.error('缺少 resourceId');
        fail?.({});
        return;
      }
      for (let i = 0; i < ids.length; i += 1) {
        const response = yield call(deleteDigitalEmployee, { resourceId: String(ids[i]) });
        if (response?.code !== 0) {
          message.error(response?.msg);
          fail?.(response || {});
          return;
        }
      }
      success?.();
    },
    *batchShelfResource({ payload, success, fail }, { call }) {
      const response = yield call(batchShelfResource, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *batchOffShelfResource({ payload, success, fail }, { call }) {
      const response = yield call(batchOffShelfResource, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *getCatalogOnResource({ payload, success, fail }, { call }) {
      const response = yield call(getCatalogOnResource, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *qryStoreResourcePageByLogin({ payload, success, fail }, { call }) {
      const response = yield call(qryStoreResourcePageByLogin, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *agtResourcePushStorePage({ payload, success, fail }, { call }) {
      const response = yield call(agtResourcePushStorePage, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *addRelPluginApp({ payload, success, fail }, { call }) {
      const response = yield call(addRelPluginApp, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *deleteRelPluginApp({ payload, success, fail }, { call }) {
      const response = yield call(deleteRelPluginApp, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *addRelDataset({ payload, success, fail }, { call }) {
      const response = yield call(addRelDataset, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *deleteRelDataset({ payload, success, fail }, { call }) {
      const response = yield call(deleteRelDataset, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *addDatasourceBaseToApps({ payload, success, fail }, { call }) {
      const response = yield call(addDatasourceBaseToApps, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *removeDatasourceBaseFromApps({ payload, success, fail }, { call }) {
      const response = yield call(removeDatasourceBaseFromApps, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *getDcConfigByCode({ payload, success, fail }, { call }) {
      const response = yield call(getDcConfigByCode, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *getDefaultModel({ payload, success, fail }, { call }) {
      const response = yield call(getDefaultModel, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *getModelList({ payload, success, fail }, { call }) {
      const response = yield call(getModelList, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *queryResourcesByPage({ payload, success, fail }, { call }) {
      const response = yield call(queryResourcesByPage, payload);
      if (response?.code === 0 || response?.code === '0' || response?.success === true) {
        success?.(response?.data ?? response);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *getMessageList({ payload, success, fail }, { call }) {
      const response = yield call(getMessageList, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *rollbackVersion({ payload, success, fail }, { call }) {
      const response = yield call(rollbackVersion, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *getStatusNumStatics({ payload, success, fail }, { call }) {
      const response = yield call(getStatusNumStatics, payload);
      if (response?.code === 0) {
        success?.(response.data);
      } else {
        message.error(response?.msg);
        fail?.(response || {});
      }
    },
    *checkDigitalEmployeePublish({ payload, success, fail }, { call }) {
      try {
        const response = yield call(checkDigitalEmployeePublish, payload);
        if (response?.code === 0) {
          success?.(response);
        } else {
          message.error(response?.msg || response?.error_description || response?.error || '校验失败，请稍后重试');
          fail?.(response || {});
        }
      } catch (error) {
        const errMsg =
          typeof error === 'string'
            ? error
            : error?.error_description || error?.msg || error?.message || '服务异常，请稍后重试';
        message.error(errMsg);
        fail?.({ msg: errMsg, error });
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
