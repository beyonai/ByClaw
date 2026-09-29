export type TenantProvisionDisplayStatus = '未开通' | '开通中' | '已开通' | '失败' | '删除中' | '删除失败';

export function tenantProvisionDisplayStatus(state: string): TenantProvisionDisplayStatus {
  if (state === 'READY') return '已开通';
  if (state === 'DELETING') return '删除中';
  if (state === 'DELETE_FAILED') return '删除失败';
  if (state === 'FAILED' || state === 'UNAVAILABLE' || !state) return '失败';
  if (state === 'RESERVED') return '未开通';
  return '开通中';
}

export type ProvisionStepStatus = 'done' | 'active' | 'pending' | 'failed';

const stageIndex: Record<string, number> = {
  RESERVED: 0,
  DB_CREATING: 1,
  DB_PROVIDER_READY: 1,
  DB_ADMIN_VERIFIED: 1,
  REDIS_PUBLISHED: 2,
  NODE_CREATING: 2,
  NODE_STARTING: 2,
  ADMIN_ONLY: 3,
  SCHEMA_INIT: 3,
  VERIFYING: 3,
  READY: 4,
};

export function tenantProvisionSteps(state: string, lastStage?: string): ProvisionStepStatus[] {
  const failed = state === 'FAILED';
  const current = stageIndex[failed ? lastStage || '' : state] ?? 0;
  return [0, 1, 2, 3].map((index) => {
    if (state === 'READY' || index < current) return 'done';
    if (index > current) return 'pending';
    return failed ? 'failed' : 'active';
  });
}
