import { expect, it, vi } from "vitest";
import { GroupForwardRepository } from "../src/infrastructure/persistence/group-forward-repository.js";
import type { SqlSession } from "../src/application/database-ports.js";

const row = {
  requestId: "101",
  actorUserId: "30",
  sourceSessionId: "1000",
  clientRequestId: "request:with:separators",
  mode: "SINGLE" as const,
  requestHash: "a".repeat(64),
  backend: "TENANT" as const,
};

it("locks the request identity before checking or inserting, with ordinary SQL", async () => {
  const calls: string[] = [];
  const db: SqlSession = {
    lock: async (key) => {
      calls.push(key);
    },
    query: async (sql) => {
      calls.push(sql.trim().split(/\s+/)[0]);
      expect(sql).not.toMatch(/ON\s+CONFLICT|MERGE\s+INTO/i);
      return [];
    },
  };
  expect(await new GroupForwardRepository(db, "999").reserveRequest(row)).toBe(true);
  expect(calls).toEqual([
    `forward-reserve:${JSON.stringify(["999", "30", row.clientRequestId])}`,
    "SELECT",
    "INSERT",
  ]);
});

it("existing identity is an idempotent no-op without an insert", async () => {
  const query = vi.fn().mockResolvedValue([{ request_id: "101" }]);
  const repo = new GroupForwardRepository({ lock: async () => {}, query }, "999");
  expect(await repo.reserveRequest(row)).toBe(false);
  expect(query).toHaveBeenCalledTimes(1);
});

it("lock failure prevents all SQL writes and reads", async () => {
  const query = vi.fn();
  const repo = new GroupForwardRepository(
    {
      lock: async () => {
        throw new Error("Redis unavailable");
      },
      query,
    },
    "999",
  );
  await expect(repo.reserveRequest(row)).rejects.toThrow("Redis unavailable");
  expect(query).not.toHaveBeenCalled();
});
