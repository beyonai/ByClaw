import { GET, POST } from '@/service/common/request';

export const PLATFORM_ENTERPRISE_ID = '1';
export const TENANT_HARNESS_TYPE = 'tenant-harness';

export interface TenantHarnessState {
  status: 'NOT_REQUESTED' | 'PENDING' | 'RUNNING' | 'RETRY_WAIT' | 'SUCCEEDED' | 'MANUAL_REQUIRED' | 'FAILED';
  workerReady: boolean;
  taskId?: string | null;
  recordId?: string | null;
  sandboxId?: string | null;
  profileKey?: string | null;
  errorCode?: string | null;
}

const platformTenantHarnessPath = `/byaiService/admin/tenants/${PLATFORM_ENTERPRISE_ID}/harness`;
const inlineError = { responseCfg: { hideErrorTips: true } };

export const getPlatformTenantHarness = () => GET<TenantHarnessState>(platformTenantHarnessPath, {}, inlineError);
export const ensurePlatformTenantHarness = (profileKey: string) =>
  POST<TenantHarnessState>(`${platformTenantHarnessPath}/ensure`, { profileKey }, inlineError);

export interface TenantItem {
  enterpriseId: string;
  enterpriseName: string;
  packageName: string;
  provisionState: string;
  provisionStage?: string;
  createdAt: string | null;
  openedAt: string | null;
  failureReason: string | null;
}

export interface TenantListFilter {
  name?: string;
  createdFrom?: string;
  createdTo?: string;
  sortField?: 'createdAt' | 'openedAt' | 'enterpriseName';
  sortOrder?: 'asc' | 'desc';
}

export interface TenantPackage {
  id: number;
  packageName: string;
  packageContent: string;
}

export interface TenantOrganization {
  orgId: string;
  parentOrgId: string;
  orgName: string;
  orgIndex: number;
  memberCount: number;
  attached: boolean;
}

export interface TenantOrganizationMember {
  userId: string;
  userCode: string;
  userName: string;
  alreadyMember: boolean;
}

export const listTenants = (filter: TenantListFilter = {}) =>
  POST<TenantItem[]>('/byaiService/admin/tenants/list', filter);
export const listTenantPackages = () => POST<TenantPackage[]>('/byaiService/admin/tenants/packages/list', {});
export const createTenant = (data: { enterpriseName: string; packageId: number; requestId: string }) =>
  POST<TenantItem>('/byaiService/admin/tenants/create', data);
export const provisionTenant = (enterpriseId: string) =>
  POST<string>('/byaiService/admin/tenants/provision', { enterpriseId });
export const deleteTenant = (enterpriseId: string, enterpriseName: string) =>
  POST<string>('/byaiService/admin/tenants/delete', { enterpriseId, enterpriseName });
export const restartTenantSandbox = (data: { enterpriseId: string; sandboxType: string; recordId: number }) =>
  POST<string>('/byaiService/admin/tenants/sandboxes/restart', data);
export const addTenantMember = (enterpriseId: string, userCode: string) =>
  POST('/byaiService/admin/tenants/members/add', { enterpriseId, userCode });
export const listTenantOrganizations = (enterpriseId: string) =>
  POST<TenantOrganization[]>('/byaiService/admin/tenants/organizations/tree', { enterpriseId });
export const listTenantOrganizationMembers = (enterpriseId: string, orgId: string, includeDescendants = true) =>
  POST<TenantOrganizationMember[]>('/byaiService/admin/tenants/organizations/members', {
    enterpriseId,
    orgId,
    includeDescendants,
  });
export const attachTenantOrganization = (
  enterpriseId: string,
  orgId: string,
  includeDescendants: boolean,
  addMembers: boolean
) =>
  POST<{ attachedOrganizations: number; addedMembers: number; existingMembers: number }>(
    '/byaiService/admin/tenants/organizations/attach',
    { enterpriseId, orgId, includeDescendants, addMembers }
  );
