import { describe, expect, it, vi } from "vitest";
import { PostgresRunExecutionQueue } from "../src/postgres-database.js";

describe("Postgres Run callback locking", () => {
  it("lets an early callback atomically queue a still-RUNNING Run", async () => {
    const statements: string[] = [];
    const settledAt = new Date("2026-08-22T04:00:00.000Z");
    let nextEventId = 1;
    const client = fakeClient(async (sql, params = []) => {
      statements.push(sql);
      if (sql.includes("SELECT run_id") && sql.includes("delegations")) {
        return result([{ run_id: "run-1" }]);
      }
      if (sql.includes("FOR UPDATE OF d, r")) {
        return result([
          {
            delegation_id: "delegation-1",
            run_id: "run-1",
            agent_id: "agent-1",
            agent_name: "Agent 1",
            delegation_status: "RUNNING",
            run_status: "RUNNING",
            execution_stage: "LEADER_RUNNING",
            callback_expired: false,
            settled_at: settledAt,
          },
        ]);
      }
      if (sql.includes("INSERT INTO") && sql.includes("run_events")) {
        return result([
          {
            run_id: params[0],
            event_id: nextEventId++,
            timestamp: params[1],
            type: params[2],
            data: JSON.parse(String(params[3])),
          },
        ]);
      }
      return result([]);
    });
    const queue = new PostgresRunExecutionQueue(fakePool([client]), "byai");

    await expect(
      queue.settleWaitingCallback({
        delegationId: "delegation-1",
        status: "COMPLETED",
        finalAnswer: "done",
      }),
    ).resolves.toEqual({ accepted: true, runId: "run-1", wakeRun: true });

    expect(
      statements.some(
        (sql) =>
          sql.includes("SET status = 'QUEUED', execution_stage = 'CONNECTOR_WAITING'") &&
          sql.includes("version = version + 1"),
      ),
    ).toBe(true);
  });

  it("commits WAITING_AGENT and run.suspended under one event-first lock order", async () => {
    const statements: string[] = [];
    const suspendedAt = new Date("2026-08-22T04:00:00.000Z");
    let nextEventId = 1;
    const client = fakeClient(async (sql, params = []) => {
      statements.push(sql);
      if (sql.includes("FOR UPDATE OF d, r")) {
        return result([
          {
            delegation_status: "RUNNING",
            run_status: "RUNNING",
            run_version: 5,
            suspended_at: suspendedAt,
          },
        ]);
      }
      if (sql.includes("UPDATE") && sql.includes("status = 'WAITING_AGENT'")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO") && sql.includes("run_events")) {
        return result([
          {
            run_id: params[0],
            event_id: nextEventId++,
            timestamp: params[1],
            type: params[2],
            data: JSON.parse(String(params[3])),
          },
        ]);
      }
      return result([]);
    });
    const queue = new PostgresRunExecutionQueue(fakePool([client]), "byai");

    await expect(
      queue.suspendRunForDelegation({
        runId: "run-1",
        delegationId: "delegation-1",
        expectedRunVersion: 5,
      }),
    ).resolves.toEqual({ runStatus: "WAITING_AGENT", suspended: true });

    const eventLockIndex = statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
    const rowLockIndex = statements.findIndex((sql) => sql.includes("FOR UPDATE OF d, r"));
    expect(rowLockIndex).toBeGreaterThan(eventLockIndex);
    expect(
      statements.filter((sql) => sql.includes("INSERT INTO") && sql.includes("run_events")),
    ).toHaveLength(2);
  });

  it("acquires the Run event lock before locking Delegation and Run rows", async () => {
    const statements: string[] = [];
    const client = fakeClient(async (sql) => {
      statements.push(sql);
      if (sql.includes("SELECT run_id") && sql.includes("delegations")) {
        return result([{ run_id: "run-1" }]);
      }
      if (sql.includes("FOR UPDATE OF d, r")) {
        return result([{ delegation_status: "COMPLETED", run_id: "run-1" }]);
      }
      return result([]);
    });
    const queue = new PostgresRunExecutionQueue(fakePool([client]), "byai");

    await expect(
      queue.settleWaitingCallback({
        delegationId: "delegation-1",
        status: "COMPLETED",
        finalAnswer: "done",
      }),
    ).resolves.toEqual({ accepted: false, runId: "run-1" });

    const eventLockIndex = statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
    const rowLockIndex = statements.findIndex((sql) => sql.includes("FOR UPDATE OF d, r"));
    expect(eventLockIndex).toBeGreaterThanOrEqual(0);
    expect(rowLockIndex).toBeGreaterThan(eventLockIndex);
  });

  it("terminally fails an expired callback before publishing its timeout outbox", async () => {
    const statements: string[] = [];
    const expiredAt = new Date("2026-08-22T04:05:00.000Z");
    let nextEventId = 1;
    const client = fakeClient(async (sql, params = []) => {
      statements.push(sql);
      if (
        sql.includes("SELECT d.id AS delegation_id, d.run_id") &&
        !sql.includes("FOR UPDATE OF d, r")
      ) {
        return result([{ delegation_id: "delegation-1", run_id: "run-1" }]);
      }
      if (sql.includes("FOR UPDATE OF d, r")) {
        return result([
          {
            delegation_id: "delegation-1",
            run_id: "run-1",
            agent_id: "agent-1",
            agent_name: "Agent 1",
            partial_output: "",
            expired_at: expiredAt,
          },
        ]);
      }
      if (sql.includes("INSERT INTO") && sql.includes("run_events")) {
        return result([
          {
            run_id: params[0],
            event_id: nextEventId++,
            timestamp: params[1],
            type: params[2],
            data: JSON.parse(String(params[3])),
          },
        ]);
      }
      if (sql.includes("UPDATE") && sql.includes("status = 'FAILED'")) {
        return { rows: [], rowCount: 1 };
      }
      return result([]);
    });
    const queue = new PostgresRunExecutionQueue(fakePool([client]), "byai");

    await expect(queue.expireWaitingCallbacks({ limit: 100 })).resolves.toEqual([
      { runId: "run-1", delegationId: "delegation-1" },
    ]);

    const eventLockIndex = statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
    const rowLockIndex = statements.findIndex((sql) => sql.includes("FOR UPDATE OF d, r"));
    const terminalRunUpdate = statements.find(
      (sql) => sql.includes("UPDATE") && sql.includes("status = 'FAILED'"),
    );
    expect(rowLockIndex).toBeGreaterThan(eventLockIndex);
    expect(terminalRunUpdate).toContain("execution_stage = 'SETTLED'");
    expect(statements.some((sql) => sql.includes("SET status = 'QUEUED'"))).toBe(false);
    expect(
      statements.filter((sql) => sql.includes("INSERT INTO") && sql.includes("run_events")),
    ).toHaveLength(2);
    expect(
      statements.some(
        (sql) => sql.includes("INSERT INTO") && sql.includes("callback_timeout_outbox"),
      ),
    ).toBe(true);
  });

  it("retries a deadlocked database transaction with a fresh client", async () => {
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const first = fakeClient(async (sql) => {
      if (sql.includes("SELECT run_id") && sql.includes("delegations")) {
        throw deadlock;
      }
      return result([]);
    });
    const second = fakeClient(async (sql) => {
      if (sql.includes("SELECT run_id") && sql.includes("delegations")) {
        return result([{ run_id: "run-1" }]);
      }
      if (sql.includes("FOR UPDATE OF d, r")) {
        return result([{ delegation_status: "COMPLETED", run_id: "run-1" }]);
      }
      return result([]);
    });
    const pool = fakePool([first, second]);
    const queue = new PostgresRunExecutionQueue(pool, "byai");

    await expect(
      queue.settleWaitingCallback({
        delegationId: "delegation-1",
        status: "COMPLETED",
        finalAnswer: "done",
      }),
    ).resolves.toEqual({ accepted: false, runId: "run-1" });

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(first.query).toHaveBeenCalledWith("ROLLBACK");
    expect(first.release).toHaveBeenCalledOnce();
    expect(second.release).toHaveBeenCalledOnce();
  });
});

function fakePool(clients: ReturnType<typeof fakeClient>[]) {
  let nextClient = 0;
  return {
    connect: vi.fn(async () => clients[nextClient++] ?? clients.at(-1)),
  } as never;
}

function fakeClient(query: (sql: string, params?: unknown[]) => Promise<unknown>) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => query(sql, params)),
    release: vi.fn(),
  };
}

function result(rows: Array<Record<string, unknown>>) {
  return { rows, rowCount: rows.length };
}
