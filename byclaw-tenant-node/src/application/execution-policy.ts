import { DomainError } from "../domain/errors.js";

export interface PolicyMarkerReader {
  hget(key: string, field: string): Promise<string | null>;
}

/** Commercial writes stay closed until the Node has durable policy and quota consumers. */
export async function requireExecutionPolicy(
  redis: PolicyMarkerReader,
  enterpriseId: string,
  commercialManaged = false,
): Promise<void> {
  let marker: string | null;
  try {
    // Re-read per command: a warm worker cannot retain an obsolete admission decision.
    marker = await redis.hget(`TENANT_CONFIG_${enterpriseId}`, "COMMERCIAL_MANAGED");
  } catch {
    throw new DomainError("POLICY_UNAVAILABLE");
  }
  if (commercialManaged || (marker !== null && marker !== "false"))
    throw new DomainError("POLICY_CAPABILITY_UNSUPPORTED");
}
