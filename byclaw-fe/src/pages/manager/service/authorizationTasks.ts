import { GET, POST } from '@/service/common/request';

const base = '/byaiService/auth/privilegeGrant/tasks';
const config = { timeout: 15000, responseCfg: { customHandle: true } };

export type AuthorizationTask = {
  taskId: string;
  requestId: string;
  operation: 'USE' | 'MANAGE';
  status: 'QUEUED' | 'RUNNING' | 'RETRYING' | 'FAILED' | 'SUCCEEDED' | 'CANCELLED';
  phase: string;
  progress: number;
  completedUsers: number;
  totalUsers: number;
  dataApplied: number;
  message: string;
};
type Result<T> = { code: number; data: T; msg?: string };

export const submitAuthorizationTask = (data: any) => POST<Result<AuthorizationTask>>(base, data, config);
export const listAuthorizationTasks = (resourceId: string) =>
  GET<Result<AuthorizationTask[]>>(base, { resourceId }, config);
export const getAuthorizationTask = (id: string) => GET<Result<AuthorizationTask>>(`${base}/${id}`, {}, config);
export const retryAuthorizationTask = (id: string) =>
  POST<Result<AuthorizationTask>>(`${base}/${id}/retry`, {}, config);
export const cancelAuthorizationTask = (id: string) =>
  POST<Result<AuthorizationTask>>(`${base}/${id}/cancel`, {}, config);
