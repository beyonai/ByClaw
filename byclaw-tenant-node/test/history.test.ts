import { displayMessages } from "../src/application/history/timeline-format.js";
import { describe, expect, it, vi } from "vitest";
import {
  HistoryService,
  safeMessage,
  type HistoryRepository,
  type Row,
} from "../src/application/history.js";

function setup() {
  const repo: HistoryRepository = {
    session: vi.fn(async (id: string) => ({
      sessionId: id,
      enterpriseId: "10",
      creatorId: "20",
      sessionType: "hs_as",
    })),
    member: vi.fn(async () => ({ memObjId: "20", userRole: "MEMBER" })),
    members: vi.fn(async () => []),
    acknowledgements: vi.fn(async () => []),
    extensions: vi.fn(async () => []),
    messages: vi.fn(async () => []),
    countMessages: vi.fn(async () => 0),
    groups: vi.fn(async () => ({ list: [], total: 0 })),
    tasks: vi.fn(async () => []),
    task: vi.fn(async () => null),
    pending: vi.fn(async () => null),
    topics: vi.fn(async () => []),
    topic: vi.fn(async () => null),
    participants: vi.fn(async () => []),
  };
  return { repo, service: new HistoryService("10", repo) };
}
const message = (overrides: Row = {}) => ({
  messageId: "100",
  sessionId: "30",
  usage: 1,
  messageContent: "hello",
  createTime: new Date(1000),
  metadata: '{"clientRequestId":"request"}',
  ...overrides,
});
describe("tenant history use cases", () => {
  it("allows a group member who did not create the group", async () => {
    const { service, repo } = setup();
    await service.detail("21", "30");
    expect(repo.member).toHaveBeenCalledWith("30", "21");
  });
  it("denies nonmembers, foreign tenant rows, and internal routing sessions", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.member).mockResolvedValue(null);
    await expect(service.traditional("21", "30", 1, 10)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    vi.mocked(repo.session).mockResolvedValue({ enterpriseId: "11" });
    await expect(service.detail("20", "30")).rejects.toThrow();
    vi.mocked(repo.session).mockResolvedValue({ enterpriseId: "10", state: "GROUP_CHAT_ROUTING" });
    await expect(service.detail("20", "30")).rejects.toThrow();
    expect(repo.messages).not.toHaveBeenCalled();
  });
  it("checks task initiator plus group membership for private sessions", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.session).mockImplementation(async (id) => ({
      sessionId: id,
      enterpriseId: "10",
      creatorId: "20",
      sessionType: id === "30" ? "hs_as" : "h_as",
    }));
    vi.mocked(repo.task).mockImplementation(async (id) =>
      id === "40"
        ? { taskSessionId: "40", groupSessionId: "30", initiatorUserId: "20", status: "ACTIVE" }
        : null,
    );
    await service.traditional("20", "40", 1, 10);
    await expect(service.traditional("21", "40", 1, 10)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
  it("checks access for every session in an ID batch", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.messages).mockResolvedValue([message({ sessionId: "99" })]);
    vi.mocked(repo.member).mockResolvedValue(null);
    await expect(service.byIds("20", ["100"])).rejects.toThrow();
  });
  it("inherits the frozen group scope through real child session parents", async () => {
    const { service, repo } = setup();
    const scope = {
      schemaVersion: "byclaw.group-coordination/v1",
      mode: "COORDINATED",
      groupSessionId: "30",
      taskSessionId: "40",
      coordinatorAgentId: "90",
      allowedAgentIds: ["42", "43"],
    };
    vi.mocked(repo.session).mockImplementation(async (id) => ({
      sessionId: id,
      enterpriseId: "10",
      creatorId: "20",
      sessionType: id === "30" ? "hs_as" : "h_as",
      ...(id === "50" ? { parentSessionId: "40", objectId: "42" } : {}),
    }));
    vi.mocked(repo.task).mockImplementation(async (id) =>
      id === "40"
        ? {
            taskSessionId: "40",
            groupSessionId: "30",
            initiatorUserId: "20",
            targetAgentId: "90",
          }
        : null,
    );
    vi.mocked(repo.extensions).mockImplementation(async (id) =>
      id === "40"
        ? [
            {
              extParamCode: "group_coordination_scope",
              extParamValue: JSON.stringify(scope),
            },
          ]
        : [],
    );

    await expect(service.access("20", "50")).resolves.toMatchObject({
      groupCoordination: scope,
      groupCoordinationChild: true,
      targetAgentId: "42",
    });
    await expect(service.access("21", "50")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    vi.mocked(repo.session).mockImplementation(async (id) => ({
      sessionId: id,
      enterpriseId: "10",
      creatorId: "20",
      sessionType: id === "30" ? "hs_as" : "h_as",
      ...(id === "50" ? { parentSessionId: "40", objectId: "999" } : {}),
    }));
    await expect(service.access("20", "50")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
  it("preserves a terminal-safe timeline projection and clientRequestId", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.messages).mockResolvedValue([
      message(),
      message({
        messageId: "99",
        usage: 5,
        metadata: '{"kind":"SYSTEM_EVENT","systemEvent":{"eventType":"MEMBER_ADDED"}}',
      }),
    ]);
    vi.mocked(repo.countMessages).mockResolvedValue(2);
    const result = await service.context("20", "30", undefined, 50, 20000);
    expect(result.messages.map((r) => r.messageId)).toEqual(["99", "100"]);
    expect(result.messages[1]?.clientRequestId).toBe("request");
    expect(result.messages[0]?.role).toBe("event");
    expect(result.truncation.truncated).toBe(false);
  });
  it("keeps a bounded newest message and a usable older paging boundary when it exceeds the character budget", async () => {
    const { service, repo } = setup();
    const large = message({ messageContent: "x".repeat(25000) });
    const older = message({ messageId: "99", messageContent: "older" });
    vi.mocked(repo.messages).mockImplementation(async (query) =>
      query.before === "100" ? [older] : [large, older],
    );
    vi.mocked(repo.countMessages).mockResolvedValue(2);
    const latest = await service.context("20", "30", undefined, 50, 20000);
    expect(latest.messages).toHaveLength(1);
    expect(latest.messages[0]?.messageId).toBe("100");
    expect(latest.messages[0]?.content.length).toBeLessThanOrEqual(20000);
    expect(latest.messages[0]?.content).toContain("截断预览");
    expect(latest.truncation.reason).toBe("character_limit");
    expect(large.messageContent).toHaveLength(25000);
    const previous = await service.context("20", "30", latest.messages[0]?.messageId, 50, 20000);
    expect(previous.messages[0]?.messageId).toBe("99");
  });
  it("keeps recalled message previews within very small character budgets without exposing original content", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.messages).mockResolvedValue([
      message({ recalledAt: new Date(), messageContent: "secret" }),
    ]);
    vi.mocked(repo.countMessages).mockResolvedValue(1);
    const result = await service.context("20", "30", undefined, 50, 3);
    expect(result.messages[0]?.content.length).toBeLessThanOrEqual(3);
    expect(result.messages[0]?.content).not.toContain("secret");
  });
  it("filters system events before budgeting agent context while preserving the user timeline", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.messages).mockResolvedValue([message(), message({ messageId: "99", usage: 5 })]);
    vi.mocked(repo.countMessages).mockResolvedValue(1);
    const result = await service.context("20", "30", "101", 60, 30000, true);
    expect(result.messages.map((row) => row.messageId)).toEqual(["100"]);
    expect(repo.messages).toHaveBeenCalledWith(
      expect.objectContaining({ visible: true, timeline: false, before: "101" }),
    );
    expect(result.truncation.truncated).toBe(false);
  });
  it("redacts every content-bearing field of a recalled message", () => {
    const result = safeMessage(
      message({
        recalledAt: new Date(1000),
        messageStruct: "secret",
        inferLog: "secret",
        finalContent: "secret",
        relatedResources: "secret",
        metadata: '{"files":["secret"],"clientRequestId":"request"}',
      }),
    );
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.messageContent).toBe("消息已撤回");
  });
  it("validates search filters and binds the trusted user for MINE", async () => {
    const { service, repo } = setup();
    await service.search("20", "30", { scope: "MINE", keyword: "hi", limit: 10 });
    expect(repo.messages).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "20", scope: "MINE", limit: 11 }),
    );
    await expect(service.search("20", "30", { scope: "OTHER" })).rejects.toThrow(
      "INVALID_SEARCH_FILTER",
    );
  });
  it("rejects a topic cursor bound to a different group", async () => {
    const { service, repo } = setup();
    await expect(
      service.topics("20", "30", 20, Buffer.from("1:31:1000:100:100").toString("base64url")),
    ).rejects.toThrow("INVALID_CURSOR");
    expect(repo.topics).not.toHaveBeenCalled();
  });
  it("preserves outline positions and final content while redacting recalls", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.messages).mockResolvedValue([
      message({ usage: 4, finalContent: "final", role: "tool", position: "8", totalCount: "10" }),
      message({ recalledAt: new Date(), finalContent: "secret", position: "2", totalCount: "10" }),
    ]);
    const result = await service.outline("20", "30");
    expect(result[0]).toMatchObject({
      usage: 4,
      role: "tool",
      content: "final",
      position: 8,
      totalCount: 10,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("keeps both legacy and publication attachments in history", async () => {
    const { repo } = setup();
    const [row] = await displayMessages(repo, [
      message({
        usage: 2,
        relatedResources: JSON.stringify({
          files: [{ fileId: "1", fileName: "old", fileType: "text/plain" }],
        }),
        metadata: JSON.stringify({
          scene: "GROUP_CHAT",
          kind: "TASK_RESULT",
          files: [{ fileName: "new", filePath: "/deliver/new", cloudResourceId: "88" }],
        }),
      }),
    ]);
    expect(row!.attachments.map((a: Row) => a.fileName)).toEqual(["old", "new"]);
    expect(row!.speaker.type).toBe("agent");
  });
  it("detects cyclic parent session identities", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.session).mockResolvedValue({
      enterpriseId: "10",
      sessionType: "h_as",
      parentSessionId: "30",
      creatorId: "20",
    });
    await expect(service.access("20", "30")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
});
