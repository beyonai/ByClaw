/** PostgreSQL 中按 Run 保存的执行凭证；仅当前 Run 的合法 lease owner 可以读取。 */
export interface ExecutionCredential {
  runId: string;
  secret: string;
  createdAt: number;
}
