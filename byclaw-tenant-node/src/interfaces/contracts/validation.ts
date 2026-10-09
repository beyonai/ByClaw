import { createHash } from "node:crypto";
import { DomainError } from "../../domain/errors.js";
export { requireId, validId, opaqueId } from "../../domain/values.js";
export { canonical } from "../../domain/json.js";
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
export function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainError("INVALID_BODY");
  return value as Record<string, any>;
}
export function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new DomainError("INVALID_DIGEST");
  return value;
}
