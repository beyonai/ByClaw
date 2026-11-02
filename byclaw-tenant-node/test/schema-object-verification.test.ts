import { describe, expect, it, vi } from "vitest";
import { readMarker, verifyCatalog } from "../src/infrastructure/schema/catalog.js";
import { SchemaExecutionAdapter } from "../src/infrastructure/schema/schema-execution.js";
import type { TenantDatabase } from "../src/application/database-ports.js";
import type { ConnectionManager } from "../src/application/connection-manager.js";
import { manifest } from "./fixtures.js";

const marker = () => ({
  protocolVersion: 1,
  enterpriseId: "10",
  version: manifest().version,
  scriptDigest: manifest().sqlSha256,
});

describe("schema verification without engine-specific fingerprints", () => {
  it("checks declared objects without reading or hashing the complete catalog", async () => {
    const query = vi.fn(async (sql: string) => {
      if (!sql.includes("c.relname=$1")) throw Error("unexpected fingerprint query");
      return [{ exists: 1 }];
    });
    await expect(verifyCatalog({ query }, manifest())).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(manifest().objects.length);
  });

  it("still rejects missing objects", async () => {
    await expect(verifyCatalog({ query: async () => [] }, manifest())).rejects.toThrow(
      "SCHEMA_OBJECT_MISSING",
    );
  });

  it("accepts version markers without legacy catalog metadata", async () => {
    const value = marker();
    await expect(
      readMarker({ query: async () => [{ marker: JSON.stringify(value) }] }, "10"),
    ).resolves.toEqual(value);
    await expect(
      readMarker({ query: async () => [{ marker: JSON.stringify(value) }] }, "11"),
    ).rejects.toThrow("SCHEMA_MARKER_INVALID");
  });

  it.each(["legacy-different-fingerprint", undefined])(
    "recovers committed SQL with catalog metadata %s",
    async (catalogDigest) => {
      const fresh = {
        verifyIdentity: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        query: vi.fn(async (sql: string) =>
          sql.includes("pg_namespace') AS marker")
            ? [{ marker: JSON.stringify({ ...marker(), catalogDigest }) }]
            : [{ exists: 1 }],
        ),
      };
      const execution = new SchemaExecutionAdapter(
        { fresh: async () => fresh } as unknown as TenantDatabase,
        { identity: { enterpriseId: "10" } } as ConnectionManager,
        async () => {},
      );
      await expect(execution.verify(manifest())).resolves.toBeUndefined();
      expect(fresh.verifyIdentity).toHaveBeenCalledOnce();
      expect(fresh.close).toHaveBeenCalledOnce();
      await expect(execution.verify({ ...manifest(), sqlSha256: "d".repeat(64) })).rejects.toThrow(
        "SCHEMA_MARKER_MISMATCH",
      );
      await expect(execution.verify({ ...manifest(), version: "V99.0.0" })).rejects.toThrow(
        "SCHEMA_MARKER_MISMATCH",
      );
    },
  );
});
