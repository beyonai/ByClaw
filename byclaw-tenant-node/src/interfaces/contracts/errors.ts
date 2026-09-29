import { DomainError } from "../../domain/errors.js";
export class ServiceError extends DomainError {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** 将脱敏业务错误码映射到 HTTP 状态，避免接口泄露底层数据库异常。 */
export function errorStatus(error: DomainError): number {
  if (error instanceof ServiceError) return error.status;
  if (
    ["TENANT_MISMATCH", "GENERATION_MISMATCH", "CLIENT_IDENTITY_MISMATCH", "FORBIDDEN"].includes(
      error.code,
    )
  )
    return 403;
  if (["RESOURCE_NOT_ACCESSIBLE", "NOT_FOUND"].includes(error.code)) return 404;
  if (
    [
      "NOT_READY",
      "TENANT_SCHEMA_UPGRADING",
      "AUTHORITY_CHANGED",
      "LEASE_EXPIRED",
      "UPSTREAM_UNAVAILABLE",
    ].includes(error.code)
  )
    return 503;
  if (
    error.code.startsWith("INVALID_") ||
    error.code.endsWith("_DIGEST_MISMATCH") ||
    error.code === "HASH_MISMATCH"
  )
    return 400;
  return 409;
}
