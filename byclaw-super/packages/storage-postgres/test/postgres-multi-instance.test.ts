import {
  createPiSessionCheckpoint,
  createSessionContext,
  ExecutionOwnershipLostError,
  type Run,
  type RunEvent,
  type RunExecutionClaim,
  type Session,
} from "@byclaw/by-conductor";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  PostgresIngressSessionBindingRepository,
  PostgresExecutionCredentialRepository,
  PostgresLeaderCheckpointStore,
  PostgresRunEventStore,
  PostgresRunExecutionQueue,
  PostgresRunRepository,
} from "../src/postgres-database.js";

const claim: RunExecutionClaim = {
  runId: "run-1",
  sessionId: "session-1",
  ownerInstanceId: "instance-a",
  attemptNo: 2,
  fencingToken: 7,
  leaseExpiresAt: 100_000,
};
const binding = { source: "by-framework", userCode: "user-1", externalSessionId: "external-1" };
const event: Omit<RunEvent, "eventId"> = {
  runId: "run-1", timestamp: 1, type: "run.created", data: { status: "QUEUED" },
};

describe("Postgres multi-instance ownership", () => {
  it("rejects a stale claim before appending any event", async () => {
    const db = fakeDatabase();
    const events = new PostgresRunEventStore(db.pool, "byai");

    await expect(events.appendForClaim(event, claim)).rejects.toBeInstanceOf(ExecutionOwnershipLostError);
    const leaseRead = db.calls.find((call) => call.sql.includes("FOR UPDATE OF l"));
    expect(leaseRead?.sql).toContain("l.attempt_no = $5");
    expect(leaseRead?.params).toEqual([
      claim.sessionId, claim.runId, claim.ownerInstanceId, claim.fencingToken, claim.attemptNo,
    ]);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO"))).toBe(false);
    expect(db.calls.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("holds lease ownership before replacing pending checkpoint entries", async () => {
    const db = fakeDatabase((sql) => {
      if (sql.includes("FOR UPDATE OF l") || sql.includes("status NOT IN")) return rows([{}]);
      if (sql.includes("SELECT context_revision")) return rows([{ context_revision: 0 }]);
      return rows([]);
    });
    const checkpoints = new PostgresLeaderCheckpointStore(db.pool, "byai", {
      entryMaxBytes: 100_000, sessionMaxBytes: 100_000, sessionMaxEntries: 100,
    });
    const checkpoint = createPiSessionCheckpoint({
      piSdkVersion: "0.80.10",
      header: { type: "session", version: 3, id: "a12ac8ae-00fd-4e66-8335-5943c92912f3", timestamp: new Date(0).toISOString(), cwd: "/tmp" },
      entries: [], activeLeafId: null,
    });
    await checkpoints.stagePending({
      sessionId: claim.sessionId, runId: claim.runId, attemptNo: claim.attemptNo,
      baseRevision: 0, checkpoint, now: 1, claim,
    });
    const eventLock = db.calls.findIndex((call) => call.params?.[0] === `byclaw-run-event:${claim.runId}`);
    const leaseLock = db.calls.findIndex((call) => call.sql.includes("FOR UPDATE OF l"));
    const pendingDelete = db.calls.findIndex((call) => call.sql.includes("DELETE FROM"));
    expect(eventLock).toBeGreaterThanOrEqual(0);
    expect(leaseLock).toBeGreaterThan(eventLock);
    expect(pendingDelete).toBeGreaterThan(leaseLock);
    expect(db.calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("takes the event lock before updating a Run row", async () => {
    const db = fakeDatabase((sql, params) => {
      if (sql.includes("UPDATE") && sql.includes("version = $8")) return rows([{}]);
      return insertedEvent(sql, params);
    });
    const runs = new PostgresRunRepository(db.pool, "byai");
    await runs.saveWithEvent({ ...run(), version: 1 }, event);
    const lock = db.calls.findIndex((call) => call.params?.[0] === "byclaw-run-event:run-1");
    const update = db.calls.findIndex((call) => call.sql.includes("UPDATE"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(update).toBeGreaterThan(lock);
  });

  it("rechecks queue candidates after locks and never claims a concurrently changed Run", async () => {
    let selections = 0;
    const db = fakeDatabase((sql) => {
      if (sql.includes("pg_try_advisory_xact_lock")) return rows([{ locked: true }]);
      if (sql.includes("SELECT r.id, r.session_id, r.attempt_no")) {
        selections += 1;
        return rows(selections === 1 ? [{ id: "run-1", session_id: "session-1", attempt_no: 1 }] : []);
      }
      return rows([]);
    });
    const queue = new PostgresRunExecutionQueue(db.pool, "byai");
    await expect(queue.claimNext("instance-b", 30_000)).resolves.toBeUndefined();
    const selectionsWithLocks = db.calls.filter((call) => call.sql.includes("SELECT r.id, r.session_id"));
    expect(selectionsWithLocks[0]?.sql).not.toContain("FOR UPDATE");
    expect(selectionsWithLocks[1]?.sql).toContain("FOR UPDATE OF r SKIP LOCKED");
    expect(selectionsWithLocks[1]?.sql).toContain("earlier.status = ANY");
    expect(db.calls.some((call) => call.sql.includes("UPDATE") && !call.sql.includes("FOR UPDATE"))).toBe(false);
  });

  it("retains the fencing counter and requires the entire claim to renew or release", async () => {
    const db = fakeDatabase(() => rows([{}]));
    const queue = new PostgresRunExecutionQueue(db.pool, "byai");
    await expect(queue.heartbeat(claim, 30_000)).resolves.toBe(true);
    await queue.release(claim);

    const heartbeat = db.calls[0]!;
    expect(heartbeat.sql).toContain("run_id = $5");
    expect(heartbeat.sql).toContain("attempt_no = $6");
    expect(heartbeat.params).toEqual(["session-1", "instance-a", 7, 30_000, "run-1", 2]);
    const release = db.calls[1]!;
    expect(release.sql).toContain("SET lease_expires_at = '-infinity'::timestamptz");
    expect(release.sql).not.toContain("DELETE");
    expect(release.sql).toContain("run_id = $4");
    expect(release.sql).toContain("attempt_no = $5");
    expect(release.params).toEqual(["session-1", "instance-a", 7, "run-1", 2]);
  });

  it("distinguishes losing ownership from a missing execution credential", async () => {
    const stale = new PostgresExecutionCredentialRepository(
      fakeDatabase(() => rows([{ lease_owned: false, run_id: null }])).pool, "byai",
    );
    const current = new PostgresExecutionCredentialRepository(
      fakeDatabase(() => rows([{ lease_owned: true, run_id: null }])).pool, "byai",
    );
    const input = { runId: claim.runId, instanceId: claim.ownerInstanceId, fencingToken: claim.fencingToken };
    await expect(stale.loadForLease(input)).rejects.toBeInstanceOf(ExecutionOwnershipLostError);
    await expect(current.loadForLease(input)).resolves.toBeUndefined();
  });

  it("does not recreate a credential after another instance finished or cancelled its Run", async () => {
    const db = fakeDatabase();
    const credentials = new PostgresExecutionCredentialRepository(db.pool, "byai");
    await expect(credentials.save({ runId: "run-1", secret: "refreshed-token", createdAt: 1 }))
      .rejects.toThrow("Run no longer accepts execution credentials");
    expect(db.calls[1]?.params).toEqual(["byclaw-run-event:run-1"]);
    expect(db.calls[2]?.sql).toContain("status NOT IN ('CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED')");
    expect(db.calls.some((call) => /INSERT INTO|UPDATE/.test(call.sql))).toBe(false);
  });

  it("skips a busy first candidate and claims an unrelated Session", async () => {
    const db = fakeDatabase((sql, params) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return rows([{ locked: params?.[0] !== "byclaw-run-event:busy-run" }]);
      }
      if (sql.includes("SELECT r.id, r.session_id, r.attempt_no")) {
        return rows(sql.includes("FOR UPDATE")
          ? [{ id: "other-run", session_id: "other-session", attempt_no: 0 }]
          : [{ id: "busy-run", session_id: "busy-session", attempt_no: 0 },
            { id: "other-run", session_id: "other-session", attempt_no: 0 }]);
      }
      if (sql.includes("RETURNING fencing_token")) return rows([{ fencing_token: 3, lease_expires_at: new Date(100_000) }]);
      return rows([]);
    });
    await expect(new PostgresRunExecutionQueue(db.pool, "byai").claimNext("instance-b", 30_000))
      .resolves.toMatchObject({ runId: "other-run", sessionId: "other-session", fencingToken: 3 });
  });

  it("orders locks consistently when a timeout sweep handles multiple Runs", async () => {
    const db = fakeDatabase((sql) => {
      if (sql.includes("SELECT d.id AS delegation_id, d.run_id") && !sql.includes("FOR UPDATE")) {
        return rows([{ delegation_id: "d-b", run_id: "run-b" }, { delegation_id: "d-a", run_id: "run-a" }]);
      }
      return rows([]);
    });
    await new PostgresRunExecutionQueue(db.pool, "byai").expireWaitingCallbacks({ limit: 100 });
    const lockKeys = db.calls.filter((call) => call.sql.includes("pg_advisory_xact_lock"))
      .map((call) => call.params?.[0]);
    expect(lockKeys).toEqual(["byclaw-run-event:run-a", "byclaw-run-event:run-b"]);
  });
});

describe("Postgres atomic ingress", () => {
  it("appends to the bound database Session and uses its context revision", async () => {
    const db = fakeDatabase((sql, params) => {
      if (sql.includes("SELECT session_id FROM")) return rows([{ session_id: "existing-session" }]);
      if (sql.includes("SELECT * FROM") && sql.includes("byai_super_sessions")) {
        return rows([sessionRow("existing-session", 4)]);
      }
      return insertedEvent(sql, params);
    });
    const runs = new PostgresRunRepository(db.pool, "byai");
    const stored = await runs.createIngressRun({
      session: session(), run: { ...run(), ingressContext: { externalSessionId: "original-route" } },
      event, binding, externalMessageId: "message-1",
    });

    expect(stored).toMatchObject({
      created: true, session: { id: "existing-session", contextRevision: 4 },
      run: { sessionId: "existing-session", baseContextRevision: 4, ingressContext: { parentMessageId: "message-1", externalSessionId: "original-route" } },
    });
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO") && call.sql.includes("byai_super_sessions"))).toBe(false);
    const inserted = db.calls.find((call) => call.sql.includes("INSERT INTO") && call.sql.includes('byai_super_runs"'));
    expect(inserted?.params?.[1]).toBe("existing-session");
    expect(inserted?.params?.[8]).toBe(4);
    expect(db.calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("returns a previously created Run on message replay without new state or credentials", async () => {
    const db = fakeDatabase((sql) => {
      if (sql.includes("SELECT session_id FROM")) return rows([{ session_id: "session-1" }]);
      if (sql.includes("SELECT * FROM") && sql.includes("byai_super_sessions")) return rows([sessionRow()]);
      if (sql.includes("parentMessageId")) return rows([runRow()]);
      return rows([]);
    });
    const runs = new PostgresRunRepository(db.pool, "byai");
    await expect(runs.createIngressRun({
      session: session(), run: run(), event, binding, externalMessageId: "message-1",
      credential: { runId: "run-1", secret: "not-written", createdAt: 1 },
    })).resolves.toMatchObject({ created: false, run: { id: "run-1" } });
    expect(db.calls.some((call) => /INSERT INTO|UPDATE|DELETE/.test(call.sql))).toBe(false);
    const lookup = db.calls.find((call) => call.sql.includes("parentMessageId"));
    expect(lookup?.params).toEqual(["session-1", "message-1"]);
  });

  it("creates the binding, Session, Run and initial event in one transaction", async () => {
    const db = fakeDatabase(insertedEvent);
    const runs = new PostgresRunRepository(db.pool, "byai");
    await expect(runs.createIngressRun({ session: session(), run: run(), event, binding, externalMessageId: "message-1" }))
      .resolves.toMatchObject({ created: true, session: { id: "session-1" } });
    const tables = db.calls.filter((call) => call.sql.includes("INSERT INTO")).map((call) => call.sql);
    expect(tables).toHaveLength(4);
    expect(tables[0]).toContain("byai_super_sessions");
    expect(tables[1]).toContain("byai_super_ingress_session_bindings");
    expect(tables[2]).toContain("byai_super_runs");
    expect(tables[3]).toContain("byai_super_run_events");
    expect(db.calls[0]?.sql).toBe("BEGIN");
    expect(db.calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("rejects a foreign or deleted bound Session without replacing its binding", async () => {
    const db = fakeDatabase((sql) => sql.includes("SELECT session_id FROM")
      ? rows([{ session_id: "foreign-session" }]) : rows([]));
    const runs = new PostgresRunRepository(db.pool, "byai");
    await expect(runs.createIngressRun({ session: session(), run: run(), event, binding, externalMessageId: "message-1" }))
      .rejects.toThrow("missing or belongs to another owner");
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO"))).toBe(false);
  });

  it("refuses to redirect an existing binding to a different Session", async () => {
    const db = fakeDatabase((sql) => sql.includes("SELECT session_id FROM")
      ? rows([{ session_id: "existing-session" }]) : rows([]));
    const bindings = new PostgresIngressSessionBindingRepository(db.pool, "byai");
    await expect(bindings.bind({ ...binding, sessionId: "new-session", now: 1 })).rejects.toThrow("rebinding is not allowed");
    expect(db.calls.some((call) => /INSERT INTO|UPDATE/.test(call.sql))).toBe(false);
  });

  it("recovers an ingress route from the database with an owner filter", async () => {
    const db = fakeDatabase(() => rows([runRow()]));
    const runs = new PostgresRunRepository(db.pool, "byai");
    await expect(runs.findIngressRun({ externalSessionId: "external-1", externalMessageId: "message-1", userCode: "user-1" }))
      .resolves.toMatchObject({ id: "run-1" });
    expect(db.calls[0]?.params).toEqual(["external-1", "message-1", "user-1"]);
    expect(db.calls[0]?.sql).toContain("s.user_code = $3");
  });

  it("refuses an ambiguous ingress route instead of cancelling a guessed Run", async () => {
    const db = fakeDatabase(() => rows([runRow(), { ...runRow(), id: "run-2" }]));
    const runs = new PostgresRunRepository(db.pool, "byai");
    await expect(runs.findIngressRun({ externalSessionId: "external-1", externalMessageId: "message-1" }))
      .rejects.toThrow("Ambiguous ingress Run route");
    expect(db.calls[0]?.params?.[2]).toBeNull();
  });
});

function session(): Session {
  return { id: "session-1", owner: { userCode: "user-1" }, sessionContext: createSessionContext(), sessionContextVersion: 1, contextRevision: 0, createdAt: 1, updatedAt: 1 };
}
function run(): Run {
  return { id: "run-1", sessionId: "session-1", input: "hello", agentList: [], status: "QUEUED", executionStage: "QUEUED", baseContextRevision: 0, attemptNo: 0, version: 0, createdAt: 1, updatedAt: 1 };
}
function sessionRow(id = "session-1", revision = 0) {
  return { id, user_code: "user-1", session_context: session().sessionContext, session_context_version: 1, context_revision: revision, created_at: new Date(1), updated_at: new Date(1) };
}
function runRow() {
  return { id: "run-1", session_id: "session-1", input: "hello", agent_snapshot: [], attachments: [], status: "QUEUED", execution_stage: "QUEUED", base_context_revision: 0, attempt_no: 0, version: 0, lease_fencing_token: null, final_answer: null, error_message: null, created_at: new Date(1), updated_at: new Date(1), started_at: null, finished_at: null };
}
function insertedEvent(sql: string, params: unknown[] = []) {
  return sql.includes("INSERT INTO") && sql.includes("byai_super_run_events")
    ? rows([{ run_id: params[0], event_id: 1, timestamp: params[1], type: params[2], data: JSON.parse(String(params[3])) }])
    : rows([]);
}
function rows(values: Record<string, unknown>[]) {
  return { rows: values, rowCount: values.length };
}
function fakeDatabase(handler = (_sql: string, _params?: unknown[]) => rows([])) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const state = { calls, handler, pool: undefined as unknown as Pool };
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, ...(params ? { params } : {}) });
    return state.handler(sql, params);
  });
  const client = { query, release: vi.fn() };
  state.pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
  return state;
}
