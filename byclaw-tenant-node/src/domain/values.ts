import { DomainError } from "./errors.js";
/** ID 保持规范十进制字符串并限制在 signed BIGINT 范围，避免 JS Number 精度丢失。 */
export function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  );
}
export function requireId(value: unknown): string {
  if (!validId(value)) throw new DomainError("INVALID_ID");
  return value;
}
export function opaqueId(value: unknown, max = 64): string {
  if (typeof value !== "string" || !new RegExp(`^[A-Za-z0-9:_-]{1,${max}}$`).test(value))
    throw new DomainError("INVALID_REQUEST_ID");
  return value;
}
export const text = (value: unknown, max: number, required = false): string => {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || Buffer.byteLength(value) > max)
    throw new DomainError("INVALID_TEXT");
  return value;
};
export const next = (version: string) => (BigInt(version) + 1n).toString();

/** openGauss VARCHAR limits use UTF-8 bytes; never split a Unicode code point. */
export function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes) break;
    bytes += size;
    result += character;
  }
  return result;
}
