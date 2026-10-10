import { vi } from "vitest";
import type { Config } from "../src/config.js";
import type { TenantSnapshot } from "../src/domain/tenant.js";
import type { TenantDatabase } from "../src/application/database-ports.js";
import type { TenantCommand } from "../src/application/command.js";
import type { MirrorEnvelope, AnswerState } from "../src/domain/mirror.js";
import type { SchemaTask, SchemaManifest } from "../src/application/schema/types.js";
import { commandHash } from "../src/interfaces/contracts/command.js";
import { mirrorHash } from "../src/interfaces/contracts/mirror.js";
export const identity = { enterpriseId: "10", generation: "7", dbSandboxRecordId: "80" };
export const config: Config = {
  ...identity,
  tenantId: "10",
  instanceId: "test",
  host: "localhost",
  port: 3100,
  advertiseHost: "node.test",
  stateDir: "/tmp/tenant-test",
  beUrl: "https://be.test/byaiService",
  kmsUrl: "https://kms.test/decrypt",
  beClientIdentity: "byclaw-be",
  tls: { certFile: "cert", keyFile: "key", caFile: "ca" },
  redis: {
    host: "redis.test",
    port: 6379,
    db: 0,
    username: "tenant10",
    password: "test-only",
    tls: {},
  },
};
export function snapshot(overrides: Partial<TenantSnapshot> = {}): TenantSnapshot {
  return {
    ...identity,
    host: "db.test",
    port: 5432,
    database: "byclaw_t_10",
    user: "bc_t_10_admin",
    passwordEnvelope: "envelope",
    credentialVersion: "1",
    fencingToken: "9",
    leaseUntil: new Date(Date.now() + 60000).toISOString(),
    status: "READY",
    ...overrides,
  };
}
export function database(): TenantDatabase {
  const db: TenantDatabase = {
    query: vi.fn(async () => []),
    verifyIdentity: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    fresh: vi.fn(async () => db),
    transaction: vi.fn(async (work, guard) => {
      const value = await work(db);
      await guard?.();
      return value;
    }),
    exclusive: vi.fn(async (work) => work(db)),
  };
  return db;
}
export function command(overrides: Partial<TenantCommand> = {}): TenantCommand {
  const c: TenantCommand = {
    protocolVersion: 1,
    ...identity,
    userId: "20",
    sessionId: "30",
    requestId: "request",
    operation: "CREATE_SESSION",
    tenantMemberUserIds: ["20", "21"],
    payload: { sessionName: "Hello" },
    requestHash: "",
    ...overrides,
  };
  c.requestHash = commandHash(c);
  return c;
}
export function event(overrides: Partial<MirrorEnvelope> = {}): MirrorEnvelope {
  const e: MirrorEnvelope = {
    protocolVersion: 1,
    ...identity,
    sessionId: "30",
    clientRequestId: "client",
    runId: "run",
    traceId: "trace",
    userMessageId: "100",
    answerMessageId: "101",
    eventId: "event1",
    sourceStreamId: null,
    childOrdinal: 0,
    eventSeq: "1",
    eventType: "DELTA",
    payload: { id: "201", text: "hi" },
    payloadHash: "",
    ...overrides,
  };
  e.payloadHash = mirrorHash(e);
  return e;
}
export function answer(overrides: Partial<AnswerState> = {}): AnswerState {
  return {
    id: "201",
    messageId: "101",
    sessionId: "30",
    runId: "run",
    content: "",
    finalContent: null,
    metadata: {},
    version: "0",
    lastSourceId: null,
    lastSeq: "0",
    complete: false,
    status: 0,
    eventId: "",
    hash: "",
    ...overrides,
  };
}
export function task(overrides: Partial<SchemaTask> = {}): SchemaTask {
  return {
    protocolVersion: 1,
    ...identity,
    auditId: "audit-s1",
    requestId: "request",
    attemptNo: 1,
    fencingToken: "9",
    operationType: "INIT",
    triggerType: "MANUAL",
    byclawReleaseVersion: "2.9.0",
    fromVersion: null,
    targetVersion: "S1",
    bundleDigest: "a".repeat(64),
    deadline: new Date(Date.now() + 60000).toISOString(),
    scripts: [
      { version: "S1", parentVersion: null, path: "baseline/S1/__ddl.sql", sha256: "b".repeat(64) },
    ],
    ...overrides,
  };
}
export function manifest(): SchemaManifest {
  return {
    version: "S1",
    parentVersion: null,
    engine: "openGauss",
    nodeProtocol: { min: 1, max: 1 },
    sqlSha256: "b".repeat(64),
    catalogDigest: "c".repeat(64),
    objects: [{ kind: "table", name: "t" }],
  };
}
