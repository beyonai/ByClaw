import type { ConnectionManager } from "../../application/connection-manager.js";
import type { TenantDatabase } from "../../application/database-ports.js";
import type {
  SchemaExecution,
  SchemaManifest,
  SchemaMarker,
} from "../../application/schema/types.js";
import { DomainError } from "../../domain/errors.js";
import { assertEmpty, readMarker, verifyCatalog } from "./catalog.js";

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
