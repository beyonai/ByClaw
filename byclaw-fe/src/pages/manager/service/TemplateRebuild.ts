import { POST } from '@/service/common/request';

export interface TemplateRebuildRecord {
  id: string;
  serviceKey: string;
  serviceName: string;
  actorCode: string;
  actorName: string;
  createdAt: number;
  updatedAt: number;
  state: 'NEW' | 'BUILDING' | 'SUCCEEDED' | 'FAILED';
  profileKey?: string;
  templateId?: string;
  templateName?: string;
  errorCode?: string;
}

async function call<T>(operation: string, params: object = {}): Promise<T> {
  const response = await POST(`/byaiService/sandbox/templateRebuild/${operation}`, params, {
    responseCfg: { customHandle: true },
  });
  if (response?.code !== 0) throw new Error(response?.msg || '模板重建操作失败');
  return response.data as T;
}

export const getTemplateRebuildCapabilities = () => call<{ supported: boolean }>('capabilities');
export const startTemplateRebuild = (serviceKey: string, requestId: string) =>
  call<TemplateRebuildRecord>('start', { serviceKey, requestId });
export const listTemplateRebuildRecords = (serviceKey: string, pageNo: number, pageSize: number) =>
  call<{ records: TemplateRebuildRecord[]; total: number }>('records', { serviceKey, pageNo, pageSize });
