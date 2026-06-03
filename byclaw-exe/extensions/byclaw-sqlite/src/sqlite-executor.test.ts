import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteExecutor } from "./sqlite-executor.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function createExecutor() {
  const logs: Array<{ level: string; message: string }> = [];
  const logger = {
    info: (message: string) => logs.push({ level: "info", message }),
    warn: (message: string) => logs.push({ level: "warn", message }),
    error: (message: string) => logs.push({ level: "error", message }),
    debug: vi.fn(),
  };
  const dir = mkdtempSync(path.join(tmpdir(), "byclaw-sqlite-"));
  tempDirs.push(dir);

  const executor = new SqliteExecutor({
    config: {
      dbPath: path.join(dir, "byclaw.sqlite"),
      toolName: "sqlExecute",
      httpPath: "/plugins/byclaw-sqlite/sqlExecute",
      busyTimeoutMs: 1000,
      maxRows: 50,
      allowWrite: true,
    },
    logger,
  });

  return { executor, logs };
}

describe("SqliteExecutor logging", () => {
  it("logs the incoming request parameters", () => {
    const { executor, logs } = createExecutor();

    const result = executor.execute({
      sql: "select :value as value, :token as token",
      params: { value: 10, token: "secret" },
      mode: "all",
      maxRows: 7,
    });

    expect(result.ok).toBe(true);
    expect(
      logs.some(
        (entry) =>
          entry.level === "info" &&
          entry.message.includes("request received") &&
          entry.message.includes('"sql":"select :value as value, :token as token"') &&
          entry.message.includes('"mode":"all"') &&
          entry.message.includes('"maxRows":7') &&
          entry.message.includes('"token":"secret"'),
      ),
    ).toBe(true);
  });

  it("logs failed requests with an error entry", () => {
    const { executor, logs } = createExecutor();

    const result = executor.execute({
      sql: "select * from missing_table",
      params: ["x"],
      mode: "all",
    });

    expect(result.ok).toBe(false);
    expect(
      logs.some(
        (entry) =>
          entry.level === "warn" &&
          entry.message.includes("execution failed for SELECT") &&
          entry.message.includes("missing_table"),
      ),
    ).toBe(true);
    expect(
      logs.some(
        (entry) =>
          entry.level === "error" &&
          entry.message.includes("request failed") &&
          entry.message.includes('"sql":"select * from missing_table"') &&
          entry.message.includes('"params":["x"]') &&
          entry.message.includes("missing_table"),
      ),
    ).toBe(true);
  });
});
