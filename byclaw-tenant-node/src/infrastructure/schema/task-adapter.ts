import type { ConnectionManager } from "../../application/connection-manager.js";
import type { SchemaPorts, SchemaTask } from "../../application/schema/types.js";
import { assertTenant } from "../../domain/tenant.js";
import { DomainError } from "../../domain/errors.js";
import type { SchemaTaskFiles } from "./task-files.js";
import type { BeSchemaClient } from "./be-schema-client.js";
import { validateBundle } from "./bundle-validator.js";
import { SchemaExecutionAdapter } from "./schema-execution.js";

export function schemaPorts(
  connection: ConnectionManager,
  files: SchemaTaskFiles,
  be: BeSchemaClient,
): SchemaPorts {
  return {
    validate: validateBundle,
    saveBundle: (task, bytes) => files.saveBundle(task, bytes),
    loadBundle: (task) => files.loadBundle(task),
    read: (id) => files.read(id),
    save: (result) => files.save(result),
    list: () => files.list(),
    cleanup: (task) => files.cleanup(task),
    currentVersion: () => be.currentVersion(),
    report: (result) => be.report(result),
    busy: (value) => connection.setSchemaBusy(value),
    authorize: async (task: SchemaTask, allowExpired = false) => {
      assertTenant(task, connection.identity);
      await connection.assertWriteAuthority();
      if (task.fencingToken !== connection.fencingToken) throw new DomainError("AUTHORITY_CHANGED");
      if (!allowExpired && Date.parse(task.deadline) <= Date.now())
        throw new DomainError("SCHEMA_TASK_EXPIRED");
    },
    locked: async (work) => {
      const pool = connection.database();
      return pool.exclusive(async (db) => {
        await connection.guard(pool);
        return work(new SchemaExecutionAdapter(db, connection, () => connection.guard(pool)));
      });
    },
  };
}
