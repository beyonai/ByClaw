import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqlHistoryRepository } from "../src/infrastructure/persistence/history-repository.js";

describe("tenant project cloud membership", () => {
  let database: DatabaseSync;
  let repository: SqlHistoryRepository;
  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      ATTACH DATABASE ':memory:' AS byai;
      CREATE TABLE byai.byai_session (
        session_id TEXT, enterprise_id TEXT, project_id TEXT, session_type TEXT, state TEXT
      );
      CREATE TABLE byai.byai_session_member (
        session_id TEXT, com_acct_id TEXT, mem_obj_type TEXT, mem_obj_id TEXT
      );
      INSERT INTO byai.byai_session VALUES ('30','10','50','hs_as','ACTIVE');
      INSERT INTO byai.byai_session_member VALUES ('30','10','USER','20');
    `);
    repository = new SqlHistoryRepository(
      {
        query: async (sql: string, parameters: unknown[] = []) => {
          const bindings: unknown[] = [];
          const sqliteSql = sql.replace(/\$(\d+)/g, (_placeholder, index) => {
            bindings.push(parameters[Number(index) - 1]);
            return "?";
          });
          return database.prepare(sqliteSql).all(...(bindings as any[]));
        },
      },
      "10",
    );
  });
  afterEach(() => database.close());

  it("allows a newly invited member and revokes access immediately after removal", async () => {
    expect(await repository.groupProjectAccess("21", "50")).toEqual({ bound: true, canRead: false });
    database.exec("INSERT INTO byai.byai_session_member VALUES ('30','10','USER','21')");
    expect(await repository.groupProjectAccess("21", "50")).toEqual({ bound: true, canRead: true });
    database.exec("DELETE FROM byai.byai_session_member WHERE mem_obj_id='21'");
    expect(await repository.groupProjectAccess("21", "50")).toEqual({ bound: true, canRead: false });
  });

  it.each(["GROUP_DISSOLVED", "GROUP_CHAT_ROUTING", "CLOSED"])(
    "retains binding but denies files when the group is %s",
    async (state) => {
      database.prepare("UPDATE byai.byai_session SET state=?").run(state);
      expect(await repository.groupProjectAccess("20", "50")).toEqual({ bound: true, canRead: false });
    },
  );

  it("supports legacy null state while keeping project and tenant isolation", async () => {
    database.exec("UPDATE byai.byai_session SET state=NULL");
    expect(await repository.groupProjectAccess("20", "50")).toEqual({ bound: true, canRead: true });
    expect(await repository.groupProjectAccess("20", "51")).toEqual({ bound: false, canRead: false });
    database.exec("UPDATE byai.byai_session SET enterprise_id='11'");
    expect(await repository.groupProjectAccess("20", "50")).toEqual({ bound: false, canRead: false });
  });

  it("does not accept an agent or a membership from another tenant", async () => {
    database.exec("UPDATE byai.byai_session_member SET mem_obj_type='AGENT'");
    expect(await repository.groupProjectAccess("20", "50")).toEqual({ bound: true, canRead: false });
    database.exec("UPDATE byai.byai_session_member SET mem_obj_type='USER',com_acct_id='11'");
    expect(await repository.groupProjectAccess("20", "50")).toEqual({ bound: true, canRead: false });
  });

  it("does not treat ordinary chat sessions as group project bindings", async () => {
    database.exec("UPDATE byai.byai_session SET session_type='h_as'");
    expect(await repository.groupProjectAccess("20", "50")).toEqual({ bound: false, canRead: false });
  });
});
