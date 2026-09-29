import "reflect-metadata";
import { DataSource, type QueryRunner } from "typeorm";
import { DomainError } from "../../domain/errors.js";
import type { TenantSnapshot } from "../../domain/tenant.js";
import type { SqlSession, TenantDatabase } from "../../application/database-ports.js";

export class Database implements TenantDatabase {
  private constructor(
    private readonly source: DataSource,
    private readonly snapshot: TenantSnapshot,
    private readonly locked?: QueryRunner,
  ) {}
  static async open(snapshot: TenantSnapshot, password: string): Promise<Database> {
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
    return new Database(source, snapshot);
  }
  query(sql: string, parameters: unknown[] = []) {
    return this.locked ? this.locked.query(sql, parameters) : this.source.query(sql, parameters);
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
  async transaction<T>(
    work: (session: SqlSession) => Promise<T>,
    beforeCommit?: () => Promise<void>,
  ): Promise<T> {
    const runner = this.locked ?? this.source.createQueryRunner();
    let committing = false,
      failed = false;
    try {
      await runner.connect();
      await runner.startTransaction();
      await runner.query("SET LOCAL search_path TO byai, pg_catalog");
      if (!this.locked)
        await runner.query("SELECT pg_advisory_xact_lock_shared(hashtext($1))", [
          `tenant-schema:${this.snapshot.enterpriseId}`,
        ]);
      const result = await work({ query: (sql, args = []) => runner.query(sql, args) });
      await beforeCommit?.();
      committing = true;
      await runner.commitTransaction();
      return result;
    } catch (error) {
      failed = true;
      if (runner.isTransactionActive) {
        try {
          await runner.rollbackTransaction();
        } catch {
          /* Preserve the original failure or commit uncertainty. */
        }
      }
      if (committing) throw new DomainError("COMMIT_UNCERTAIN");
      throw error;
    } finally {
      if (!this.locked) {
        try {
          await runner.release();
        } catch {
          if (!failed) throw new DomainError("COMMIT_UNCERTAIN");
        }
      }
    }
  }
  async exclusive<T>(work: (database: TenantDatabase) => Promise<T>): Promise<T> {
    const runner = this.source.createQueryRunner();
    let acquired = false,
      failed = false;
    try {
      await runner.connect();
      await runner.query("SELECT pg_advisory_lock(hashtext($1))", [
        `tenant-schema:${this.snapshot.enterpriseId}`,
      ]);
      acquired = true;
      return await work(new Database(this.source, this.snapshot, runner));
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      let cleanupFailed = false;
      try {
        if (acquired)
          await runner.query("SELECT pg_advisory_unlock(hashtext($1))", [
            `tenant-schema:${this.snapshot.enterpriseId}`,
          ]);
      } catch {
        cleanupFailed = true;
      } finally {
        try {
          await runner.release();
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed && !failed) throw new DomainError("SCHEMA_LOCK_RELEASE_FAILED");
    }
  }
  async fresh(): Promise<TenantDatabase> {
    const options = this.source.options;
    if (!("password" in options) || typeof options.password !== "string")
      throw new DomainError("NOT_READY");
    return Database.open(this.snapshot, options.password);
  }
  async close(): Promise<void> {
    if (this.source.isInitialized) await this.source.destroy();
  }
}
