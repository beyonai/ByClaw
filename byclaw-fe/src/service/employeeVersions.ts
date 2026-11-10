import { GET, POST } from '@/service/common/request';

export interface EmployeeVersion {
  id: string;
  number: number;
  name: string;
  authorId: string;
  createdAt: string;
  note?: string;
  source: string;
  baseVersionId?: string;
  active: boolean;
  latest: boolean;
  configuration?: Record<string, unknown>;
}
export interface EmployeeVersionHistory {
  resourceId: string;
  revision: string;
  activeVersionId: string;
  latestVersionId: string;
  requiresReview: boolean;
  versions: EmployeeVersion[];
  syncStatus: string;
  syncError?: string;
}
export interface EmployeeVersionResult {
  versionId: string;
  revision: string;
  status: string;
  publicationId?: string;
}
const base = '/byaiService/digitalEmployeeVersions';
export const getEmployeeVersions = (resourceId: string, page = 1) =>
  POST<EmployeeVersionHistory>(`${base}/history`, { resourceId, page, size: 20 });
export const getEmployeeVersion = (resourceId: string, versionId: string) =>
  GET<EmployeeVersion>(`${base}/detail`, { resourceId, versionId });
export const saveEmployeeVersion = (request: {
  resourceId: string;
  expectedRevision: string;
  baseVersionId?: string;
  requestId: string;
  activate: boolean;
  employee: unknown;
  note?: string;
}) => POST<EmployeeVersionResult>(`${base}/save`, request);
export const activateEmployeeVersion = (request: {
  resourceId: string;
  versionId: string;
  expectedRevision: string;
  requestId: string;
}) => POST<EmployeeVersionResult>(`${base}/activate`, request);
export const retryEmployeeVersion = (resourceId: string) =>
  POST<EmployeeVersionResult>(`${base}/retry`, { resourceId });
export const versionCompareUrl = (resourceId: string, left: string, right: string) =>
  `/employeeVersionCompare?resourceId=${encodeURIComponent(resourceId)}&left=${encodeURIComponent(
    left
  )}&right=${encodeURIComponent(right)}`;
