/** PostgreSQL 中按 Run 保存的临时执行上下文；仅当前 Run 的合法 lease owner 可以读取。 */
export interface ExecutionCredential {
  runId: string;
  secret: string;
  /** 不包含 Beyond-Token；与 secret 合并后可恢复完整的 Run metadata。 */
  metadata?: Record<string, unknown>;
  createdAt: number;
}
