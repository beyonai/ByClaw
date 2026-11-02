import { disposableRedis } from "./disposable-redis.js";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Database } from "../../src/infrastructure/persistence/database.js";
import { ConnectionManager } from "../../src/application/connection-manager.js";
import { SqlGroupForwardStore } from "../../src/infrastructure/persistence/group-forward-prepare.js";
import type { SqlSession } from "../../src/application/database-ports.js";

/** All destructive setup is guarded by the exact opt-in disposable local database. Run serially. */
export async function forwardFixture() {
  const url = process.env.FORWARD_TEST_PG!;
  const a = new URL(url);
  if (a.hostname !== "127.0.0.1" || a.port !== "15486" || a.pathname !== "/byclaw_forward_test")
    throw Error("isolated forward fixture required");
  const { Pool } = createRequire(import.meta.url)("pg");
  const pool = new Pool({ connectionString: url, max: 5 });
  const sql = async (q: string, args: unknown[] = []) => (await pool.query(q, args)).rows;
  await sql("DROP SCHEMA IF EXISTS byai CASCADE");
  await sql(
    await readFile(
      new URL(
        "../../../deploy/migrations/versions/V0.6.0/tenant/V0.6.0__baseline__ddl.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const state = {
    enterpriseId: "1",
    generation: "7",
    dbSandboxRecordId: "80",
    host: "127.0.0.1",
    port: 15486,
    database: "byclaw_forward_test",
    user: "postgres",
    leaseUntil: new Date(Date.now() + 3600000).toISOString(),
    status: "READY",
    fencingToken: "9",
    credentialVersion: "1",
    passwordEnvelope: "fixture",
  };
  const coordination = await disposableRedis();
  const pendingLocks = new Set<string>();
  const locks = {
    acquire: async (key: string, mode?: "read" | "write") => {
      pendingLocks.add(key);
      try {
        return await coordination.locks.acquire(key, mode);
      } finally {
        pendingLocks.delete(key);
      }
    },
  };
  const connection = new ConnectionManager(state, {
    snapshot: async () => state,
    readAuthority: async () => undefined,
    saveAuthority: async () => {},
    decrypt: async () => "",
    open: (snapshot, password) => Database.open(snapshot, password, locks),
  });
  await connection.refresh();
  connection.setSchemaReady(true);
  let beforePublish: ((db: SqlSession) => Promise<void>) | undefined;
  const store = new SqlGroupForwardStore(
    {
      write: (work) =>
        connection.write((db) =>
          work({
            lock: db.lock,
            query: async (q, args) => {
              if (q.startsWith("INSERT INTO byai.byai_message ") && beforePublish) {
                const gate = beforePublish;
                beforePublish = undefined;
                await gate(db);
              }
              return db.query(q, args);
            },
          }),
        ),
    },
    "1",
  );
  const seed = async () => {
    await sql(
      "TRUNCATE byai.byai_group_chat_forward_item,byai.byai_group_chat_forward_target,byai.byai_group_chat_forward_request,byai.byai_message,byai.byai_session_member,byai.byai_session,byai.byai_session_ext,byai.byai_group_chat_topic CASCADE",
    );
    await sql(
      "INSERT INTO byai.byai_session(session_id,enterprise_id,session_type,state,creator_id,project_id,session_name) VALUES(10,1,'hs_as','ACTIVE',31,-1,'Source'),(20,1,'hs_as','ACTIVE',31,-1,'Target'),(21,1,'hs_as','ACTIVE',31,-1,'Failing')",
    );
    for (const group of [10, 20, 21])
      for (const user of [30, 31])
        await sql(
          "INSERT INTO byai.byai_session_member(byai_session_member_id,session_id,mem_obj_type,mem_obj_id,com_acct_id,user_role,mem_name) VALUES($1,$2,'USER',$3,1,$4,$5)",
          [
            group * 100 + user,
            group,
            user,
            user === 31 ? "OWNER" : "MEMBER",
            user === 31 ? "Admin" : "Human",
          ],
        );
    for (const [id, group, text] of [
      [101, 10, "first"],
      [102, 10, "second"],
      [201, 20, "reverse"],
    ] as const)
      await sql(
        "INSERT INTO byai.byai_message(id,message_id,enterprise_id,session_id,usage,creator_id,creator_name,message_content,create_time,related_resources,metadata) VALUES($1,$1,1,$2,1,30,'Human',$3,'2026-10-16','{}','{}')",
        [id, group, text],
      );
  };
  await seed();
  const actor = { userId: "30", enterpriseId: "1" };
  const ready = async (source = "10", target = "20", ids = ["101", "102"], key = "key") => {
    const operation = await store.prepare(actor, source, {
      clientRequestId: key,
      mode: "SINGLE",
      messageIds: ids,
      targetSessionIds: [target],
    });
    const [row] = await sql(
      "SELECT target_id FROM byai.byai_group_chat_forward_target WHERE request_id=$1",
      [operation.requestId],
    );
    await store.freezeSources(
      await store.claimRequest(operation.requestId, actor, source, "resolve", 60000),
      { proofs: [], resolutions: [] },
    );
    return store.markReady(
      await store.claimTarget(operation.requestId, row.target_id, actor, source, "copy", 60000),
    );
  };
  return {
    pendingLocks,
    pool,
    sql,
    connection,
    store,
    actor,
    state,
    seed,
    ready,
    pausePublish: (gate: (db: SqlSession) => Promise<void>) => {
      beforePublish = gate;
    },
    close: async () => {
      await connection.close();
      await pool.end();
      await coordination.close();
    },
  };
}
