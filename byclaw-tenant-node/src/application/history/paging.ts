import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";

export function bounded(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max)
    throw new DomainError("INVALID_PAGE");
  return Number(value);
}
export const encodeCursor = (values: string[]) =>
  Buffer.from(values.join(":"), "utf8").toString("base64url");
export function decodeCursor(
  cursor: string | undefined,
  sessionId: string,
  length: number,
  topicId?: string,
): string[] | undefined {
  if (!cursor) return undefined;
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split(":");
  if (
    cursor.length > 256 ||
    parts.length !== length ||
    parts[0] !== "1" ||
    parts[1] !== sessionId ||
    (topicId && parts[2] !== topicId)
  )
    throw new DomainError("INVALID_CURSOR");
  const timeIndex = topicId ? 3 : 2;
  if (
    !/^\d+$/.test(parts[timeIndex]!) ||
    !Number.isSafeInteger(Number(parts[timeIndex])) ||
    Number(parts[timeIndex]) > 253402300799999
  )
    throw new DomainError("INVALID_CURSOR");
  parts.slice(timeIndex + 1).forEach(requireId);
  return parts;
}
