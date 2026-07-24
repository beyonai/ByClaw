import { randomBytes, randomUUID } from "node:crypto";
import {
  ConnectorRegistry,
  DelegationService,
  EnvelopeExecutionCredentialCipher,
  RunService,
  createPiSessionCheckpoint,
  type EncryptedExecutionCredential,
  type KeyEncryptionService,
  type KmsEncryptionContext,
  type LeaderSessionFactory,
  type PiSessionCheckpoint,
  type Run,
  type Session,
} from "@byclaw/by-conductor";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/postgres-database.js";

const integrationEnabled = process.env.POSTGRES_INTEGRATION === "true";
const suite = integrationEnabled ? describe : describe.skip;

suite("PostgreSQL persistence integration", () => {
  let database: PostgresDatabase;
  const sessionsToDelete: string[] = [];

  beforeAll(async () => {
    database = new PostgresDatabase({
      host: process.env.DB_HOST ?? "127.0.0.1",
      port: Number(process.env.DB_PORT ?? "5432"),
      database: process.env.DB_DATABASE ?? "postgres",
      schema: process.env.DB_SCHEMA ?? "byai",
      user: requiredEnv("DB_USER"),
      password: requiredEnv("DB_PASS"),
      eventPollMs: 10,
      eventListenEnabled:
        process.env.DB_EVENT_LISTEN_ENABLED !== "false",
    });
    await database.migrate();
    await database.start();
    expect(database.events.listenerHealth()).toMatchObject({ healthy: true });
  });

  afterAll(async () => {
    if (!database) {
      return;
    }
    if (sessionsToDelete.length > 0) {
      await database.pool.query(
        `DELETE FROM "${database.schema}"."sessions" WHERE id = ANY($1::uuid[])`,
        [sessionsToDelete],
      );
    }
    await database.close();
  });

  it("isolates owners, replays events and persists external bindings", async () => {
    const first = session("user-a");
    const second = session("user-b");
    sessionsToDelete.push(first.id, second.id);
    await database.sessions.save(first);
    await database.sessions.save(second);

    expect(await database.sessions.getOwned(first.id, { userCode: "user-a" })).toBeDefined();
    expect(await database.sessions.getOwned(first.id, { userCode: "user-b" })).toBeUndefined();

    await database.bindings.bind({
      source: "by-framework",
      userCode: "user-a",
      externalSessionId: "same-external",
      sessionId: first.id,
      now: Date.now(),
    });
    await database.bindings.bind({
      source: "by-framework",
      userCode: "user-b",
      externalSessionId: "same-external",
      sessionId: second.id,
      now: Date.now(),
    });
    await expect(
      database.bindings.get({
        source: "by-framework",
        userCode: "user-a",
        externalSessionId: "same-external",
      }),
    ).resolves.toBe(first.id);
    await expect(
      database.bindings.get({
        source: "by-framework",
        userCode: "user-b",
        externalSessionId: "same-external",
      }),
    ).resolves.toBe(second.id);

    const run = queuedRun(first.id);
    await database.runs.createWithEvent?.(run, {
      runId: run.id,
      timestamp: Date.now(),
      type: "run.created",
      data: { status: "QUEUED" },
    });
    await expect(database.runs.getOwned(run.id, { userCode: "user-b" })).resolves.toBeUndefined();
    expect((await database.events.list(run.id)).map((event) => event.type)).toEqual([
      "run.created",
    ]);
    const delegationId = randomUUID();
    await database.delegations.save({
      id: delegationId,
      runId: run.id,
      agentId: "agent-1",
      connectorId: "openclaw-by-framework",
      task: "resume-safe",
      status: "QUEUED",
      version: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const queuedDelegation = await database.delegations.get(delegationId);
    await database.delegations.save({
      ...queuedDelegation!,
      status: "RUNNING",
      externalRef: {
        connectorId: "openclaw-by-framework",
        executionId: "trace-1",
      },
      connectorCursor: "3-0",
      partialOutput: "partial",
      version: 1,
      updatedAt: Date.now(),
    });
    await expect(database.delegations.get(delegationId)).resolves.toMatchObject({
      connectorCursor: "3-0",
      partialOutput: "partial",
    });
    await database.runs.saveWithEvent?.(
      {
        ...run,
        status: "COMPLETED",
        executionStage: "SETTLED",
        finalAnswer: "done",
        version: 1,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
      },
      {
        runId: run.id,
        timestamp: Date.now(),
        type: "run.completed",
        data: { status: "COMPLETED", finalAnswer: "done" },
      },
    );
  });

  it("hands an expired lease to another instance and fences the old owner", async () => {
    const owner = session("lease-user");
    sessionsToDelete.push(owner.id);
    await database.sessions.save(owner);
    const run = queuedRun(owner.id);
    await database.runs.createWithEvent?.(run, {
      runId: run.id,
      timestamp: Date.now(),
      type: "run.created",
      data: { status: "QUEUED" },
    });

    const first = await database.queue.claimNext("instance-a", 30_000);
    expect(first?.runId).toBe(run.id);
    await expect(database.queue.claimNext("instance-b", 30_000)).resolves.toBeUndefined();

    const credential = encryptedCredential(run.id);
    await database.credentials.save(credential);
    await expect(
      database.credentials.loadForLease({
        runId: run.id,
        instanceId: "instance-a",
        fencingToken: first?.fencingToken ?? 0,
        now: Date.now(),
      }),
    ).resolves.toMatchObject({ runId: run.id });

    await database.pool.query(
      `UPDATE "${database.schema}"."session_execution_leases"
          SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE session_id = $1`,
      [owner.id],
    );
    const second = await database.queue.claimNext("instance-b", 30_000);
    expect(second?.runId).toBe(run.id);
    expect(second?.fencingToken).toBeGreaterThan(first?.fencingToken ?? 0);
    await expect(database.queue.heartbeat(first!, 30_000)).resolves.toBe(false);
    await expect(
      database.credentials.loadForLease({
        runId: run.id,
        instanceId: "instance-a",
        fencingToken: first?.fencingToken ?? 0,
        now: Date.now(),
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps PENDING Pi entries private and promotes them with revision CAS", async () => {
    const owner = session("pi-user");
    sessionsToDelete.push(owner.id);
    await database.sessions.save(owner);
    const run = queuedRun(owner.id);
    await database.runs.createWithEvent?.(run, {
      runId: run.id,
      timestamp: Date.now(),
      type: "run.created",
      data: { status: "QUEUED" },
    });
    const entryId = randomUUID();
    const checkpoint = createPiSessionCheckpoint({
      piSdkVersion: "0.80.10",
      header: {
        type: "session",
        version: 3,
        id: owner.id,
        timestamp: new Date().toISOString(),
        cwd: "/srv/byclaw-super",
      },
      entries: [{
        type: "message",
        id: entryId,
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: "persistent-context",
          timestamp: Date.now(),
        },
      }] as PiSessionCheckpoint["entries"],
      activeLeafId: entryId,
    });

    await database.checkpoints.stagePending({
      sessionId: owner.id,
      runId: run.id,
      attemptNo: 1,
      baseRevision: 0,
      checkpoint,
      now: Date.now(),
    });
    expect((await database.checkpoints.load(owner.id))?.checkpoint.entries).toHaveLength(0);
    expect(
      JSON.stringify(
        (await database.checkpoints.loadWorking({
          sessionId: owner.id,
          runId: run.id,
          attemptNo: 1,
        }))?.checkpoint.entries,
      ),
    ).toContain("persistent-context");

    const committed = await database.checkpoints.commit({
      sessionId: owner.id,
      runId: run.id,
      attemptNo: 1,
      expectedRevision: 0,
      checkpoint,
      now: Date.now(),
    });
    expect(committed.revision).toBe(1);
    expect(JSON.stringify((await database.checkpoints.load(owner.id))?.checkpoint.entries)).toContain(
      "persistent-context",
    );
    await expect(
      database.checkpoints.commit({
        sessionId: owner.id,
        runId: run.id,
        attemptNo: 1,
        expectedRevision: 0,
        checkpoint,
        now: Date.now(),
      }),
    ).rejects.toThrow("revision conflict");
  });

  it("lets two RunService instances compete while executing a Run only once", async () => {
    const kms = new IntegrationKms();
    const cipher = new EnvelopeExecutionCredentialCipher(kms);
    const executions: string[] = [];
    const first = createPersistentRunService("instance-a", cipher, executions);
    const second = createPersistentRunService("instance-b", cipher, executions);
    first.start();
    second.start();
    try {
      const run = await first.createSessionRun({
        owner: { userCode: "queue-user" },
        message: "execute-once",
        agentList: [],
        executionCredential: {
          secret: "short-lived-token",
          expiresAt: Date.now() + 60_000,
        },
      });
      sessionsToDelete.push(run.sessionId);
      await waitFor(async () => (await database.runs.get(run.id))?.status === "COMPLETED");

      expect(executions).toEqual(["execute-once"]);
      const credentials = await database.pool.query(
        `SELECT 1 FROM "${database.schema}"."run_execution_credentials" WHERE run_id = $1`,
        [run.id],
      );
      expect(credentials.rowCount).toBe(0);
    } finally {
      await Promise.all([first.dispose(), second.dispose()]);
    }
  });

  function createPersistentRunService(
    instanceId: string,
    cipher: EnvelopeExecutionCredentialCipher,
    executions: string[],
  ): RunService {
    const connectors = new ConnectorRegistry();
    const delegationService = new DelegationService(
      connectors,
      database.delegations,
      database.events,
      1_000,
    );
    const leaders: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            executions.push(input.message);
            await input.onDelta("done");
            return { text: "done" };
          },
          checkpoint() {
            return undefined;
          },
          markCommitted() {},
          async abort() {},
          dispose() {},
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    return new RunService(
      database.sessions,
      database.runs,
      database.delegations,
      database.events,
      delegationService,
      leaders,
      Date.now,
      randomUUID,
      {
        executionQueue: database.queue,
        credentials: database.credentials,
        credentialCipher: cipher,
        instanceId,
        leaseMs: 5_000,
        queuePollMs: 10,
        maxConcurrentRuns: 1,
      },
    );
  }
});

function session(userCode: string): Session {
  const now = Date.now();
  return {
    id: randomUUID(),
    owner: { userCode },
    contextRevision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function queuedRun(sessionId: string): Run {
  const now = Date.now();
  return {
    id: randomUUID(),
    sessionId,
    input: "hello",
    agentList: [],
    status: "QUEUED",
    baseContextRevision: 0,
    attemptNo: 0,
    executionStage: "QUEUED",
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function encryptedCredential(runId: string): EncryptedExecutionCredential {
  const now = Date.now();
  return {
    runId,
    ciphertext: randomBytes(16),
    encryptedDataKey: randomBytes(48),
    keyVersion: "test-v1",
    nonce: randomBytes(12),
    authTag: randomBytes(16),
    aadVersion: 1,
    expiresAt: now + 60_000,
    createdAt: now,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for PostgreSQL integration tests`);
  }
  return value;
}

class IntegrationKms implements KeyEncryptionService {
  readonly #keys = new Map<string, { key: Uint8Array; context: string }>();

  async generateDataKey(context: KmsEncryptionContext) {
    const id = randomUUID();
    const key = randomBytes(32);
    this.#keys.set(id, {
      key: Uint8Array.from(key),
      context: JSON.stringify(context),
    });
    return {
      plaintextKey: Uint8Array.from(key),
      encryptedKey: Buffer.from(id),
      keyVersion: "integration-v1",
    };
  }

  async decryptDataKey(input: {
    encryptedKey: Uint8Array;
    keyVersion: string;
    context: KmsEncryptionContext;
  }): Promise<Uint8Array> {
    const stored = this.#keys.get(Buffer.from(input.encryptedKey).toString());
    if (
      !stored ||
      input.keyVersion !== "integration-v1" ||
      stored.context !== JSON.stringify(input.context)
    ) {
      throw new Error("integration KMS context mismatch");
    }
    return Uint8Array.from(stored.key);
  }
}

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for PostgreSQL Run");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
