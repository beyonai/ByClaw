import { POST } from '@/service/common/request';

export interface TenantTable {
  schema: string;
  name: string;
  type: string;
}

export interface TenantColumn {
  name: string;
  type: string;
}

export interface TenantQueryResult {
  columns: TenantColumn[];
  rows: (string | null)[][];
  affectedRows: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  truncated: boolean;
}

export const listTenantTables = (enterpriseId: string) =>
  POST<TenantTable[]>('/byaiService/admin/tenant-datasource/tables', { enterpriseId });

export const browseTenantTable = (enterpriseId: string, schema: string, table: string, page: number) =>
  POST<TenantQueryResult>('/byaiService/admin/tenant-datasource/browse', {
    enterpriseId,
    schema,
    table,
    page,
  });

export const executeTenantSql = (enterpriseId: string, sql: string, page: number, confirmed: boolean) =>
  POST<TenantQueryResult>('/byaiService/admin/tenant-datasource/execute', { enterpriseId, sql, page, confirmed });
