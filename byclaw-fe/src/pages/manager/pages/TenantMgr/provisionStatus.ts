export type TenantProvisionDisplayStatus =
  | 'RESERVED'
  | 'PROVISIONING'
  | 'READY'
  | 'FAILED'
  | 'MANUAL_REQUIRED'
  | 'DELETING'
  | 'DELETE_FAILED';

export function tenantProvisionDisplayStatus(state: string): TenantProvisionDisplayStatus {
  if (state === 'READY') return 'READY';
  if (state === 'MANUAL_REQUIRED') return 'MANUAL_REQUIRED';
  if (state === 'DELETING') return 'DELETING';
  if (state === 'DELETE_FAILED') return 'DELETE_FAILED';
  if (state === 'FAILED' || state === 'UNAVAILABLE' || !state) return 'FAILED';
  if (state === 'RESERVED') return 'RESERVED';
  return 'PROVISIONING';
}

/** Paused commands require an explicit administrative recovery and must not keep polling. */
export function shouldPollTenantProvision(state: string): boolean {
  return !['READY', 'FAILED', 'UNAVAILABLE', 'MANUAL_REQUIRED', 'DELETE_FAILED', 'DELETED'].includes(state);
}

export type ProvisionStepStatus = 'done' | 'active' | 'pending' | 'failed' | 'paused';

const stageIndex: Record<string, number> = {
  RESERVED: 0,
  DB_CREATING: 1,
  DB_CREATE: 1,
  DB_PROBE: 1,
  DB_PROVIDER_READY: 1,
  DB_ADMIN_VERIFIED: 1,
  REDIS_PUBLISHED: 2,
  CONFIG_PUBLISH: 2,
  NODE_CREATE: 2,
  NODE_CREATING: 2,
  NODE_STARTING: 2,
  ADMIN_ONLY: 3,
  SCHEMA_INIT: 3,
  VERIFYING: 3,
  READY_PUBLISH: 3,
  READY: 4,
};

export function tenantProvisionSteps(state: string, lastStage?: string): ProvisionStepStatus[] {
  const failed = state === 'FAILED';
  const paused = state === 'MANUAL_REQUIRED';
  // Durable commands expose their execution stage separately from their scheduling status.
  const current = stageIndex[lastStage || state] ?? 0;
  return [0, 1, 2, 3].map((index) => {
    if (state === 'READY' || index < current) return 'done';
    if (index > current) return 'pending';
    if (paused) return 'paused';
    return failed ? 'failed' : 'active';
  });
}
