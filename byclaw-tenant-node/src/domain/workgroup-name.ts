import { DomainError } from "./errors.js";
import { text } from "./values.js";

/** Match BE's String.trim() normalization and 50-character workgroup-name limit. */
export function workgroupName(value: unknown): string {
  const name = text(value, 400, true).replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
  if (!name || name.length > 50) {
    throw new DomainError('INVALID_SESSION_NAME');
  }
  return name;
}
