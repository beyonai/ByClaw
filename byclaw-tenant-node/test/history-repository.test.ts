import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { SqlHistoryRepository } from "../src/infrastructure/persistence/history-repository.js";
function setup() {
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) =>
    sql.startsWith("SELECT COUNT") ? [{ total: "0" }] : [],
  );
  return {
    query,
    repository: new SqlHistoryRepository(
      { isInitialized: true, query } as unknown as DataSource,
      "10",
    ),
  };
}
describe("BE query compatibility", () => {
  it("resolves credentials until the membership row is removed on schemas without state", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        ATTACH DATABASE ':memory:' AS byai;
        CREATE TABLE byai.byai_session_member (
          byai_session_member_id TEXT, session_id TEXT, mem_obj_type TEXT,
          mem_obj_id TEXT, com_acct_id TEXT, api_key TEXT
        );
        INSERT INTO byai.byai_session_member VALUES ('81','30','USER','20','10','member-key');
      `);
      const repository = new SqlHistoryRepository(
        {
          query: async (sql: string, params: string[]) =>
            db.prepare(sql.replace(/\$\d+/g, "?")).all(...params),
        } as unknown as DataSource,
        "10",
      );
      expect(await repository.groupMemberId("30", "20")).toBe("81");
      expect(await repository.groupMemberApiKey("30", "20")).toBe("member-key");
      db.exec("DELETE FROM byai.byai_session_member");
      expect(await repository.groupMemberId("30", "20")).toBeNull();
      expect(await repository.groupMemberApiKey("30", "20")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("reads the active tenant membership ID without selecting its database credential", async () => {
    const { query, repository } = setup();
    query.mockResolvedValueOnce([{ byai_session_member_id: "9007199254740993" }]);
    expect(await repository.groupMemberId("30", "20")).toBe("9007199254740993");
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql).toContain("SELECT byai_session_member_id");
    expect(sql).not.toContain("api_key");
    expect(sql).toContain("mem_obj_type='USER'");
    expect(sql).toContain("com_acct_id=$3");
    expect(parameters).toEqual(["30", "20", "10"]);
    expect(await repository.groupMemberId("30", "21")).toBeNull();
  });

  it("limits credential reads to the tenant's active USER membership and supplied original group", async () => {
    const { query, repository } = setup();
    await repository.groupMemberApiKey("30", "20");
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql).toContain("SELECT api_key");
    expect(sql).toContain("mem_obj_type='USER'");
    expect(sql).toContain("com_acct_id=$3");
    expect(parameters).toEqual(["30", "20", "10"]);
  });

  it("ranks the full history before filtering outline messages", async () => {
    const { query, repository } = setup();
    await repository.messages({ sessionId: "30", outline: true });
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql.indexOf("COUNT(*) OVER")).toBeLessThan(sql.indexOf("archived_at IS NULL"));
    expect(sql).toContain("usage IN(1,2,4)");
    expect(sql).toContain("ORDER BY create_time ASC,message_id ASC");
    expect(parameters).toEqual(["10", "30"]);
  });
  it("counts others' unarchived messages and sorts group lists by latest activity", async () => {
    const { query, repository } = setup();
    await repository.groups("20", 2, 20);
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql).toContain("m.creator_id!=$2");
    expect(sql).toContain("u.user_role!='OWNER'");
    expect(sql).toContain("ORDER BY COALESCE");
    expect(sql).not.toContain("m.usage IN");
    expect(sql).not.toContain("m.recalled_at IS NULL");
    expect(parameters).toEqual(["10", "20", 20, 20]);
  });
  it("excludes recalled search hits even without a keyword and parameterizes user input", async () => {
    const { query, repository } = setup();
    await repository.messages({
      sessionId: "30",
      visible: true,
      search: true,
      keyword: "%_'",
      scope: "MINE",
      actor: "20",
      limit: 21,
    });
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql).toContain("m.recalled_at IS NULL AND m.message_content IS NOT NULL");
    expect(sql).not.toContain("%_'");
    expect(parameters).toEqual(["10", "30", "%\\%\\_'%", "20", 21]);
  });
  it("anchors topic paging to timestamp plus bigint ID", async () => {
    const { query, repository } = setup();
    await repository.messages({
      sessionId: "30",
      topicId: "40",
      after: "9007199254740993",
      ascending: true,
      limit: 21,
    });
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql).toContain("(m.create_time,m.message_id)>");
    expect(parameters).toContain("9007199254740993");
  });
});
