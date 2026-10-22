import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CommandService } from "../src/application/command-service.js";
import type { SqlRow } from "../src/application/database-ports.js";
import claimWelcome from "../src/infrastructure/persistence/claimWelcome.js";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { validateScript } from "../src/infrastructure/schema/script-validator.js";
import { frameSql } from "../src/infrastructure/schema/sql-framing.js";
import { command } from "./fixtures.js";

function setup(updated: SqlRow[] = [{ byai_session_member_id: "9007199254740993" }]) {
  const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => updated);
  const context = new CommandContext(
    { query },
    command({ operation: "CLAIM_WELCOME", payload: {} }),
  );
  vi.spyOn(context, "session").mockResolvedValue({ sessionType: "hs_as", state: "ACTIVE" });
  vi.spyOn(context, "member").mockResolvedValue({
    byaiSessionMemberId: "9007199254740993",
    memObjId: "20",
    lastReadMessageId: "99",
    lastReadTime: "2020-01-01",
  });
  return { context, query };
}

describe("personal welcome eligibility", () => {
  it("grants the conditional update winner independently of initialized read state", async () => {
    const { context, query } = setup();
    const { data } = await claimWelcome(context);
    expect(data).toEqual({
      sessionId: "30",
      memberId: "9007199254740993",
      granted: true,
      handledAt: expect.any(Number),
    });
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("welcome_handled_at IS NULL"), [
      new Date(data.handledAt!),
      "9007199254740993",
      "30",
      "20",
      "10",
    ]);
    const [sql] = query.mock.calls[0]!;
    expect(sql).toContain("byai_session_member_id=$2");
    expect(sql).toContain("mem_obj_type='USER'");
    expect(sql).toContain("mem_obj_id=$4 AND com_acct_id=$5");
    expect(sql).not.toMatch(/last_read_|byai_message|FOR\s+UPDATE/i);
  });

  it("does not grant an already handled or removed membership in another browser", async () => {
    const { context, query } = setup([]);
    expect(await claimWelcome(context)).toEqual({
      data: { sessionId: "30", memberId: "9007199254740993", granted: false, handledAt: null },
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it("supports an empty group and binds a rejoin to the new membership ID", async () => {
    const { context, query } = setup();
    vi.mocked(context.member).mockResolvedValue({ byaiSessionMemberId: "50", memObjId: "20" });
    const { data } = await claimWelcome(context);
    expect(data.granted).toBe(true);
    expect(data.memberId).toBe("50");
    expect(query.mock.calls[0]?.[1]?.[1]).toBe("50");
  });

  it.each([
    null,
    { sessionType: "h_as", state: "ACTIVE" },
    { sessionType: "hs_as", state: "GROUP_DISSOLVED" },
    { sessionType: "hs_as", state: "CLOSED" },
  ])("rejects an inaccessible group before mutation: %j", async (session) => {
    const { context, query } = setup();
    vi.mocked(context.session).mockResolvedValue(session);
    await expect(claimWelcome(context)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a nonmember before mutation", async () => {
    const { context, query } = setup();
    vi.mocked(context.member).mockResolvedValue(null);
    await expect(claimWelcome(context)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    expect(query).not.toHaveBeenCalled();
  });

  it("looks up membership within the authenticated tenant and actor", async () => {
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => []);
    const context = new CommandContext(
      { query },
      command({ operation: "CLAIM_WELCOME", payload: {} }),
    );
    await expect(claimWelcome(context)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    expect(query.mock.calls).toEqual([
      [expect.stringContaining("enterprise_id=$2"), ["30", "10"]],
      [
        expect.stringContaining("mem_obj_type='USER' AND mem_obj_id=$2 AND com_acct_id=$3"),
        ["30", "20", "10"],
      ],
    ]);
  });

  it("replays the original command receipt without a second claim", async () => {
    const request = command({ operation: "CLAIM_WELCOME", payload: {} });
    const result = { data: { sessionId: "30", memberId: "40", granted: true, handledAt: 1000 } };
    const transaction = {
      lock: vi.fn(async () => {}),
      authorize: vi.fn(async () => {}),
      previous: vi.fn(async () => ({ hash: request.requestHash, userId: request.userId, result })),
      apply: vi.fn(async () => result),
      record: vi.fn(async () => {}),
    };
    const service = new CommandService({ run: async (work) => work(transaction) });
    expect(await service.execute(request)).toEqual(result);
    expect(transaction.apply).not.toHaveBeenCalled();
    expect(transaction.record).not.toHaveBeenCalled();
  });
});

it("accepts the welcome backfill as DDL without leaving a default for future members", () => {
  const sql = readFileSync(
    new URL(
      "../../deploy/migrations/versions/V0.6.0/tenant/V0.6.0__ddl.sql",
      import.meta.url,
    ),
    "utf8",
  );
  // 只核验合并版本中的欢迎字段语句，同版本其他功能有各自的迁移测试。
  const welcomeSql = frameSql(sql)
    .filter((statement) => statement.includes("welcome_handled_at"))
    .join("\n");
  const statements = validateScript(
    welcomeSql,
    [{ kind: "table", name: "byai_session_member" }],
    "UPDATE",
  );
  expect(statements).toHaveLength(3);
  expect(statements[0]).toContain("DEFAULT CURRENT_TIMESTAMP");
  expect(statements[1]).toContain("DROP DEFAULT");
});
