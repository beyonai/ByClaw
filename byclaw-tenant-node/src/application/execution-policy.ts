import { DomainError } from "../domain/errors.js";
import type { SharedQuotaReader } from "./shared-quota.js";

export interface PolicyMarkerReader {
  hget(key: string, field: string): Promise<string | null>;
}

/** Reuse published access state; incomplete quota consumers are not a blanket commercial write denial. */
export async function requireExecutionPolicy(
  redis: PolicyMarkerReader,
  enterpriseId: string,
  commercialManaged: boolean,
  policies: SharedQuotaReader,
): Promise<void> {
  let managed: boolean;
  try {
    // Re-read per command so a warm worker cannot retain an obsolete admission decision.
    const marker = await redis.hget(`TENANT_CONFIG_${enterpriseId}`, "COMMERCIAL_MANAGED");
    managed = commercialManaged || (marker !== null && marker !== "false");
  } catch {
    throw new DomainError("POLICY_UNAVAILABLE");
  }
  if (!managed) return;
  let policy;
  try {
    policy = await policies.read(enterpriseId);
  } catch {
    throw new DomainError("POLICY_UNAVAILABLE");
  }
  // Missing publication cannot erase PREPARED, suspension or expiry for a managed tenant.
  if (!policy || policy.enterpriseId !== enterpriseId) throw new DomainError("POLICY_UNAVAILABLE");
  if (policy.accessMode !== "ENABLED") throw new DomainError("POLICY_EXECUTION_DISABLED");
  const from = Date.parse(policy.effectiveFrom ?? ""), until = Date.parse(policy.effectiveTo ?? "");
  const now = Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until || now < from || now >= until)
    throw new DomainError("POLICY_NOT_EFFECTIVE");
}
