import { DomainError } from "./errors.js";
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
export const text = (value: unknown, max: number, required = false): string => {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || Buffer.byteLength(value) > max)
    throw new DomainError("INVALID_TEXT");
  return value;
};
export const next = (version: string) => (BigInt(version) + 1n).toString();
