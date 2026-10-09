import { GET, POST, request } from '@/service/common/request';

export type WorkgroupTemplateEmployee = {
  id: string;
  name: string;
  description?: string;
  teamRole?: string;
};

export type WorkgroupTemplate = {
  template: {
    templateId: string;
    templateName: string;
    catalogId: string;
    summary: string;
    defaultGroupName: string;
    defaultGoal: string;
    icon?: string;
    sortOrder?: number;
    status: 'ENABLED' | 'DISABLED';
    version: number;
  };
  catalogName: string;
  resources: Array<{
    resourceId: string;
    resourceName: string;
    resourceType?: 'DIGITAL_EMPLOYEE' | 'DIGITAL_EMPLOYEE_GROUP';
    avatar?: string;
    resourceVersion?: string;
    employees: WorkgroupTemplateEmployee[];
  }>;
  employees: WorkgroupTemplateEmployee[];
  available?: boolean;
  unavailableReason?: string;
};

export const getWorkgroupTemplateCapability = () => GET<boolean>('/byaiService/workgroup-templates/manage-capability');
// 管理页统一显示接口返回的错误，关闭 HTTP 200 业务失败时的全局重复提示。
const managedTemplateConfig = { responseCfg: { hideErrorTips: true } };
export const listManagedWorkgroupTemplates = () =>
  GET<WorkgroupTemplate[]>('/byaiService/workgroup-templates/admin', {}, managedTemplateConfig);
export const createManagedWorkgroupTemplate = (payload: Record<string, unknown>) =>
  POST('/byaiService/workgroup-templates/admin', payload, managedTemplateConfig);
export const updateManagedWorkgroupTemplate = (id: string, payload: Record<string, unknown>) =>
  request(`/byaiService/workgroup-templates/admin/${encodeURIComponent(id)}`, payload, managedTemplateConfig, 'PUT');
export const deleteManagedWorkgroupTemplate = (id: string, expectedVersion: number) =>
  request(
    `/byaiService/workgroup-templates/admin/${encodeURIComponent(id)}?expectedVersion=${expectedVersion}`,
    {},
    managedTemplateConfig,
    'DELETE'
  );

export const listWorkgroupTemplateCatalogs = () =>
  POST<any[]>('/byaiService/catalog/queryCatalogTree', { catalogType: 6, keyword: '' });
