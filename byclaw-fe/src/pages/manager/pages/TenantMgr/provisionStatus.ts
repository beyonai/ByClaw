export type TenantProvisionDisplayStatus = '未开通' | '开通中' | '已开通' | '失败';

export function tenantProvisionDisplayStatus(state: string): TenantProvisionDisplayStatus {
  if (state === 'READY') return '已开通';
  if (state === 'FAILED' || state === 'UNAVAILABLE' || !state) return '失败';
  if (state === 'RESERVED') return '未开通';
  return '开通中';
}
