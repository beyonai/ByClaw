import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LATEST_POSTGRES_SCHEMA_VERSION,
  POSTGRES_MIGRATIONS,
} from "../../packages/storage-postgres/src/migrations.js";
import { PostgresDatabase } from "../../packages/storage-postgres/src/postgres-database.js";

const databases: PostgresDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("PostgreSQL migrations", () => {
  it("保持连续版本并兼容 OpenGauss 的 ADD COLUMN 语法", () => {
    expect(POSTGRES_MIGRATIONS.map((migration) => migration.version)).toEqual(
      Array.from(
        { length: LATEST_POSTGRES_SCHEMA_VERSION },
        (_, index) => index + 1,
      ),
    );
    expect(
      POSTGRES_MIGRATIONS.some((migration) =>
        /\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i.test(migration.sql),
      ),
    ).toBe(false);
  });

  it("partial_output 只在第 2 版新增一次", () => {
    expect(POSTGRES_MIGRATIONS[0]?.sql).not.toContain("partial_output");
    expect(POSTGRES_MIGRATIONS[1]?.sql).toContain(
      "ADD COLUMN partial_output text NULL",
    );
  });

  it("第 11 版持久化回调截止时间和超时终态 Outbox", () => {
    const migration = POSTGRES_MIGRATIONS.find((candidate) => candidate.version === 11);
    expect(migration?.sql).toContain("callback_deadline_at timestamptz NULL");
    expect(migration?.sql).toContain("callback_timeout_outbox");
    expect(migration?.sql).toContain("WHERE status = 'RUNNING'");
  });

  it("健康检查只校验数据库连通性，不依赖 migration 版本表", async () => {
    const database = new PostgresDatabase({
      host: "127.0.0.1",
      port: 5432,
      database: "byclaw",
      schema: "byai",
      user: "byclaw",
      password: "unused",
    });
    databases.push(database);
    const query = vi.spyOn(database.pool, "query").mockResolvedValue({} as never);

    await expect(database.health()).resolves.toEqual({ healthy: true });
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith("SELECT 1");
  });
});
