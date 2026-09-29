import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  runner: {
    connect: vi.fn(),
    query: vi.fn(),
    startTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    rollbackTransaction: vi.fn(),
    release: vi.fn(),
    isTransactionActive: true,
  },
  query: vi.fn(),
  initialize: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("typeorm", () => ({
  DataSource: class {
    isInitialized = true;
    constructor(readonly options: unknown) {}
    initialize = fake.initialize;
    query = fake.query;
    destroy = fake.destroy;
    createQueryRunner() {
      return fake.runner;
    }
  },
}));
import { Database } from "../src/infrastructure/persistence/database.js";
import { snapshot } from "./fixtures.js";
beforeEach(() => {
  vi.resetAllMocks();
  fake.runner.isTransactionActive = true;
});
describe("database transaction adapter without a database", () => {
  it("rolls back a failed authority check before COMMIT", async () => {
    const db = await Database.open(snapshot(), "test");
    await expect(
      db.transaction(
        async () => "written",
        async () => {
          throw new Error("lease expired");
        },
      ),
    ).rejects.toThrow("lease expired");
    expect(fake.runner.commitTransaction).not.toHaveBeenCalled();
    expect(fake.runner.rollbackTransaction).toHaveBeenCalledOnce();
    expect(fake.runner.release).toHaveBeenCalledOnce();
  });
  it("keeps COMMIT uncertainty even if rollback fails", async () => {
    const db = await Database.open(snapshot(), "test");
    fake.runner.commitTransaction.mockRejectedValue(new Error("network"));
    fake.runner.rollbackTransaction.mockRejectedValue(new Error("also network"));
    await expect(db.transaction(async () => "written")).rejects.toThrow("COMMIT_UNCERTAIN");
    expect(fake.runner.release).toHaveBeenCalledOnce();
  });
  it("uses shared schema locks for ordinary writes", async () => {
    const db = await Database.open(snapshot(), "test");
    await db.transaction(async (sql) => {
      await sql.query("UPDATE mock SET value=$1", [1]);
    });
    expect(fake.runner.query.mock.calls[0]?.[0]).toContain("search_path");
    expect(fake.runner.query.mock.calls[1]?.[0]).toContain("pg_advisory_xact_lock_shared");
    expect(fake.runner.commitTransaction).toHaveBeenCalledOnce();
  });
  it("holds a dedicated schema lock across version transactions", async () => {
    const db = await Database.open(snapshot(), "test");
    await db.exclusive(async (locked) => {
      await locked.transaction(async () => {});
    });
    expect(fake.runner.query.mock.calls[0]?.[0]).toContain("pg_advisory_lock");
    expect(fake.runner.query.mock.calls.at(-1)?.[0]).toContain("pg_advisory_unlock");
    expect(fake.runner.query.mock.calls.filter(([sql]) => sql.includes("_shared"))).toHaveLength(0);
  });
  it("preserves COMMIT uncertainty when releasing the schema connection fails", async () => {
    const db = await Database.open(snapshot(), "test");
    fake.runner.commitTransaction.mockRejectedValue(new Error("network"));
    fake.runner.release.mockRejectedValue(new Error("release"));
    await expect(
      db.exclusive((locked) => locked.transaction(async () => "written")),
    ).rejects.toThrow("COMMIT_UNCERTAIN");
  });
  it("reports a failed schema lock cleanup after successful work", async () => {
    const db = await Database.open(snapshot(), "test");
    fake.runner.release.mockRejectedValue(new Error("release"));
    await expect(db.exclusive(async () => "done")).rejects.toThrow("SCHEMA_LOCK_RELEASE_FAILED");
  });
  it("checks actual database/user/schema privileges", async () => {
    const db = await Database.open(snapshot(), "test");
    fake.query.mockResolvedValue([
      {
        database: "byclaw_t_11",
        username: "bc_t_10_admin",
        readable: true,
        writable: true,
        read_only: "off",
      },
    ]);
    await expect(db.verifyIdentity()).rejects.toThrow("DATABASE_IDENTITY_MISMATCH");
  });
  it("accepts a fresh tenant database when its owner can create the missing schema", async () => {
    const db = await Database.open(snapshot(), "test");
    fake.query.mockResolvedValue([
      {
        database: "byclaw_t_10",
        username: "bc_t_10_admin",
        readable: true,
        writable: true,
        read_only: "off",
      },
    ]);
    await expect(db.verifyIdentity()).resolves.toBeUndefined();
    expect(fake.query.mock.calls[0]?.[0]).toContain("has_database_privilege");
  });
});
