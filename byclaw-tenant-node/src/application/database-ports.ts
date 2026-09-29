import type { AuthorityVersion, TenantSnapshot } from "../domain/tenant.js";

export type SqlRow = Record<string, any>;
export interface SqlSession {
  query(sql: string, parameters?: unknown[]): Promise<SqlRow[]>;
}
export interface TenantDatabase extends SqlSession {
  transaction<T>(
    work: (session: SqlSession) => Promise<T>,
    beforeCommit?: () => Promise<void>,
  ): Promise<T>;
  exclusive<T>(work: (database: TenantDatabase) => Promise<T>): Promise<T>;
  verifyIdentity(): Promise<void>;
  fresh(): Promise<TenantDatabase>;
  close(): Promise<void>;
}
export interface ConnectionPorts {
  snapshot(): Promise<TenantSnapshot>;
  decrypt(snapshot: TenantSnapshot): Promise<string>;
  open(snapshot: TenantSnapshot, password: string): Promise<TenantDatabase>;
  readAuthority(): Promise<AuthorityVersion | undefined>;
  saveAuthority(version: AuthorityVersion): Promise<void>;
}
