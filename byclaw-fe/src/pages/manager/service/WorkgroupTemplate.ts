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
export const listManagedWorkgroupTemplates = () => GET<WorkgroupTemplate[]>('/byaiService/workgroup-templates/admin');
export const createManagedWorkgroupTemplate = (payload: Record<string, unknown>) =>
  POST('/byaiService/workgroup-templates/admin', payload);
export const updateManagedWorkgroupTemplate = (id: string, payload: Record<string, unknown>) =>
  request(`/byaiService/workgroup-templates/admin/${encodeURIComponent(id)}`, payload, {}, 'PUT');
export const deleteManagedWorkgroupTemplate = (id: string, expectedVersion: number) =>
  request(
    `/byaiService/workgroup-templates/admin/${encodeURIComponent(id)}?expectedVersion=${expectedVersion}`,
    {},
    {},
    'DELETE'
  );

export const listWorkgroupTemplateCatalogs = () =>
  POST<any[]>('/byaiService/catalog/queryCatalogTree', { catalogType: 6, keyword: '' });
