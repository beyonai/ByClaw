import type { ConnectionManager } from "../../application/connection-manager.js";
import type { TenantDatabase } from "../../application/database-ports.js";
import type {
  SchemaExecution,
  SchemaManifest,
  SchemaMarker,
} from "../../application/schema/types.js";
import { DomainError } from "../../domain/errors.js";
import { assertEmpty, readMarker, verifyCatalog } from "./catalog.js";

/** 在已有独占锁内执行 DDL；执行连接与提交后的结构核验连接分开。 */
export class SchemaExecutionAdapter implements SchemaExecution {
  constructor(
    private readonly locked: TenantDatabase,
    private readonly connection: ConnectionManager,
    private readonly guard: () => Promise<void>,
  ) {}
  marker() {
    return readMarker(this.locked, this.connection.identity.enterpriseId);
  }
  empty() {
    return assertEmpty(this.locked);
  }
  /** 使用新连接验证实际库身份、完整 catalog 和版本标记，避免把同事务可见性当成提交成功。 */
  async verify(manifest: SchemaManifest): Promise<void> {
    const fresh = await this.locked.fresh();
    try {
      await fresh.verifyIdentity();
      await verifyCatalog(fresh, manifest);
      const marker = await readMarker(fresh, this.connection.identity.enterpriseId);
      if (
        marker?.version !== manifest.version ||
        marker.scriptDigest !== manifest.sqlSha256 ||
        marker.catalogDigest !== manifest.catalogDigest
      )
        throw new DomainError("SCHEMA_MARKER_MISMATCH");
    } finally {
      await fresh.close();
    }
  }
  /** 本版 SQL 与 Schema 版本注释同事务提交，COMMIT 前再次检查连接权威和任务期限。 */
  async execute(
    statements: string[],
    marker: SchemaMarker,
    beforeCommit?: () => Promise<void>,
  ): Promise<void> {
    await this.guard();
    await this.locked.transaction(
      async (session) => {
        for (const sql of statements) await session.query(sql);
        const comment = JSON.stringify(marker).replace(/'/g, "''");
        await session.query(`COMMENT ON SCHEMA byai IS '${comment}'`);
      },
      async () => {
        await this.guard();
        await beforeCommit?.();
      },
    );
  }
}
