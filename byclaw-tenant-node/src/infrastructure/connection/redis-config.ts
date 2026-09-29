import type { Redis } from "ioredis";
import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";
import type { TenantSnapshot } from "../../domain/tenant.js";

export const connectionFields = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "DB_SANDBOX_RECORD_ID",
  "DB_CREDENTIAL_VERSION",
  "PROVISION_STATE",
] as const;
/** 单次 HMGET 获取八个连接字段，按固定企业校验库名、账号及 PROVISION_STATE。 */
export async function readTenantSnapshot(
  redis: Pick<Redis, "hmget">,
  enterpriseId: string,
): Promise<TenantSnapshot> {
  const values = await redis.hmget(`TENANT_CONFIG_${enterpriseId}`, ...connectionFields);
  if (values.length !== connectionFields.length || values.some((value) => !value))
    throw new DomainError("TENANT_CONFIG_MISSING");
  const [host, portText, database, user, passwordEnvelope, recordId, credentialVersion, stateText] =
    values as string[];
  let state: Record<string, unknown>;
  try {
    state = JSON.parse(stateText!);
  } catch {
    throw new DomainError("INVALID_PROVISION_STATE");
  }
  if (!state || typeof state !== "object" || Array.isArray(state))
    throw new DomainError("INVALID_PROVISION_STATE");
  const port = Number(portText);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    database !== `byclaw_t_${enterpriseId}` ||
    user !== `bc_t_${enterpriseId}_admin`
  )
    throw new DomainError("DATABASE_IDENTITY_MISMATCH");
  if (
    typeof state.fencingToken !== "string" ||
    !/^(0|[1-9]\d*)$/.test(state.fencingToken) ||
    typeof state.status !== "string" ||
    typeof state.leaseUntil !== "string" ||
    !Number.isFinite(Date.parse(state.leaseUntil))
  )
    throw new DomainError("INVALID_PROVISION_STATE");
  return {
    enterpriseId,
    generation: requireId(state.generation),
    dbSandboxRecordId: requireId(recordId),
    host: host!,
    port,
    database: database!,
    user: user!,
    passwordEnvelope: passwordEnvelope!,
    credentialVersion: requireId(credentialVersion),
    fencingToken: state.fencingToken,
    leaseUntil: state.leaseUntil,
    status: state.status,
    step: typeof state.step === "string" ? state.step : undefined,
  };
}
