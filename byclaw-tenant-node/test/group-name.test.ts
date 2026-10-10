import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { createSession } from "../src/infrastructure/persistence/session-writer.js";
import { command } from "./fixtures.js";

describe("workgroup name reuse", () => {
  let database: DatabaseSync;
  let sequence: number;
  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    sequence = 1;
    database.exec(`
      ATTACH DATABASE ':memory:' AS byai;
      CREATE TABLE byai.byai_session (
        session_id TEXT PRIMARY KEY, creator_id TEXT, enterprise_id TEXT,
        session_name TEXT, session_content TEXT, session_type TEXT, project_id TEXT,
        state TEXT, last_seq TEXT, create_time TEXT, update_time TEXT
      );
      CREATE TABLE byai.byai_session_member (
        byai_session_member_id TEXT, session_id TEXT, mem_obj_type TEXT, mem_obj_id TEXT,
        user_role TEXT, mem_name TEXT, creator_id TEXT, com_acct_id TEXT, create_time TEXT
      );
      CREATE TABLE byai.byai_session_ext (
        ext_id TEXT, session_id TEXT, ext_param_name TEXT, ext_param_code TEXT, ext_param_value TEXT
      );
    `);
    database.function("hashtext", (value) => value);
    database.function("btrim", (value, characters) => {
      const trim = new Set(String(characters));
      let name = String(value);
      while (trim.has(name[0]!)) name = name.slice(1);
      while (trim.has(name.at(-1)!)) name = name.slice(0, -1);
      return name;
    });
    database.function("pg_advisory_xact_lock", (_value) => null);
  });
  afterEach(() => database.close());
  function oldGroup(state: string | null, enterprise = "10", creator = "20", name = "Team") {
    database
      .prepare("INSERT INTO byai.byai_session VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        "29",
        creator,
        enterprise,
        name,
        "original goal",
        "hs_as",
        "49",
        state,
        "0",
        "old",
        "old",
      );
  }
  function context() {
    const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
      if (sql.includes("nextval(")) return [{ id: String(sequence++) }];
      const values = parameters.map((v) => (v instanceof Date ? v.toISOString() : v));
      const bindings: unknown[] = [];
      const sqliteSql = sql.replace(/\$(\d+)/g, (_placeholder, index) => {
        bindings.push(values[Number(index) - 1]);
        return "?";
      });
      return database.prepare(sqliteSql).all(...(bindings as any[])) as any[];
    });
    return {
      query,
      context: new CommandContext(
        { query },
        command({
          operation: "CREATE_GROUP",
          payload: {
            sessionName: " Team ",
            projectId: "50",
            members: [{ memObjType: "USER", memObjId: "20", userRole: "OWNER" }],
          },
        }),
      ),
    };
  }
  it.each(["ACTIVE", null])("rejects a same-name group with state %s", async (state) => {
    oldGroup(state);
    await expect(createSession(context().context)).rejects.toThrow("GROUP_NAME_EXISTS");
    expect(database.prepare("SELECT COUNT(*) AS total FROM byai.byai_session").get()).toMatchObject(
      { total: 1 },
    );
  });
  it("recognizes legacy names containing ASCII whitespace around the name", async () => {
    oldGroup("ACTIVE", "10", "20", "\tTeam\n");
    await expect(createSession(context().context)).rejects.toThrow("GROUP_NAME_EXISTS");
  });
  it("does not conflate Unicode whitespace with Java-trimmed names", async () => {
    oldGroup("ACTIVE", "10", "20", "\u00a0Team\u00a0");
    await expect(createSession(context().context)).resolves.toBeUndefined();
  });
  it("creates new IDs after dissolution while preserving the old group", async () => {
    oldGroup("GROUP_DISSOLVED");
    await createSession(context().context);
    expect(
      database
        .prepare(
          "SELECT session_id,project_id,session_name,state,session_content FROM byai.byai_session ORDER BY session_id",
        )
        .all(),
    ).toEqual([
      expect.objectContaining({
        session_id: "29",
        project_id: "49",
        session_name: "Team",
        state: "GROUP_DISSOLVED",
        session_content: "original goal",
      }),
      expect.objectContaining({
        session_id: "30",
        project_id: "50",
        session_name: "Team",
        state: "ACTIVE",
      }),
    ]);
  });
  it.each([
    ["11", "20"],
    ["10", "21"],
  ])("does not reserve names from tenant %s creator %s", async (tenant, creator) => {
    oldGroup("ACTIVE", tenant, creator);
    await expect(createSession(context().context)).resolves.toBeUndefined();
  });
  it("locks the tenant, creator and normalized name before checking availability", async () => {
    const s = context();
    await createSession(s.context);
    const lock = s.query.mock.calls.findIndex(([sql]) => sql.includes("pg_advisory_xact_lock"));
    const check = s.query.mock.calls.findIndex(
      ([sql]) => sql.includes("session_name") && sql.startsWith("SELECT"),
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(lock);
    expect(s.query.mock.calls[lock]?.[1]).toEqual(["group-name:10:20:Team"]);
  });
  it("uses the same Chinese-name limit for creation and availability checks", async () => {
    const s = context();
    s.context.command.payload.sessionName = "中".repeat(100);
    await expect(createSession(s.context)).resolves.toBeUndefined();
    expect(
      database.prepare("SELECT session_name FROM byai.byai_session WHERE session_id='30'").get(),
    ).toMatchObject({ session_name: "中".repeat(100) });
  });
});
