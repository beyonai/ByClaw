import { DomainError } from "./errors.js";

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
export interface AuthorityVersion {
  generation: string;
  fencingToken: string;
  credentialVersion: string;
}
export function assertTenant(actual: TenantIdentity, expected: TenantIdentity): void {
  if (actual.enterpriseId !== expected.enterpriseId) throw new DomainError("TENANT_MISMATCH");
  if (actual.generation !== expected.generation) throw new DomainError("GENERATION_MISMATCH");
  if (actual.dbSandboxRecordId !== expected.dbSandboxRecordId)
    throw new DomainError("DB_INSTANCE_MISMATCH");
}
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
