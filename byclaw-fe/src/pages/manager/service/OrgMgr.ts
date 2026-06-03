// @ts-nocheck
import { POST } from '@/service/common/request';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

// 数字员工领域
export function queryCatalogTree(params: any) {
  return POST('/byaiService/catalog/queryCatalogTree', params, withCustomHandle);
}

// 数字员工来源
export function getSourceSystemList(params: any) {
  return POST('/byaiService/system/sourcesystem/getSourceSystemListByType', params, withCustomHandle);
}

export async function getOrgTree(params: any) {
  return POST('/byaiService/system/organization/getOrgTree', params);
}

export async function listResource(params: any) {
  return POST('/byaiService/auth/privilegeGrant/listResourceUseAuth', params, {
    responseCfg: {
      customHandle: true,
    },
  });
}

export async function findAll(params: any) {
  return POST('/byaiService/auth/privilegeGrant/findAll', params, {
    responseCfg: {
      customHandle: true,
    },
  });
}

// 新增组织
export async function addOrg(params: any) {
  return POST('/byaiService/system/organization/addOrg', params, withCustomHandle);
}

// 修改组织
export async function updateOrg(params: any) {
  return POST('/byaiService/system/organization/updateOrg', params, withCustomHandle);
}

// 删除组织
export async function delOrg(params: any) {
  return POST('/byaiService/system/organization/delOrg', params, withCustomHandle);
}
