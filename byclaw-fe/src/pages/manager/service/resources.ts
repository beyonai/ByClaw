import { GET, POST } from '@/service/common/request';

export interface FixedEntryOperationCapability {
  canImportEnterpriseKg: boolean;
  canImportEnterpriseToolkit: boolean;
  canImportEnterpriseView: boolean;
  canImportEnterpriseObject: boolean;
}

export interface ResourceImportDiffItem {
  section: string;
  changeType: string;
  fieldCode: string;
  fieldName: string;
  beforeValue: string;
  afterValue: string;
  description: string;
}

export interface ResourceImportItem {
  catalogId?: number;
  catalogName?: string;
  resourceCode: string;
  resourceName: string;
  resourceDesc?: string;
  resourceBizType?: string;
  resourceId?: string;
  updated: boolean;
  success: boolean;
  message?: string;
  diffSummary?: string;
  diffDetails?: ResourceImportDiffItem[];
}

export interface ResourceImportResult {
  total: number;
  success: number;
  failed: number;
  createdCount?: number;
  updatedCount?: number;
  zipFileName?: string;
  createdItems?: ResourceImportItem[];
  updatedItems?: ResourceImportItem[];
  items?: ResourceImportItem[];
}

export interface ResourceUseApplyParams {
  resourceId: string | number;
}

export interface ResourceUseApplyAuditItem {
  privilegeGrantId: string;
  userId: string;
  userName: string;
  applyTime: string;
  applyStatus: string;
}

export interface ApproveResourceUseApplyParams {
  resourceId: string | number;
  applyUserId: string | number;
}

// 资源导入
export function importResource(resourceType: string, fileType: string, data: FormData) {
  // 确定资源类型的映射
  const resourceMap: Record<string, string> = {
    KG_DOC: 'Dataset',
    TOOL: 'Tool',
    VIEW: 'View',
    OBJECT: 'Object',
    SKILL: 'Skill',
  };

  // 获取对应的资源名称
  const resourceUrl = resourceMap[resourceType] || 'Resource';

  // 确定文件后缀
  const fileSuffix = fileType.toLowerCase() === 'zip' ? 'Zip' : 'Json';

  // 构建API路径
  let apiPath = '';
  if (resourceType === 'KG_DOC') {
    // 知识库使用不同的API路径
    apiPath = `/byaiService/datasetController/import${resourceUrl}${fileSuffix}`;
  } else {
    // 其他资源使用相同的API路径结构
    apiPath = `/byaiService/tool/import${resourceUrl}${fileSuffix}`;
  }

  return POST<ResourceImportResult>(apiPath, data, {
    timeout: 480000,
    headers: {
      'Content-Type': 'multipart/form-data; charset=utf-8',
    },
  });
}

// 资源列表
export function listResourceUseAuth(params: any) {
  return POST<any>('/byaiService/auth/privilegeGrant/listResourceUseAuth', params);
}

// 查询数字员工关联资源列表
export function queryDigEmployeeRelResourceAuth(params: any) {
  return POST<any>('/byaiService/auth/privilegeGrant/queryDigEmployeeRelResourceAuth', params);
}

export function queryFixedEntryOperationCapability() {
  return GET<FixedEntryOperationCapability>('/byaiService/auth/privilegeGrant/queryFixedEntryOperationCapability');
}

export function applyResourceUse(params: ResourceUseApplyParams) {
  return POST('/byaiService/auth/privilegeGrant/applyUse', params, {
    responseCfg: {
      customHandle: true,
    },
  });
}

export function queryUseApplyList(params: ResourceUseApplyParams) {
  return POST<ResourceUseApplyAuditItem[]>('/byaiService/auth/privilegeGrant/queryUseApplyList', params, {
    responseCfg: {
      customHandle: true,
    },
  });
}

export function approveUseApply(params: ApproveResourceUseApplyParams) {
  return POST('/byaiService/auth/privilegeGrant/approveUseApply', params, {
    responseCfg: {
      customHandle: true,
    },
  });
}

export function rejectUseApply(params: ApproveResourceUseApplyParams) {
  return POST('/byaiService/auth/privilegeGrant/rejectUseApply', params, {
    responseCfg: {
      customHandle: true,
    },
  });
}

// 资源详情
export const queryResourceDetail = (params: any) => {
  return POST<any>('/byaiService/tool/queryResourceDetail', params);
};

// 根据资源 sourceContent 生成测试 curl
export const generateResourceCurl = (params: { resourceId: string | number }) =>
  POST<any>('/byaiService/tool/generateResourceCurl', params);

// 运行资源测试 curl
export const runResourceCurl = (params: { resourceId: string | number; curl: string }) =>
  POST<any>('/byaiService/tool/runResourceCurl', params, {
    timeout: 60000,
  });

// 资源明细(对象、属性等)
export async function queryResourceMembers(params: any) {
  return POST<any>('/byaiService/auth/privilegeGrant/queryResourceMembers', params);
}

// 资源删除
export function deleteResource(params: any) {
  return POST<any>('/byaiService/tool/deleteResourceById', params);
}

// 空间列表
export const qryByClawFileByUserCode = (params: any) => POST<any>('/byaiService/tool/qryByClawFileByUserCode', params);

// 技能列表
export const qrySkillListByUserCode = (params: any) => POST<any>('/byaiService/tool/qrySkillListByUserCode', params);

// 空间文件下载
export const readFile = (params: any) =>
  POST<any>('/byaiService/open/api/v1/conversation/read', params, { responseType: 'blob' });

// 知识删除
export const deleteKnowledge = (data: any) => POST<any>('/byaiService/datasetController/deleteDataset', data);

// 查询资源操作权限
export interface ResourceOperationPermissions {
  resourceId: string;
  ownerType: string;
  resourceBizType: string;
  canEdit: boolean;
  canManageAuth: boolean;
  canUseAuth: boolean;
  canDelete: boolean;
  canApplyUse: boolean;
  canAuditUse: boolean;
  canSetDefault: boolean;
}

export const queryResourceOperationPermissions = (params: { resourceId: string | number }) =>
  POST<ResourceOperationPermissions>('/byaiService/auth/privilegeGrant/queryResourceOperationPermissions', params);
