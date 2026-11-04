import { POST } from '@/service/common/request';

export type SyncProgress = {
  jobId: string;
  resourceId: string;
  syncRevision: string;
  status: string;
  effective: boolean;
  canRetry?: boolean;
  retryCount: number;
  retryLimit?: number;
  result: {
    phase?: string;
    message?: string;
    totalUsers?: number;
    completedUsers?: number;
    employeeCount?: number;
    completedEmployeeCount?: number;
    failedEmployeeCount?: number;
    skippedUserCount?: number;
    skipReasons?: Record<string, number>;
    authorizationEffective?: boolean;
  };
};
const config = { timeout: 15000, responseCfg: { customHandle: true } };
type Result<T> = { code: number; data: T; msg?: string };
export const querySyncProgress = (resourceIds: string[]) =>
  POST<Result<SyncProgress[]>>('/byaiService/tool/queryResourceSyncJobs', { resourceIds }, config);
export const retrySync = (jobId: string) =>
  POST<Result<SyncProgress>>('/byaiService/tool/retryResourceSyncJob', { jobId }, config);
