// @ts-nocheck
import { POST } from '@/service/common/request';

const withResourceImplDefaults = (params: any = {}) => ({
  ...params,
  implType: params?.implType ?? '',
  workerAgentType: params?.workerAgentType ?? '',
});

export async function getResourceListByPage(params: any) {
  return POST(
    '/byaiService/new/resource/getResourceListByPage',
    { ...params },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function deleteResource(params: any) {
  return POST('/byaiService/new/resource/deleteResource', { ...params });
}

export async function shelfResource(params: any) {
  return POST('/byaiService/new/resource/shelfResource', { ...params });
}

export async function unShelfResource(params: any) {
  return POST('/byaiService/new/resource/unShelfResource', { ...params });
}

export async function documentLibraryEdit(params: any) {
  return POST(
    `/byaiService/new/resource/${params.resourceId ? 'updateResource' : 'createResource'}`,
    withResourceImplDefaults(params)
  );
}

export async function documentLibraryRelease(params: any) {
  return POST('/byaiService/new/resource/publishResource', { ...params });
}

export async function queryCatalogTree(params: any) {
  return POST('/byaiService/catalog/queryCatalogTree', { ...params });
}

// 数字员工详情
export async function queryResourceDetail(params: any) {
  return POST('/byaiService/resource/queryResourceDetail', { ...params });
}

export async function catalogTree(params: any) {
  return POST('/byaiService/resource/catalogTree', { ...params });
}

export async function getDataList(params: any) {
  return POST('/byaiService/resource/getDataList', { ...params });
}

export async function getDatasetFileNum(params: any) {
  return POST('/byaiService/resource/getDatasetFileNum', { ...params });
}

export async function rebuild(params: any) {
  return POST('/byaiService/resource/rebuild', { ...params });
}

export async function removeFile(params: any) {
  return POST('/byaiService/resource/removeFile', { ...params });
}

export async function createFolder(params: any) {
  return POST('/byaiService/resource/createFolder', { ...params });
}

export async function deleteFolder(params: any) {
  return POST('/byaiService/resource/deleteFolder', { ...params });
}

export async function renameFolder(params: any) {
  return POST('/byaiService/resource/renameFolder', { ...params });
}

export async function getResourceByObjId(params: any) {
  return POST('/byaiService/resource/getResourceByObjId', { ...params });
}

export async function modifyVersionAndStatus(params: any) {
  return POST('/byaiService/new/resource/modifyVersionAndStatus', { ...params });
}

export async function rollbackVersion(params: any) {
  return POST('/byaiService/new/resource/rollbackVersion', { ...params });
}

export async function listAuthDetail(params: any) {
  return POST(
    '/byaiService/auth/privilegeGrant/listAuthDetail',
    { ...params },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

// 使用授权
export async function batchHandleAuth(params: any, apiPath?: string) {
  return POST(
    apiPath || '/byaiService/auth/privilegeGrant/batchHandleAuth',
    { ...params },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

// 管理授权
export async function allowManageAuth(params: any, apiPath?: string) {
  return POST(
    apiPath || '/byaiService/auth/privilegeGrant/allowManageAuth',
    { ...params },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}
