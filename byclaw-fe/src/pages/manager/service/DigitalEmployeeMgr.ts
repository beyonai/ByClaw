// @ts-nocheck
import { POST as commonPOST, GET } from '@/service/common/request';

const POST = (url: string, params: any, config?: any) => {
  return commonPOST(url, params, {
    responseCfg: {
      customHandle: true,
    },
    ...(config || {}),
  });
};

const withResourceImplDefaults = (params: any = {}) => ({
  ...params,
  implType: params?.implType ?? '',
  workerAgentType: params?.workerAgentType ?? '',
});

export async function queryAgentByPage(params: any) {
  return POST('/byaiService/digitalEmployeeController/queryAgentByPage', { ...params });
}

export async function selectDigitalEmployeeByQo(params: any) {
  return POST('/byaiService/digitalEmployeeController/selectDigitalEmployeeByQo', { ...params });
}

export async function createDigitalEmployee(params: any) {
  return POST('/byaiService/digitalEmployeeController/createDigitalEmployee', withResourceImplDefaults(params));
}

export async function saveDigitalEmployee(params: any) {
  return POST('/byaiService/digitalEmployeeController/saveDigitalEmployee', withResourceImplDefaults(params));
}

export async function checkEmployeeAudit(params: any) {
  return POST(
    '/byaiService/digitalEmployeeController/checkEmployeeAudit',
    { ...params },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

/** 数字员工详情：编辑页、管理端抽屉、发布前拉取等均走此接口 */
export async function findDetailsById(params: { resourceId: string }) {
  return POST('/byaiService/digitalEmployeeController/findDetailsById', {
    resourceId: params.resourceId,
  });
}

export async function getCompositeAppInfo(params: any) {
  const resourceId = params?.resourceId ?? params?.id;
  if (resourceId !== undefined && resourceId !== null && `${resourceId}` !== '') {
    return findDetailsById({ resourceId: String(resourceId) });
  }
  return POST('/byaiService/api/v1/digitEmploy/getCompositeAppInfo', { ...params });
}

export async function updateCompositeAppInfo(params: any) {
  return POST('/byaiService/digitalEmployeeController/updateCompositeAppInfo', { ...params });
}

export async function updateDigitalEmployee(params: any) {
  return POST('/byaiService/digitalEmployeeController/updateDigitalEmployee', withResourceImplDefaults(params));
}

export async function publishApp(params: any) {
  return POST('/byaiService/digitalEmployeeController/publishApp', { ...params });
}

export async function queryResourcesByPage(params: any) {
  return POST('/byaiService/open/api/v1/queryResourcesByPage', { ...params }, {});
}

/** 删除数字员工（单条） */
export async function deleteDigitalEmployee(params: { resourceId: string }) {
  return POST('/byaiService/digitalEmployeeController/deleteDigitalEmployee', { ...params });
}

export async function batchShelfResource(params: any) {
  return POST('/byaiService/resource/batchShelfResource', { ...params });
}

export async function batchOffShelfResource(params: any) {
  return POST('/byaiService/resource/batchOffShelfResource', { ...params });
}

export async function getCatalogOnResource(params: any) {
  return POST('/byaiService/digitalEmployeeController/queryCatalogTree', { ...params });
}

export async function qryStoreResourcePageByLogin(params: any) {
  return POST('/byaiService/resource/qryStoreResourcePageByLogin', { ...params });
}

export async function agtResourcePushStorePage(params: any) {
  return POST('/byaiService/resource/agtResourcePushStorePage', { ...params });
}

export async function addRelPluginApp(params: any) {
  return POST('/byaiService/digitalEmployeeController/addRelPluginApp', { ...params });
}

export async function deleteRelPluginApp(params: any) {
  return POST('/byaiService/digitalEmployeeController/deleteRelPluginApp', { ...params });
}

export async function addRelDataset(params: any) {
  return POST('/byaiService/digitalEmployeeController/addRelDataset', { ...params });
}

export async function deleteRelDataset(params: any) {
  return POST('/byaiService/digitalEmployeeController/deleteRelDataset', { ...params });
}

export async function addDatasourceBaseToApps(params: any) {
  return POST('/byaiService/digitalEmployeeController/addDatasourceBaseToApps', { ...params });
}

export async function removeDatasourceBaseFromApps(params: any) {
  return POST('/byaiService/digitalEmployeeController/removeDatasourceBaseFromApps', { ...params });
}

export async function getDcConfigByCode(params: any) {
  return POST('/byaiService/ConfigController/getDcConfigByCode', { ...params });
}

export async function getDefaultModel(params: any) {
  return POST('/byaiService/digitalEmployeeController/getDefaultModel', { ...params });
}

export async function getModelList(params: any) {
  return POST(
    '/byaiService/new/model/listModel',
    { tagId: '1', ...params },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function getMessageList(params: any) {
  return POST('/byaiService/system/message/list', { ...params });
}

export async function rollbackVersion(params: any) {
  return POST('/byaiService/new/resource/rollbackVersion', { ...params });
}

export async function getStatusNumStatics(params: any) {
  return POST(
    '/byaiService/digitalEmployeeController/getStatusNumStatics',
    { ...params },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function getSourceOption() {
  return GET(
    '/byaiService/system/sourcesystem/getSourceSystemList',
    {},
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function getDcSystemConfigListByStandType(params: any) {
  return POST('/byaiService/system/staticdata/getDcSystemConfigListByStandType', { ...params });
}

export async function approveTask(params: any) {
  return POST('/byaiService/approve/task/approve', { ...params });
}

export async function cancelCheck(params: any) {
  return POST('/byaiService/approve/task/cancel', { ...params });
}

export async function checkDigitalEmployeePublish(params: any) {
  return POST('/byaiService/digitalEmployeeController/checkDigitalEmployeePublish', { ...params });
}

export async function queryRelResourceInfo(params: any) {
  return POST('/byaiService/digitalEmployeeController/queryRelResourceInfo', { ...params });
}

export async function queryTemplateRuleInfo(params: any) {
  return POST('/byaiService/digitalEmployeeController/queryTemplateRuleInfo', { ...params });
}

export async function createTemplateRuleInfo(params: any) {
  return POST('/byaiService/digitalEmployeeController/createTemplateRuleInfo', { ...params });
}

export async function deleteTemplateRuleInfo(params: any) {
  return POST('/byaiService/digitalEmployeeController/deleteTemplateRuleInfo', { ...params });
}

export async function updateTemplateRuleInfo(params: any) {
  return POST('/byaiService/digitalEmployeeController/updateTemplateRuleInfo', { ...params });
}

export async function getOperationsInfo(params: any) {
  return GET(`/byaiService/operations/digEmployee/getOperationsInfo?resourceId=${params.resourceId}`);
}

export async function getUsageMetrics(params: any) {
  return POST('/byaiService/operations/digEmployee/getUsageMetrics', { ...params });
}

export async function getFrequentQuestions(params: any) {
  return POST('/byaiService/operations/digEmployee/getFrequentQuestions', { ...params });
}

export async function uploadTestSet(params: any) {
  const formData = new FormData();
  formData.append('file', params.file);
  return POST('/byaiService/digitalEmployeeController/uploadTestSet', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export async function getTestSetResult(params: any) {
  return POST('/byaiService/digitalEmployeeController/getTestSetResult', { ...params });
}

export async function getTestSetResultPage(params: any) {
  return POST('/byaiService/digitalEmployeeController/getTestSetResultPage', { ...params });
}

export async function queryResourceListByDefaultType(params: any) {
  return POST('/byaiService/digitalEmployeeController/queryResourceListByDefaultType', { ...params });
}

export async function importToolJson(params: any) {
  const formData = new FormData();
  formData.append('file', params.file);
  if (params.catalogId !== undefined && params.catalogId !== null && `${params.catalogId}` !== '') {
    formData.append('catalogId', `${params.catalogId}`);
  }
  return POST('/byaiService/tool/importToolJson', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    responseCfg: {
      customHandle: true,
    },
  });
}

export async function parseCurl(params: any) {
  return POST(
    '/byaiService/tool/parseCurl',
    { ...params },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function saveTool(params: any) {
  return POST(
    '/byaiService/tool/saveTool',
    { ...params },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}
