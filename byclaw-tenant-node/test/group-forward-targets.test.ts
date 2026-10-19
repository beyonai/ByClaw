import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GroupChatForwardTargetQueryService } from "../src/infrastructure/persistence/group-forward-query.js";
import { requireSource, requireTarget } from "../src/application/group-forward-eligibility.js";
import type { HistoryRepository, Row } from "../src/application/history/contracts.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../byclaw-qa/fixtures/group-chat-forward/eligibility.json", import.meta.url),
    "utf8",
  ),
);
const source = { sessionId: "1000", enterpriseId: "1", sessionType: "hs_as", state: null };
const actor = { userId: "30", enterpriseId: "1" };

describe("strict forwarding targets", () => {
  let database: DatabaseSync;
  let service: GroupChatForwardTargetQueryService;
  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(`ATTACH DATABASE ':memory:' AS byai;
      CREATE TABLE byai.byai_session (session_id INTEGER PRIMARY KEY, enterprise_id TEXT, session_type TEXT, state TEXT, session_name TEXT, project_id TEXT, update_time TEXT, create_time TEXT);
      CREATE TABLE byai.byai_session_member (session_id INTEGER, mem_obj_type TEXT, mem_obj_id TEXT, user_role TEXT, com_acct_id TEXT);
      CREATE TABLE byai.byai_message (session_id INTEGER, create_time TEXT, archived_at TEXT);`);
    for (const row of fixture) {
      database
        .prepare(
          "INSERT INTO byai.byai_session VALUES (?,?,?,?,?,'4001','2026-10-01','2026-09-01')",
        )
        .run(row.sessionId, row.enterpriseId, row.sessionType, row.state, `team ${row.sessionId}`);
      database
        .prepare("INSERT INTO byai.byai_session_member VALUES (?,?,?,?,?)")
        .run(row.sessionId, row.member ? "USER" : "AGENT", "30", "MEMBER", "1");
    }
    // SQL is executed against a real relational fixture; the fake only adapts bindings and column naming.
    const read = async (sql: string, args: unknown[] = []): Promise<Row[]> => {
      const bindings: any[] = [];
      const adapted = sql.replace(/\$(\d+)/g, (_, index) => {
        bindings.push(args[Number(index) - 1]);
        return "?";
      });
      return database
        .prepare(adapted)
        .all(...bindings)
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
              key.endsWith("_id") && value != null ? String(value) : value,
            ]),
          ),
        );
    };
    const repository = {
      session: async (id: string) =>
        (
          await read("SELECT * FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2", [
            id,
            "1",
          ])
        )[0] ?? null,
      member: async (id: string, user: string) =>
        (
          await read(
            "SELECT * FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='USER' AND mem_obj_id=$2 AND com_acct_id=$3",
            [id, user, "1"],
          )
        )[0] ?? null,
    } as HistoryRepository;
    service = new GroupChatForwardTargetQueryService("1", repository, read);
  });
  afterEach(() => database.close());

  it("tenantOneIsStillStrict", async () => {
    const page = await service.listTargets("30", "1000");
    expect(page).toEqual({
      pageNum: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
      list: [
        {
          sessionId: "2002",
          name: "team 2002",
          enterpriseId: "1",
          projectId: "4001",
          role: "MEMBER",
        },
        {
          sessionId: "2001",
          name: "team 2001",
          enterpriseId: "1",
          projectId: "4001",
          role: "MEMBER",
        },
      ],
    });
  });
  it("filtersBeforePagination", async () => {
    database.exec(
      "INSERT INTO byai.byai_message VALUES (2001,'2026-10-15',NULL),(2002,'2026-10-16','archived')",
    );
    expect((await service.listTargets("30", "1000", 1, 1)).list.map((r) => r.sessionId)).toEqual([
      "2001",
    ]);
    expect((await service.listTargets("30", "1000", 2, 1)).list.map((r) => r.sessionId)).toEqual([
      "2002",
    ]);
    expect((await service.listTargets("30", "1000", 2, 1)).total).toBe(2);
  });
  it("literalKeywordAndTotalAgree", async () => {
    database
      .prepare("UPDATE byai.byai_session SET session_name=? WHERE session_id=2001")
      .run("A%_\\ team");
    for (const keyword of [" a%_\\ ", "%", "_", "\\"]) {
      const page = await service.listTargets("30", "1000", 1, 20, keyword);
      expect(page.list.map((r) => r.sessionId)).toEqual(["2001"]);
      expect(page.total).toBe(1);
    }
  });
  it("rejectsInvalidPaginationAndKeyword", async () => {
    for (const [page, size] of [
      [0, 20],
      [1, 0],
      [1, 101],
      [-1, 20],
      [1.2, 20],
      [Number.MAX_SAFE_INTEGER, 100],
    ]) {
      await expect(service.listTargets("30", "1000", page, size)).rejects.toThrow(
        "FORWARD_INVALID_REQUEST",
      );
    }
    await expect(service.listTargets("30", "1000", 1, 20, "x".repeat(101))).rejects.toThrow(
      "FORWARD_INVALID_REQUEST",
    );
    expect((await service.listTargets("30", "1000", 1, 100)).pageSize).toBe(100);
  });
  it("rejectsNonmemberSourceAndMembershipFromAnotherTenant", async () => {
    await expect(service.listTargets("31", "1000")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    database.exec("UPDATE byai.byai_session_member SET com_acct_id='2' WHERE session_id=2001");
    expect((await service.listTargets("30", "1000")).list.map((r) => r.sessionId)).toEqual([
      "2002",
    ]);
    database.exec("UPDATE byai.byai_session_member SET com_acct_id='2' WHERE session_id=1000");
    await expect(service.listTargets("30", "1000")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
  it("reportsUnresolvedTenantOnlyToTheCurrentSourceMember", async () => {
    database.exec("UPDATE byai.byai_session SET enterprise_id=NULL WHERE session_id=1000");
    await expect(service.listTargets("30", "1000")).rejects.toThrow("FORWARD_TENANT_UNRESOLVED");
    await expect(service.listTargets("31", "1000")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
  it("rejectsCrossTenantOrInactiveSource", async () => {
    database.exec("UPDATE byai.byai_session SET enterprise_id='2' WHERE session_id=1000");
    await expect(service.listTargets("30", "1000")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    for (const state of [
      "CLOSED",
      "GROUP_DISSOLVED",
      "GROUP_CHAT_ROUTING",
      "GROUP_CHAT_DISPATCH",
    ]) {
      database
        .prepare("UPDATE byai.byai_session SET enterprise_id='1',state=? WHERE session_id=1000")
        .run(state);
      await expect(service.listTargets("30", "1000")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    }
  });
  it("reusableEligibilityMatchesTheSharedQualificationFixture", () => {
    for (const row of fixture) {
      if (row.eligible) expect(() => requireTarget(actor, source, row, row.member)).not.toThrow();
      else
        expect(() => requireTarget(actor, source, row, row.member)).toThrow(
          "RESOURCE_NOT_ACCESSIBLE",
        );
    }
    expect(() => requireSource(actor, source, false)).toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
});

// The SQL fake cannot check PostgreSQL parameter inference; EXPLAIN needs no fixture writes.
const databaseUrl = process.env.TENANT_NODE_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("forwarding SQL on PostgreSQL/openGauss", () => {
  it.each([undefined, " A%_\\ "])(
    "plans identity, count and page for keyword %s",
    async (keyword) => {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      let plans = 0;
      try {
        const repository = {
          session: async () => source,
          member: async () => ({ memObjType: "USER", memObjId: "30", comAcctId: "1" }),
        } as unknown as HistoryRepository;
        const service = new GroupChatForwardTargetQueryService(
          "1",
          repository,
          async (sql, args) => {
            const plan = await client.query(`EXPLAIN ${sql}`, args);
            expect(plan.rows.length).toBeGreaterThan(0);
            plans++;
            if (sql.includes("EXISTS")) return [source];
            if (sql.includes("COUNT(*)")) return [{ total: "0" }];
            return [];
          },
        );
        await expect(service.listTargets("30", "1000", 1, 20, keyword)).resolves.toMatchObject({
          total: 0,
          list: [],
        });
        expect(plans).toBe(3);
      } finally {
        await client.end();
      }
    },
  );
});
