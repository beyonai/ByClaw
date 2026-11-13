const MAX_LONG = '9223372036854775807'

function isId(value: string): boolean {
  return /^[1-9][0-9]{0,18}$/.test(value) && (value.length < MAX_LONG.length || value <= MAX_LONG)
}

export interface TenantHarnessWorkerIdentity {
  workerId: string
  agentType: string
}

export function tenantHarnessWorkerIdentity(env: NodeJS.ProcessEnv): TenantHarnessWorkerIdentity | undefined {
  const tenantId = env.BYCLAW_HARNESS_TENANT_ID
  const workerId = env.BYCLAW_HARNESS_WORKER_ID
  if (tenantId === undefined && workerId === undefined) return undefined
  if (tenantId === undefined || !isId(tenantId)) {
    throw new Error('BYCLAW_HARNESS_TENANT_ID must be a canonical positive tenant ID')
  }

  const workerPrefix = `tenant-harness-${tenantId}-`
  if (!workerId?.startsWith(workerPrefix) || !isId(workerId.slice(workerPrefix.length))) {
    throw new Error('BYCLAW_HARNESS_WORKER_ID must contain the same tenant ID and a positive sandbox record ID')
  }
  return { workerId, agentType: `BYCLAW_DSH_TENANT_${tenantId}` }
}
