import { GET, POST } from '@/service/common/request';

export interface TenantAvailableItem {
  enterpriseId: string;
  enterpriseName: string;
  role: string;
  provisionState: string;
}

export const getAvailableTenants = () => GET<TenantAvailableItem[]>('/byaiService/tenantContext/available');

export const validateTenantSwitch = (enterpriseId: string) =>
  POST<{ enterpriseId: string; role: string; tenantContextToken: string; expiresAt: string; contextVersion: number }>(
    '/byaiService/tenantContext/switch',
    { enterpriseId }
  );
