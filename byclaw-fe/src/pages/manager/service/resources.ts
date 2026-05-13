import { GET, POST } from '@/service/common/request';

/**
 * 固定入口操作能力接口返回数据类型
 * 用于判断当前用户是否具备导入企业知识库、工具包、视图、对象等资源的能力
 */
export interface FixedEntryOperationCapability {
  canImportEnterpriseKg: boolean; // 是否能导入企业知识库
  canImportEnterpriseToolkit: boolean; // 是否能导入企业工具包
  canImportEnterpriseView: boolean; // 是否能导入企业视图
  canImportEnterpriseObject: boolean; // 是否能导入企业对象
}

/**
 * 资源导入差异项
 * 记录资源导入过程中的具体变更内容
 */
export interface ResourceImportDiffItem {
  section: string; // 变更所属板块/模块
  changeType: string; // 变更类型（如：add/update/delete）
  fieldCode: string; // 字段编码
  fieldName: string; // 字段名称
  beforeValue: string; // 变更前值
  afterValue: string; // 变更后值
  description: string; // 变更描述
}

/**
 * 资源导入项
 * 单个资源导入的结果记录
 */
export interface ResourceImportItem {
  catalogId?: number; // 目录ID
  catalogName?: string; // 目录名称
  resourceCode: string; // 资源编码
  resourceName: string; // 资源名称
  resourceDesc?: string; // 资源描述
  resourceBizType?: string; // 资源业务类型
  resourceId?: string; // 资源ID
  updated: boolean; // 是否为更新操作
  success: boolean; // 是否导入成功
  message?: string; // 导入消息/错误信息
  diffSummary?: string; // 差异摘要
  diffDetails?: ResourceImportDiffItem[]; // 差异详情列表
}

/**
 * 资源导入结果
 * 批量资源导入操作的总体结果
 */
export interface ResourceImportResult {
  total: number; // 总数
  success: number; // 成功数
  failed: number; // 失败数
  createdCount?: number; // 新增数量
  updatedCount?: number; // 更新数量
  zipFileName?: string; // 导入的ZIP文件名
  createdItems?: ResourceImportItem[]; // 创建成功的资源列表
  updatedItems?: ResourceImportItem[]; // 更新成功的资源列表
  items?: ResourceImportItem[]; // 所有资源项列表
}

/**
 * 资源使用申请参数
 */
export interface ResourceUseApplyParams {
  resourceId: string | number; // 资源ID
}

/**
 * 资源使用申请审核项
 * 记录单个资源使用申请的详细信息
 */
export interface ResourceUseApplyAuditItem {
  privilegeGrantId: string; // 权限授权ID
  userId: string; // 用户ID
  userName: string; // 用户名称
  applyTime: string; // 申请时间
  applyStatus: string; // 申请状态（如：pending/approved/rejected）
}

/**
 * 审批资源使用申请参数
 */
export interface ApproveResourceUseApplyParams {
  resourceId: string | number; // 资源ID
  applyUserId: string | number; // 申请用户ID
}

/**
 * 资源导入函数
 * 支持导入知识库(KG_DOC)、工具(TOOL)、视图(VIEW)、对象(OBJECT)、技能(SKILL)等资源类型
 * @param resourceType 资源类型（如：KG_DOC、TOOL、VIEW、OBJECT、SKILL）
 * @param fileType 文件类型（zip 或 json）
 * @param data FormData格式的导入文件数据
 * @returns Promise<ResourceImportResult> 导入结果
 */
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

/**
 * 获取当前用户有权限使用的资源列表
 * @param params 查询参数（包含keyword等）
 * @returns Promise 资源列表
 */
export function listResourceUseAuth(params: any) {
  return POST<any>('/byaiService/auth/privilegeGrant/listResourceUseAuth', params);
}

/**
 * 查询数字员工关联的资源列表
 * 根据数字员工ID查询其关联的所有资源
 * @param params 查询参数（包含resourceId数字员工ID、keyword搜索关键字等）
 * @returns Promise 数字员工关联资源列表
 */
export function queryDigEmployeeRelResourceAuth(params: any) {
  return POST<any>('/byaiService/auth/privilegeGrant/queryDigEmployeeRelResourceAuth', params);
}

/**
 * 查询固定入口操作能力
 * 获取当前用户在固定入口（如企业工作台）可进行的操作权限
 * @returns Promise<FixedEntryOperationCapability> 操作能力对象
 */
export function queryFixedEntryOperationCapability() {
  return GET<FixedEntryOperationCapability>('/byaiService/auth/privilegeGrant/queryFixedEntryOperationCapability');
}

/**
 * 申请资源使用权限
 * 当用户没有资源使用权限时，可提交使用申请
 * @param params 申请参数（包含resourceId资源ID）
 * @returns Promise 申请结果
 */
export function applyResourceUse(params: ResourceUseApplyParams) {
  return POST('/byaiService/auth/privilegeGrant/applyUse', params, {
    responseCfg: {
      customHandle: true,
    },
  });
}

/**
 * 查询资源使用申请列表
 * 管理员可查看所有待审批的资源使用申请
 * @param params 查询参数（包含resourceId资源ID）
 * @returns Promise<ResourceUseApplyAuditItem[]> 申请列表
 */
export function queryUseApplyList(params: ResourceUseApplyParams) {
  return POST<ResourceUseApplyAuditItem[]>('/byaiService/auth/privilegeGrant/queryUseApplyList', params, {
    responseCfg: {
      customHandle: true,
    },
  });
}

/**
 * 审批资源使用申请
 * 管理员批准用户提交的资源使用申请
 * @param params 审批参数（包含resourceId资源ID、applyUserId申请用户ID）
 * @returns Promise 审批结果
 */
export function approveUseApply(params: ApproveResourceUseApplyParams) {
  return POST('/byaiService/auth/privilegeGrant/approveUseApply', params, {
    responseCfg: {
      customHandle: true,
    },
  });
}

/**
 * 驳回资源使用申请
 * 管理员驳回用户提交的资源使用申请
 * @param params 驳回参数（包含resourceId资源ID、applyUserId申请用户ID）
 * @returns Promise 驳回结果
 */
export function rejectUseApply(params: ApproveResourceUseApplyParams) {
  return POST('/byaiService/auth/privilegeGrant/rejectUseApply', params, {
    responseCfg: {
      customHandle: true,
    },
  });
}

/**
 * 查询资源详情
 * 获取单个资源的详细信息
 * @param params 查询参数（包含resourceId资源ID）
 * @returns Promise 资源详情
 */
export const queryResourceDetail = (params: any) => {
  return POST<any>('/byaiService/tool/queryResourceDetail', params);
};

/**
 * 根据资源sourceContent生成测试curl命令
 * 用于在沙箱环境中测试资源调用
 * @param params 参数（包含resourceId资源ID）
 * @returns Promise 生成的curl命令字符串
 */
export const generateResourceCurl = (params: { resourceId: string | number }) =>
  POST<any>('/byaiService/tool/generateResourceCurl', params);

/**
 * 运行资源测试curl命令
 * 在沙箱环境中执行生成的curl命令进行资源测试
 * @param params 参数（包含resourceId资源ID、curl curl命令字符串）
 * @returns Promise 测试执行结果
 */
export const runResourceCurl = (params: { resourceId: string | number; curl: string }) =>
  POST<any>('/byaiService/tool/runResourceCurl', params, {
    timeout: 60000,
  });

/**
 * 查询资源成员/明细信息
 * 获取资源的详细成员列表或属性信息（适用于对象、视图等资源类型）
 * @param params 查询参数（包含resourceId资源ID）
 * @returns Promise 资源成员/明细数据
 */
export async function queryResourceMembers(params: any) {
  return POST<any>('/byaiService/auth/privilegeGrant/queryResourceMembers', params);
}

/**
 * 删除资源
 * 根据资源ID删除指定资源
 * @param params 删除参数（包含resourceId资源ID）
 * @returns Promise 删除结果
 */
export function deleteResource(params: any) {
  return POST<any>('/byaiService/tool/deleteResourceById', params);
}

/**
 * 查询用户空间文件列表
 * 获取用户在知识库空间中的文件列表
 * @param params 查询参数（包含userCode用户编码、keyword搜索关键字、sessionId会话ID）
 * @returns Promise 文件列表
 */
export const qryByClawFileByUserCode = (params: any) => POST<any>('/byaiService/tool/qryByClawFileByUserCode', params);

/**
 * 查询用户技能列表
 * 获取用户可用的技能列表
 * @param params 查询参数（包含userCode用户编码、keyword搜索关键字、resourceId资源ID）
 * @returns Promise 技能列表
 */
export const qrySkillListByUserCode = (params: any) => POST<any>('/byaiService/tool/qrySkillListByUserCode', params);

/**
 * 读取空间文件内容
 * 下载或读取指定路径的文件内容
 * @param params 读取参数（包含userCode用户编码、sessionId会话ID、filePath文件路径、objectKey对象Key）
 * @returns Promise 文件内容（Blob格式）
 */
export const readFile = (params: any) =>
  POST<any>('/byaiService/open/api/v1/conversation/read', params, { responseType: 'blob' });

/**
 * 删除知识库
 * 根据数据集ID删除知识库
 * @param data 删除参数（包含datasetId数据集ID等）
 * @returns Promise 删除结果
 */
export const deleteKnowledge = (data: any) => POST<any>('/byaiService/datasetController/deleteDataset', data);

/**
 * 资源操作权限
 * 记录用户对某个资源的详细操作权限
 */
export interface ResourceOperationPermissions {
  resourceId: string; // 资源ID
  ownerType: string; // 所有者类型
  resourceBizType: string; // 资源业务类型
  canEdit: boolean; // 是否有编辑权限
  canManageAuth: boolean; // 是否有管理权限权限
  canUseAuth: boolean; // 是否有使用权限
  canDelete: boolean; // 是否有删除权限
  canApplyUse: boolean; // 是否可以申请使用
  canAuditUse: boolean; // 是否有审核权限
  canSetDefault: boolean; // 是否有设为默认权限
}

/**
 * 查询资源操作权限
 * 获取当前用户对指定资源的详细操作权限
 * @param params 查询参数（包含resourceId资源ID）
 * @returns Promise<ResourceOperationPermissions> 资源操作权限对象
 */
export const queryResourceOperationPermissions = (params: { resourceId: string | number }) =>
  POST<ResourceOperationPermissions>('/byaiService/auth/privilegeGrant/queryResourceOperationPermissions', params);

/**
 * 文件/文件夹项
 * 用户空间文件列表中的单个文件或文件夹
 */
export interface FileItem {
  name: string; // 文件/文件夹名称
  filePath: string; // 文件/文件夹路径
  dir: boolean; // 是否为文件夹（true-文件夹，false-文件）
}

/**
 * 查询用户空间文件列表
 * 获取用户在指定路径下的文件列表，支持文件夹下钻查询
 * @param params 查询参数
 * @param params.prefix 文件路径前缀（如：by/.openclaw/workspace-baiying-agent-10006728/）
 * @param params.resourceId 资源ID（可选，用于指定数字员工等资源关联）
 * @returns Promise<FileItem[]> 文件列表数组
 */
export const listUserSpace = async (params: { prefix: string; resourceId?: string | number }) => {
  return await POST<any>('/byaiService/tool/listUserSpace', params);
};
