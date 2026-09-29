import type { AuthorityVersion, TenantSnapshot } from "../domain/tenant.js";

export type SqlRow = Record<string, any>;
export interface SqlSession {
  query(sql: string, parameters?: unknown[]): Promise<SqlRow[]>;
}
/** 数据库端口：业务共享 Schema 锁，升级独占锁；fresh 用于提交后的独立连接核验。 */
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
/** 连接管理的外部能力；权威下限持久化，密码解密与连接创建交由适配器。 */
export interface ConnectionPorts {
  snapshot(): Promise<TenantSnapshot>;
  decrypt(snapshot: TenantSnapshot): Promise<string>;
  open(snapshot: TenantSnapshot, password: string): Promise<TenantDatabase>;
  readAuthority(): Promise<AuthorityVersion | undefined>;
  saveAuthority(version: AuthorityVersion): Promise<void>;
}
