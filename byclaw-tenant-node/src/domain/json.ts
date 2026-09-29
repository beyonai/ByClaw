import { DomainError } from "./errors.js";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new DomainError("INVALID_JSON");
  if (value === undefined) throw new DomainError("INVALID_JSON");
  return JSON.stringify(value);
}
