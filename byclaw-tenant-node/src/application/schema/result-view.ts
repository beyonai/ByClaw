import type { SchemaResult } from "./types.js";
/** 生成 HTTP/Worker/BE 共用的扁平结果，隐藏本地回报重试标记。 */
export function publicResult(result: SchemaResult) {
  const { task, reported: _, ...state } = result;
  return { ...task, ...state };
}
