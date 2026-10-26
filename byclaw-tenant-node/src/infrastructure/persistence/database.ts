import "reflect-metadata";
import type { LeaseManager, RedisLease } from "../coordination/redis-leases.js";
import { DataSource, type QueryRunner } from "typeorm";
import { DomainError } from "../../domain/errors.js";
import type { TenantSnapshot } from "../../domain/tenant.js";
import type { SqlRow, SqlSession, TenantDatabase } from "../../application/database-ports.js";

/** TypeORM wraps UPDATE/DELETE results as [rows, affected]; the port always exposes rows. */
function queryRows(result: SqlRow[] | [SqlRow[], number]): SqlRow[] {
  return result.length === 2 && Array.isArray(result[0]) && typeof result[1] === "number"
    ? result[0]
    : (result as SqlRow[]);
}

/** 固定租户连接池的 SQL 适配器；关闭自动建表和迁移，仅执行上层授权的参数化语句。 */
export class Database implements TenantDatabase {
  private constructor(
    private readonly source: DataSource,
    private readonly snapshot: TenantSnapshot,
    private readonly locks: LeaseManager,
    private readonly locked?: QueryRunner,
    private readonly schemaLease?: RedisLease,
  ) {}
  static async open(
    snapshot: TenantSnapshot,
    password: string,
    locks: LeaseManager,
  ): Promise<Database> {
    const source = new DataSource({
      type: "postgres",
      host: snapshot.host,
      port: snapshot.port,
      database: snapshot.database,
      username: snapshot.user,
      password,
      synchronize: false,
      migrationsRun: false,
      logging: false,
      extra: { max: 8, connectionTimeoutMillis: 5000, statement_timeout: 30000 },
    });
    await source.initialize();
    return new Database(source, snapshot, locks);
  }
  async query(sql: string, parameters: unknown[] = []): Promise<SqlRow[]> {
    await this.schemaLease?.check();
    return queryRows(
      await (this.locked ? this.locked.query(sql, parameters) : this.source.query(sql, parameters)),
    );
  }
  async verifyIdentity(): Promise<void> {
    const [row] = await this.query(`SELECT current_database() AS database, current_user AS username,
      CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'byai')
        THEN has_schema_privilege(current_user, 'byai', 'USAGE')
        ELSE has_database_privilege(current_user, current_database(), 'CREATE') END AS readable,
      CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'byai')
        THEN has_schema_privilege(current_user, 'byai', 'CREATE')
        ELSE has_database_privilege(current_user, current_database(), 'CREATE') END AS writable,
      current_setting('transaction_read_only') AS read_only`);
    if (
      row?.database !== this.snapshot.database ||
      row?.username !== this.snapshot.user ||
      !row.readable ||
      !row.writable ||
      row.read_only !== "off"
    )
      throw new DomainError("DATABASE_IDENTITY_MISMATCH");
  }
  /** 普通写入取得 Schema 共享锁；提交阶段异常保留 COMMIT_UNCERTAIN，供幂等重投或版本对账。 */
  async transaction<T>(
    work: (session: SqlSession) => Promise<T>,
    beforeCommit?: () => Promise<void>,
  ): Promise<T> {
    const runner = this.locked ?? this.source.createQueryRunner();
    let committing = false,
      failed = false;
    let schema: RedisLease | undefined;
    const held = new Map<string, RedisLease>();
    const check = async () => {
      await schema?.check();
      for (const lease of held.values()) await lease.check();
    };
    try {
      schema =
        this.schemaLease ??
        (await this.locks.acquire(`schema:${this.snapshot.enterpriseId}`, "read"));
      await runner.connect();
      await runner.startTransaction();
      await runner.query("SET LOCAL search_path TO byai, pg_catalog");
      const result = await work({
        lock: async (key) => {
          if (!held.has(key))
            held.set(key, await this.locks.acquire(`tenant:${this.snapshot.enterpriseId}:${key}`));
          await check();
        },
        query: async (sql, args = []) => {
          await check();
          return queryRows(await runner.query(sql, args));
        },
      });
      await beforeCommit?.();
      await check();
      committing = true;
      await runner.commitTransaction();
      // A lost lease during COMMIT cannot undo the commit; preserve uncertainty for idempotent reconciliation.
      await check();
      return result;
    } catch (error) {
      failed = true;
      if (runner.isTransactionActive) {
        try {
          await runner.rollbackTransaction();
        } catch {
          /* 回滚或清理失败不能覆盖原始错误，尤其不能丢失提交不确定状态。 */
        }
      }
      if (committing) throw new DomainError("COMMIT_UNCERTAIN");
      throw error;
    } finally {
      let cleanupFailed = false;
      // Rollback/commit completes before another node can acquire these business keys.
      if (!this.locked) {
        try {
          await runner.release();
        } catch {
          cleanupFailed = true;
        }
      }
      for (const lease of [...held.values()].reverse()) {
        try {
          await lease.release();
        } catch {
          cleanupFailed = true;
        }
      }
      if (!this.schemaLease && schema) {
        try {
          await schema.release();
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed && !failed) throw new DomainError("COMMIT_UNCERTAIN");
    }
  }
  /** Redis 独占租约覆盖整条版本链；链内每版仍使用自己的 SQL 事务。 */
  async exclusive<T>(work: (database: TenantDatabase) => Promise<T>): Promise<T> {
    const runner = this.source.createQueryRunner();
    let lease: RedisLease | undefined;
    let failed = false;
    try {
      lease = await this.locks.acquire(`schema:${this.snapshot.enterpriseId}`);
      await runner.connect();
      const result = await work(
        new Database(this.source, this.snapshot, this.locks, runner, lease),
      );
      await lease.check();
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      let cleanupFailed = false;
      try {
        await runner.release();
      } catch {
        cleanupFailed = true;
      }
      try {
        await lease?.release();
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed && !failed) throw new DomainError("SCHEMA_LOCK_RELEASE_FAILED");
    }
  }
  async fresh(): Promise<TenantDatabase> {
    const options = this.source.options;
    if (!("password" in options) || typeof options.password !== "string")
      throw new DomainError("NOT_READY");
    return Database.open(this.snapshot, options.password, this.locks);
  }
  async close(): Promise<void> {
    if (this.source.isInitialized) await this.source.destroy();
  }
}
