import type { SchemaResult } from "./types.js";
export function publicResult(result: SchemaResult) {
  const { task, reported: _, ...state } = result;
  return { ...task, ...state };
}
