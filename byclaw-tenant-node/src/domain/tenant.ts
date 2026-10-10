import { DomainError } from "./errors.js";

/** 进程固定身份；请求只能匹配该企业、代际和数据库实例，不能选择其他租户库。 */
export interface TenantIdentity {
  enterpriseId: string;
  generation: string;
  dbSandboxRecordId: string;
}
export interface TenantSnapshot extends TenantIdentity {
  host: string;
  port: number;
  database: string;
  user: string;
  passwordEnvelope: string;
  credentialVersion: string;
  fencingToken: string;
  leaseUntil: string;
  status: string;
  step?: string;
}
/** 持久保存已接受的版本下限，重启后仍拒绝旧配置回退。 */
export interface AuthorityVersion {
  generation: string;
  fencingToken: string;
  credentialVersion: string;
}
/** 拒绝企业、代际或数据库实例错配。 */
export function assertTenant(actual: TenantIdentity, expected: TenantIdentity): void {
  if (actual.enterpriseId !== expected.enterpriseId) throw new DomainError("TENANT_MISMATCH");
  if (actual.generation !== expected.generation) throw new DomainError("GENERATION_MISMATCH");
  if (actual.dbSandboxRecordId !== expected.dbSandboxRecordId)
    throw new DomainError("DB_INSTANCE_MISMATCH");
}
/** 允许开通管理阶段，但拒绝失效租约、停用状态及权威版本回退。 */
export function assertAuthority(snapshot: TenantSnapshot, previous?: AuthorityVersion): void {
  if (Date.parse(snapshot.leaseUntil) <= Date.now()) throw new DomainError("LEASE_EXPIRED");
  const bootStep =
    snapshot.status === "PROVISIONING" &&
    ["REDIS_PUBLISHED", "NODE_CREATING", "ADMIN_ONLY", "SCHEMA_INIT", "VERIFYING"].includes(
      snapshot.step ?? "",
    );
  if (
    !bootStep &&
    ![
      "REDIS_PUBLISHED",
      "NODE_CREATING",
      "ADMIN_ONLY",
      "SCHEMA_INIT",
      "VERIFYING",
      "READY",
    ].includes(snapshot.status)
  )
    throw new DomainError("TENANT_UNAVAILABLE");
  if (!previous) return;
  for (const key of ["generation", "fencingToken", "credentialVersion"] as const) {
    if (BigInt(snapshot[key]) < BigInt(previous[key])) throw new DomainError("AUTHORITY_ROLLBACK");
  }
}
