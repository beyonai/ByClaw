import { POST } from '@/service/common/request';

export interface DataSource {
  datasourceId: string | number;
  datasourceName: string;
  description?: string;
  datasourceType: string;
  connectionConfig: Record<string, string | number>;
  hasPassword: boolean;
  canEdit: boolean;
  canManageBinding: boolean;
}

export interface DataSourceInput {
  datasourceName: string;
  description?: string;
  datasourceType: string;
  connectionConfig: Record<string, string | number>;
  password?: string;
}

const base = '/byaiService/api/v1/projectDataSources';
export const listDataSources = (projectId: number): Promise<DataSource[]> => POST(`${base}/list`, { projectId });
export const availableDataSources = (projectId: number): Promise<DataSource[]> =>
  POST(`${base}/available`, { projectId });
export const saveDataSource = (
  projectId: number,
  input: DataSourceInput,
  datasourceId?: string | number
): Promise<DataSource> =>
  POST(`${base}/${datasourceId === undefined ? 'create' : 'update'}`, { projectId, ...input, datasourceId });
export const changeDataSourceBinding = (
  action: 'bind' | 'unbind' | 'delete',
  projectId: number,
  datasourceId: string | number
): Promise<void> => POST(`${base}/${action}`, { projectId, datasourceId });
export const querySessionDataSources = (
  sessionId: string,
  pageNum = 1
): Promise<{
  items: DataSource[];
  total: number;
  pageNum: number;
  pageSize: number;
}> =>
  POST<{ items: DataSource[]; total: number | string; pageNum: number | string; pageSize: number | string }>(
    '/byaiService/api/v1/sessionResources/query',
    { sessionId, resourceType: 'data_source', pageNum, pageSize: 50 }
  ).then((result) => ({
    ...result,
    total: Number(result.total),
    pageNum: Number(result.pageNum),
    pageSize: Number(result.pageSize),
  }));
