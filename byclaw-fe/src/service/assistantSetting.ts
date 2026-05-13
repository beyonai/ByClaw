import { GET, POST } from '@/service/common/request';

// 获取基本信息
export const getUserSuas = (payload: any) => GET<any>(`/byaiService/assiman/getUserSuas?userId=${payload.userId}`);

// 更新
export const updateBySuperassistId = (payload: any) =>
  POST<any>('/byaiService/assiman/updateBySuperassistId', { ...payload });

// 查询用户已选择的资源权限
export const getUserResourcePrivileges = (payload: any) =>
  POST<any>('/byaiService/assiman/getUserSelectedResourcePrivileges', { ...payload });

// 助理资源权限保存
export const saveResourcePrivilege = (payload: any) =>
  POST<any>('/byaiService/assiman/saveResourcePrivilege', { ...payload });

// 查询用户全部可用资源列表
export const getUserAllAvailableResources = (payload: any) =>
  POST<any>('/byaiService/assiman/getUserAllAvailableResources', { ...payload });

// 查询模板列表（自定义记忆规则）
export const queryTemplateList = (payload: { templateType: string; resourceId?: string | number }) =>
  POST<any>('/byaiService/memory/queryTemplateList', { ...payload });

// 创建超级管理员模板（新增记忆规则）
export const createSuperAdminTemplate = (payload: { ruleName: string; ruleContent: string; templateType: string }) =>
  POST<any>('/byaiService/memory/createSuperAdminTemplate', { ...payload });

// 查询画像记忆/常问的问题
// export const queryEpisodicMemory = (payload: { memSceneId: string | number }, config?: ConfigType) =>
//   POST<any>('/byaiService/memory/queryEpisodicMemory', { ...payload }, config);

// 切换资源启用状态
export const toggleResourceEnabled = (payload: {
  templateType: string;
  templateId: string | number;
  resourceEnabled: boolean;
  resourceId?: string | number;
}) => POST<any>('/byaiService/memory/toggleResourceEnabled', { ...payload });

// 更新记忆规则场景
export const updateScene = (payload: { templateId: string | number; ruleName: string; ruleContent: string }) =>
  POST<any>('/byaiService/memory/updateScene', { ...payload });

// 删除记忆规则场景
export const deleteScene = (payload: { templateId: string | number }) =>
  POST<any>('/byaiService/memory/deleteScene', { ...payload });
