import { describe, expect, it, vi } from "vitest";
import type { SqlSession } from "../src/application/database-ports.js";
import { nextId } from "../src/infrastructure/persistence/sql-utils.js";

describe("tenant generated IDs", () => {
  const db = (sequence: string) =>
    ({ query: vi.fn(async () => [{ id: sequence }]) }) as unknown as SqlSession;

  it("uses the tenant-local sequence inside a disjoint signed BIGINT range", async () => {
    const first = db("15");
    const second = db("15");
    expect(await nextId(first, "11222473")).toBe("8011222473000000015");
    expect(await nextId(second, "11222474")).toBe("8011222474000000015");
    expect(first.query).toHaveBeenCalledWith("SELECT nextval('byai.seq_any_table')::text AS id");
  });

  it("rejects exhausted ranges instead of producing a colliding ID", async () => {
    await expect(nextId(db("1000000000"), "11222473")).rejects.toThrow("TENANT_SEQUENCE_EXHAUSTED");
    await expect(nextId(db("1"), "1000000000")).rejects.toThrow("TENANT_ID_RANGE_EXHAUSTED");
  });
});
