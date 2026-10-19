import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { validateScript } from "../src/infrastructure/schema/script-validator.js";

const names = [
  "byai_group_chat_forward_request",
  "byai_group_chat_forward_target",
  "byai_group_chat_forward_item",
  "idx_forward_request_recovery",
  "idx_forward_target_recovery",
  "idx_forward_target_delivery",
  "idx_forward_item_message",
];
describe("forwarding update execution contract", () => {
  it("accepts the approved tenant increment through the existing strict UPDATE validator", async () => {
    const sql = await readFile(
      new URL("../../deploy/migrations/versions/V0.6.0/tenant/V0.6.0__ddl.sql", import.meta.url),
      "utf8",
    );
    expect(() =>
      validateScript(
        sql,
        names.map((name) => ({ name, kind: name.startsWith("idx_") ? "index" : "table" })),
        "UPDATE",
      ),
    ).not.toThrow();
  });
});

import { createRequire } from "node:module";
import { Database } from "../src/infrastructure/persistence/database.js";
import { ConnectionManager } from "../src/application/connection-manager.js";
import { catalogDigest, readMarker } from "../src/infrastructure/schema/catalog.js";
import { SchemaTaskRunner } from "../src/application/schema/task-runner.js";
import { schemaPorts } from "../src/infrastructure/schema/task-adapter.js";
import { SchemaReadiness } from "../src/infrastructure/schema/readiness.js";
import { sha256 } from "../src/interfaces/contracts/validation.js";
import { snapshot, task } from "./fixtures.js";
import type { SchemaResult } from "../src/application/schema/types.js";

const pgUrl = process.env.FORWARD_TEST_PG;
describe.skipIf(!pgUrl)(
  "candidate schema replay on the explicitly isolated PostgreSQL engine",
  () => {
    it("INIT and UPDATE reach the same complete catalog through the existing runtime and fresh verification", async () => {
      const address = new URL(pgUrl!);
      if (
        address.hostname !== "127.0.0.1" ||
        address.port !== "15486" ||
        address.pathname !== "/byclaw_forward_test"
      )
        throw Error("isolated forwarding database required");
      const { Client } = createRequire(import.meta.url)("pg");
      const admin = new Client({ connectionString: pgUrl });
      await admin.connect();
      // A disposable unprivileged role mirrors tenant ownership; postgres itself owns system catalogs.
      const role = `forward_schema_fixture_${process.pid}`;
      let connection: ConnectionManager | undefined;
      let createdRole = false;
      try {
        await admin.query(`CREATE ROLE ${role} LOGIN`);
        createdRole = true;
        await admin.query(`GRANT CREATE ON DATABASE byclaw_forward_test TO ${role}`);
        await admin.query("DROP SCHEMA IF EXISTS byai CASCADE");
        const state = snapshot({
          enterpriseId: "1",
          host: "127.0.0.1",
          port: 15486,
          database: "byclaw_forward_test",
          user: role,
          status: "ADMIN_ONLY",
        });
        connection = new ConnectionManager(state, {
          snapshot: async () => state,
          readAuthority: async () => undefined,
          saveAuthority: async () => {},
          decrypt: async () => "",
          open: Database.open,
        });
        await connection.refresh();
        const db = connection.database();
        let audited: string | null = null;
        let bytes = Buffer.alloc(0);
        const be = {
          currentVersion: async () => audited,
          report: async (result: SchemaResult) => {
            if (result.status === "VERIFIED") audited = result.observedVersion;
          },
        };
        const files = {
          saveBundle: async () => {},
          loadBundle: async () => bytes,
          read: async () => undefined,
          save: async () => {},
          list: async () => [],
          cleanup: async () => {},
        };
        const runner = new SchemaTaskRunner(schemaPorts(connection, files as any, be as any));
        async function apply(kind: "baseline" | "update") {
          const directory = kind === "baseline" ? "baseline" : "updates";
          bytes = await readFile(new URL(`../${directory}/V0.6.0__${kind}.zip`, import.meta.url));
          const manifest = JSON.parse(
            await readFile(
              new URL(`../${directory}/V0.6.0__${kind}__manifest.json`, import.meta.url),
              "utf8",
            ),
          );
          const result: SchemaResult = {
            task: task({
              enterpriseId: "1",
              fencingToken: state.fencingToken,
              operationType: kind === "baseline" ? "INIT" : "UPDATE",
              fromVersion: audited,
              targetVersion: "V0.6.0",
              bundleDigest: sha256(bytes),
              scripts: [
                {
                  version: "V0.6.0",
                  parentVersion: audited,
                  path: `${kind === "baseline" ? "baseline" : "versions"}/V0.6.0/__ddl.sql`,
                  sha256: manifest.sqlSha256,
                },
              ],
            }),
            status: "PENDING",
            observedVersion: audited,
            acceptedAt: new Date().toISOString(),
            cleanupStatus: "RETAINED_UNTIL_ACK",
            steps: [],
          };
          await runner.run(result);
          expect(result.status, JSON.stringify(result)).toBe("VERIFIED");
          expect(await catalogDigest(db)).toBe(manifest.catalogDigest);
          const readiness = new SchemaReadiness(connection!, be as any);
          await readiness.check();
          expect(readiness.state.verified).toBe(true);
          return await readMarker(db, "1");
        }
        const fresh = await apply("baseline");
        await admin.query("DROP SCHEMA byai CASCADE");
        const old = await readFile(
          new URL(
            "../../deploy/migrations/versions/V0.5.0/tenant/V0.5.0__baseline__ddl.sql",
            import.meta.url,
          ),
          "utf8",
        );
        await db.transaction(async (session) => {
          for (const statement of (
            await import("../src/infrastructure/schema/sql-framing.js")
          ).frameSql(old))
            await session.query(statement);
        });
        const parent = {
          protocolVersion: 1,
          enterpriseId: "1",
          version: "V0.5.0",
          catalogDigest: await catalogDigest(db),
          scriptDigest: sha256(old),
        };
        await db.query(`COMMENT ON SCHEMA byai IS '${JSON.stringify(parent)}'`);
        audited = (await readMarker(db, "1"))!.version;
        const upgraded = await apply("update");
        expect(upgraded!.catalogDigest).toBe(fresh!.catalogDigest);
        expect(upgraded!.scriptDigest).not.toBe(fresh!.scriptDigest);
        expect(
          (
            await db.query(
              "SELECT table_name FROM information_schema.tables WHERE table_schema='byai'",
            )
          ).length,
        ).toBe(18);
        await expect(
          db.query(
            "INSERT INTO byai.byai_group_chat_forward_request(request_id,enterprise_id,actor_user_id,backend,source_session_id,client_request_id,mode,request_hash,snapshot_version,frozen_json) VALUES(1,1,1,'GUESS',1,'x','SINGLE','hash',1,'{}')",
          ),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await connection?.close();
        if (createdRole) {
          await admin.query("DROP SCHEMA IF EXISTS byai CASCADE");
          await admin.query(`REVOKE CREATE ON DATABASE byclaw_forward_test FROM ${role}`);
          await admin.query(`DROP ROLE ${role}`);
        }
        await admin.end();
      }
    }, 30000);
  },
);

import { beforeAll, afterAll, beforeEach } from "vitest";
import { forwardFixture } from "./support/forward-pg-fixture.js";
import { CommandService } from "../src/application/command-service.js";
import { SqlCommandTransactions } from "../src/infrastructure/persistence/command-repository.js";
import { command } from "./fixtures.js";

// Pause after final validation at the first real message INSERT, while production group locks are held.
describe.skipIf(!pgUrl)("real two-connection publication boundaries", () => {
  let f: Awaited<ReturnType<typeof forwardFixture>>;
  beforeAll(async () => {
    f = await forwardFixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  beforeEach(async () => {
    await f.seed();
  });
  it("opposite forwards share numeric group order and both commit", async () => {
    const a = await f.ready(),
      b = await f.ready("20", "10", ["201"], "reverse");
    const results = await Promise.all([f.store.commit(a), f.store.commit(b)]);
    expect(results.map((r) => r.messageIds.length)).toEqual([2, 1]);
    expect(
      (
        await f.sql(
          "SELECT count(*) AS n FROM byai.byai_group_chat_forward_target WHERE state='SUCCEEDED'",
        )
      )[0].n,
    ).toBe("2");
  });
  it.each(["RECALL_MESSAGE", "REMOVE_MEMBER"] as const)(
    "%s writer blocks after final validation until publication commits",
    async (operation) => {
      const lease = await f.ready();
      let release!: () => void;
      let observed!: (pid: number) => void;
      const reached = new Promise<number>((resolve) => {
        observed = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.pausePublish(async (db) => {
        observed(Number((await db.query("SELECT pg_backend_pid() AS pid"))[0].pid));
        await hold;
      });
      const publishing = f.store.commit(lease);
      const pid = await reached;
      const commands = new CommandService(new SqlCommandTransactions(f.connection));
      const c = command({
        enterpriseId: "1",
        userId: operation === "RECALL_MESSAGE" ? "30" : "31",
        sessionId: "10",
        requestId: operation,
        operation,
        payload:
          operation === "RECALL_MESSAGE"
            ? { messageId: "101" }
            : { memObjId: "30", memObjType: "USER" },
        tenantMemberUserIds: ["30", "31"],
      });
      const competing = commands.execute(c).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      try {
        await expect
          .poll(
            async () =>
              Number(
                (
                  await f.sql(
                    "SELECT count(*) AS n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",
                    [pid],
                  )
                )[0].n,
              ),
            { timeout: 3000 },
          )
          .toBe(1);
      } finally {
        release();
      }
      expect((await publishing).messageIds).toHaveLength(2);
      expect(await competing).not.toHaveProperty("error");
      expect(
        (
          await f.sql(
            "SELECT count(*) AS n FROM byai.byai_message WHERE session_id=20 AND metadata LIKE '%FORWARD_SINGLE%'",
          )
        )[0].n,
      ).toBe("2");
    },
  );
  it.each(["RECALL_MESSAGE", "REMOVE_MEMBER"] as const)(
    "%s completed before publication is rechecked and rejected",
    async (operation) => {
      const lease = await f.ready();
      const commands = new CommandService(new SqlCommandTransactions(f.connection));
      await commands.execute(
        command({
          enterpriseId: "1",
          userId: operation === "RECALL_MESSAGE" ? "30" : "31",
          sessionId: "10",
          requestId: operation,
          operation,
          payload:
            operation === "RECALL_MESSAGE"
              ? { messageId: "101" }
              : { memObjId: "30", memObjType: "USER" },
          tenantMemberUserIds: ["30", "31"],
        }),
      );
      await expect(f.store.commit(lease)).rejects.toMatchObject({
        code: "RESOURCE_NOT_ACCESSIBLE",
      });
      expect(
        (await f.sql("SELECT count(*) AS n FROM byai.byai_message WHERE session_id=20"))[0].n,
      ).toBe("1");
    },
  );
  it("a second actual insert failure rolls back every message binding and receipt", async () => {
    const lease = await f.ready();
    await f.sql(
      "ALTER TABLE byai.byai_message ADD CONSTRAINT fixture_second_failure CHECK(session_id<>20 OR message_content<>'second')",
    );
    try {
      await expect(f.store.commit(lease)).rejects.toThrow();
    } finally {
      await f.sql("ALTER TABLE byai.byai_message DROP CONSTRAINT fixture_second_failure");
    }
    expect(
      (await f.sql("SELECT count(*) AS n FROM byai.byai_message WHERE session_id=20"))[0].n,
    ).toBe("1");
    expect(
      (
        await f.sql(
          "SELECT count(*) AS n FROM byai.byai_group_chat_forward_item WHERE bound_message_id IS NOT NULL",
        )
      )[0].n,
    ).toBe("0");
    expect(
      (await f.sql("SELECT state,pending_delivery FROM byai.byai_group_chat_forward_target"))[0],
    ).toEqual({ state: "READY", pending_delivery: false });
  });
  it("the baseline unbound project sentinel is null but other invalid IDs still reject", async () => {
    const operation = await f.store.prepare(f.actor, "10", {
      clientRequestId: "project",
      mode: "SINGLE",
      messageIds: ["101"],
      targetSessionIds: ["20"],
    });
    const lease = await f.store.claimRequest(operation.requestId, f.actor, "10", "proof", 60000);
    expect(((await f.store.source(lease, "101")) as any).authority.projectId).toBeNull();
    await f.sql("UPDATE byai.byai_session SET project_id=70 WHERE session_id=10");
    expect(((await f.store.source(lease, "101")) as any).authority.projectId).toBe("70");
    await f.sql("UPDATE byai.byai_session SET project_id=-2 WHERE session_id=10");
    await expect(f.store.source(lease, "101")).rejects.toMatchObject({ code: "INVALID_ID" });
  });
  it("a replacement target lease fences the previous publisher", async () => {
    const old = await f.ready();
    await f.sql(
      "UPDATE byai.byai_group_chat_forward_target SET lease_until=clock_timestamp()-interval '1 second' WHERE target_id=$1",
      [old.targetId],
    );
    const replacement = await f.store.claimTarget(
      old.requestId,
      old.targetId,
      f.actor,
      "10",
      "replacement",
      60000,
    );
    expect(BigInt(replacement.fencingVersion)).toBeGreaterThan(BigInt(old.fencingVersion));
    await expect(f.store.commit(old)).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    expect((await f.store.commit(replacement)).messageIds).toHaveLength(2);
  });
});
