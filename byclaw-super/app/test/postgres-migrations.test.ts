import { describe, expect, it } from "vitest";
import {
  LATEST_POSTGRES_SCHEMA_VERSION,
  POSTGRES_MIGRATIONS,
} from "../../packages/storage-postgres/src/migrations.js";

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
});
