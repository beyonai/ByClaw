import { DomainError } from "./errors.js";
/** 递归排序对象键并保留数组顺序，得到 BE 与 Node 必须共用的摘要输入文本。 */
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
