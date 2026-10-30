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
    groupProjectAccess: vi.fn(async () => ({ bound: true, canRead: true })),
    groupNameExists: vi.fn(async () => false),
    session: vi.fn(async (id: string) => ({
      sessionId: id,
      enterpriseId: "10",
      creatorId: "20",
      sessionType: "hs_as",
    })),
    member: vi.fn(async () => ({ memObjId: "20", userRole: "MEMBER" })),
    groupMemberApiKey: vi.fn(async () => null),
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
  it("reads only the authorized actor's group credential through the private endpoint use case", async () => {
    const { repo, service } = setup();
    const credential = vi.fn(async () => "tenant-member-key");
    Object.assign(repo, { groupMemberApiKey: credential });
    expect(await service.groupMemberApiKey("20", "30")).toEqual({ api_key: "tenant-member-key" });
    expect(credential).toHaveBeenCalledExactlyOnceWith("30", "20");
    vi.mocked(repo.member).mockResolvedValue(null);
    await expect(service.groupMemberApiKey("21", "30")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    expect(credential).toHaveBeenCalledTimes(1);
  });

  it("does not include member credentials in public group detail or management responses", async () => {
    const { repo, service } = setup();
    vi.mocked(repo.members).mockResolvedValue([
      {
        memObjType: "USER",
        memObjId: "20",
        userRole: "OWNER",
        apiKey: "private-key",
        api_key: "private-key",
      },
    ]);
    expect(JSON.stringify(await service.detail("20", "30"))).not.toContain("private-key");
    expect(JSON.stringify(await service.management("20", "30"))).not.toContain("private-key");
  });

  it("reads current target-group nicknames for old forwards without changing source snapshots", async () => {
    const { service, repo } = setup();
    const sender = "9007199254740993";
    const source = message({
      creatorId: sender,
      creatorName: sender,
      metadata: {
        kind: "FORWARD_MERGED",
        forward: {
          forwardId: "900",
          mode: "MERGED",
          resourceMode: "SNAPSHOT_ONLY",
          itemCount: 1,
          preview: [{ speakerName: "原发言人快照", content: "原文" }],
        },
      },
    });
    vi.mocked(repo.messages).mockResolvedValue([source]);
    vi.mocked(repo.members).mockResolvedValue([
      { memObjType: "USER", memObjId: sender, memName: "当前群昵称" },
      { memObjType: "AGENT", memObjId: sender, memName: "同 ID 员工" },
    ]);

    const first = await service.context("20", "30", "101", 60, 30000);

    expect(first.messages[0]?.speaker).toMatchObject({
      type: "user",
      userCode: sender,
      displayName: "当前群昵称",
    });
    expect(first.messages[0]?.forward.preview[0].speakerName).toBe("原发言人快照");
    expect(source.creatorName).toBe(sender);
    expect(repo.members).toHaveBeenCalledExactlyOnceWith("30");
    vi.mocked(repo.members).mockResolvedValue([
      { memObjType: "USER", memObjId: sender, memName: "修改后的昵称" },
    ]);
    const next = await service.context("20", "30", "101", 60, 30000);
    expect(next.messages[0]?.speaker.displayName).toBe("修改后的昵称");
  });
  it("leaves missing and blank nicknames for BE userName resolution, including quoted users", async () => {
    const { repo } = setup();
    const quoted = message({ creatorId: "21", creatorName: "21" });
    vi.mocked(repo.messages).mockResolvedValue([quoted]);
    vi.mocked(repo.members).mockResolvedValue([
      { memObjType: "USER", memObjId: "20", memName: " \t" },
      { memObjType: "USER", memObjId: "21", memName: "引用人群昵称" },
    ]);
    const result = await displayMessages(repo, [
      message({ messageId: "101", creatorId: "20", creatorName: "过期用户名", messageRef: "100" }),
      message({ messageId: "102", creatorId: "22", creatorName: "22" }),
      message({ messageId: "103", usage: 2, creatorId: "20", creatorName: "员工名称" }),
      message({ messageId: "104", usage: 5, creatorId: "20" }),
    ]);

    expect(result[0]?.speaker.displayName).toBeNull();
    expect(result[0]?.replyTo.speaker.displayName).toBe("引用人群昵称");
    expect(result[1]?.speaker.displayName).toBeNull();
    expect(result[2]?.speaker.agentName).toBe("员工名称");
    expect(result[3]?.speaker.displayName).toBe("系统");
    expect(repo.members).toHaveBeenCalledExactlyOnceWith("30");
  });
  it("validates project IDs before reading tenant group membership", async () => {
    const { repo, service } = setup();
    await expect(service.groupProjectAccess("21", "50")).resolves.toEqual({
      bound: true,
      canRead: true,
    });
    expect(repo.groupProjectAccess).toHaveBeenCalledWith("21", "50");
    expect(() => service.groupProjectAccess("21", "50 OR 1=1")).toThrow("INVALID_ID");
    expect(() => service.groupProjectAccess("invalid", "50")).toThrow("INVALID_ID");
    expect(repo.groupProjectAccess).toHaveBeenCalledOnce();
  });
  it("retains Unicode whitespace exactly as BE's String.trim does", async () => {
    const { repo, service } = setup();
    const name = "\u00a0Team\u00a0";
    await service.groupNameCheck("20", name);
    expect(repo.groupNameExists).toHaveBeenCalledWith("20", name);
  });
  it("accepts Chinese names under the BE character limit", async () => {
    const { service } = setup();
    await expect(service.groupNameCheck("20", "中".repeat(100))).resolves.toEqual({
      exists: false,
    });
    await expect(service.groupNameCheck("20", "中".repeat(101))).rejects.toThrow();
  });
  it("normalizes group names and preserves active-name conflicts", async () => {
    const { repo, service } = setup();
    vi.mocked(repo.groupNameExists).mockResolvedValue(true);
    await expect(service.groupNameCheck("20", " Team ")).resolves.toEqual({ exists: true });
    expect(repo.groupNameExists).toHaveBeenCalledWith("20", "Team");
    await expect(service.groupNameCheck("20", " ")).rejects.toThrow("INVALID_SESSION_NAME");
    await expect(service.groupNameCheck("20", undefined)).rejects.toThrow();
    expect(repo.groupNameExists).toHaveBeenCalledOnce();
  });
  it("lets a DSH child inherit the root employee while retaining task initiator authorization", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.session).mockImplementation(async (id) => ({
      sessionId: id,
      enterpriseId: "10",
      creatorId: "20",
      sessionType: id === "30" ? "hs_as" : "h_as",
      ...(id === "51" ? { parentSessionId: "50", objectId: "90" } : {}),
    }));
    vi.mocked(repo.task).mockImplementation(async (id) =>
      id === "50"
        ? {
            taskSessionId: "50",
            groupSessionId: "30",
            initiatorUserId: "20",
            targetAgentId: "90",
          }
        : null,
    );
    vi.mocked(repo.extensions).mockImplementation(async (id) =>
      id === "50"
        ? [
            {
              extParamCode: "group_coordination_scope",
              extParamValue: JSON.stringify({
                schemaVersion: "byclaw.group-coordination/v1",
                mode: "COORDINATED",
                taskSessionId: "50",
                groupSessionId: "30",
                coordinatorAgentId: "90",
                allowedAgentIds: ["42"],
              }),
            },
          ]
        : [{ extParamCode: "event_source", extParamValue: "EXTERNAL_CHILD" }],
    );
    await expect(service.access("20", "51")).resolves.toMatchObject({ targetAgentId: "90" });
    await expect(service.access("21", "51")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
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
  it("restores original mentions in private task history without changing stored messages", async () => {
    const { service, repo } = setup();
    const resources = [
      {
        id: "DIG_EMPLOYEE_90",
        resourceId: "90",
        resourceType: "DIG_EMPLOYEE",
        resourceName: "群组工作助手",
      },
    ];
    const source: Row = message({
      enterpriseId: "10",
      creatorId: "20",
      messageContent: "{{DIG_EMPLOYEE_90}} 你好",
      metadata: JSON.stringify({ resourceList: resources }),
    });
    const input: Row = message({
      enterpriseId: "10",
      messageId: "200",
      sessionId: "40",
      creatorId: "20",
      messageContent: source.messageContent,
      metadata: "{}",
    });
    const followup = message({
      messageId: "201",
      sessionId: "40",
      creatorId: "20",
      messageContent: "{{DIG_EMPLOYEE_90}} 后续问题",
      metadata: "{}",
    });
    vi.mocked(repo.session).mockImplementation(async (id) => ({
      sessionId: id,
      enterpriseId: "10",
      creatorId: "20",
      sessionType: id === "30" ? "hs_as" : "h_as",
    }));
    vi.mocked(repo.task).mockImplementation(async (id) =>
      id === "40" ? { groupSessionId: "30", sourceMessageId: "100", initiatorUserId: "20" } : null,
    );
    vi.mocked(repo.messages).mockImplementation(async (query) =>
      query.ids?.includes("100") ? [source] : [input, followup],
    );
    const result = await service.traditional("20", "40", 1, 20);
    expect(JSON.parse(result.list[0].relatedResources).resourceList).toEqual(resources);
    expect(JSON.parse(result.list[0].metadata).resourceList).toEqual(resources);
    expect(result.list[1].relatedResources).toBeUndefined();
    expect(input.metadata).toBe("{}");
    expect(input.messageContent).toBe(source.messageContent);
    expect((await service.byIds("20", ["200"]))[0].relatedResources).toBe(
      result.list[0].relatedResources,
    );
    expect((await service.byCommand("20", "command")).relatedResources).toBe(
      result.list[0].relatedResources,
    );
    input.metadata = JSON.stringify({
      resourceList: [{ ...resources[0], resourceName: "已保存的名称" }],
      custom: "kept",
    });
    const existing = (await service.traditional("20", "40", 1, 20)).list[0];
    expect(JSON.parse(existing.metadata).custom).toBe("kept");
    expect(JSON.parse(existing.relatedResources).resourceList[0].resourceName).toBe("已保存的名称");
    input.relatedResources = JSON.stringify({
      resourceList: [{ ...resources[0], resourceName: "关联资源名称" }],
    });
    const distinct = (await service.traditional("20", "40", 1, 20)).list[0];
    expect(JSON.parse(distinct.metadata).resourceList[0].resourceName).toBe("已保存的名称");
    expect(JSON.parse(distinct.relatedResources).resourceList[0].resourceName).toBe("关联资源名称");
    delete input.relatedResources;
    input.metadata = "{}";
    input.recalledAt = new Date();
    expect((await service.traditional("20", "40", 1, 20)).list[0].relatedResources).toBeUndefined();
    delete input.recalledAt;
    source.recalledAt = new Date();
    expect((await service.traditional("20", "40", 1, 20)).list[0].relatedResources).toBeUndefined();
    delete source.recalledAt;
    source.enterpriseId = "11";
    expect((await service.traditional("20", "40", 1, 20)).list[0].relatedResources).toBeUndefined();
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

describe("passive forwarding history", () => {
  it("preserves raw tokens and whitelist attachments without acknowledgements, including replies", async () => {
    const { repo } = setup();
    const source = message({
      creatorId: "99",
      metadata: {
        kind: "FORWARD_SINGLE",
        forward: {
          forwardId: "9007199254740993",
          mode: "SINGLE",
          resourceMode: "SNAPSHOT_ONLY",
          itemCount: 1,
        },
        resourceList: [
          {
            id: "opaque",
            resourceId: "/private/path",
            resourceName: "需求说明",
            resourceType: "COMMON_FILE",
          },
        ],
      },
      messageContent: "{{opaque}}",
      relatedResources: {
        files: [
          {
            fileId: "88",
            fileName: "需求说明",
            mediaType: "text/plain",
            size: 4,
            fileUrl: "/commonFile/preview?filePath=%2F.sessions%2F30%2Fcopy.txt",
          },
        ],
      },
    });
    vi.mocked(repo.messages).mockResolvedValue([source]);
    vi.mocked(repo.acknowledgements).mockResolvedValue([{ messageId: "100", userId: "20" }]);
    const [result] = await displayMessages(
      repo,
      [source, message({ messageId: "101", messageRef: "100" })],
      "20",
    );
    expect(result).toMatchObject({
      content: "{{opaque}}",
      acknowledgements: [],
      canAcknowledge: false,
      forward: { forwardId: "9007199254740993", resourceMode: "SNAPSHOT_ONLY" },
    });
    expect(result!.resourceList).toEqual([
      {
        id: "opaque",
        resourceId: "/private/path",
        resourceName: "需求说明",
        resourceType: "COMMON_FILE",
      },
    ]);
    expect(result!.attachments[0].mediaType).toBe("text/plain");
    const reply = (
      await displayMessages(repo, [message({ messageId: "101", messageRef: "100" })], "20")
    )[0]!.replyTo;
    expect(reply.resourceList).toEqual(result!.resourceList);
    expect(reply.acknowledgements).toEqual([]);
    const recalled = (
      await displayMessages(repo, [{ ...source, recalledAt: new Date() }], "20")
    )[0]!;
    expect(recalled.resourceList).toEqual([]);
    expect(recalled.attachments).toEqual([]);
    expect(recalled.forward).toBeUndefined();
  });
});

it("exports a snapshot to Agent as names and descriptive attachment fields only", async () => {
  const { service, repo } = setup();
  const source = message({
    metadata: {
      kind: "FORWARD_SINGLE",
      forward: { resourceMode: "SNAPSHOT_ONLY", forwardId: "800", mode: "SINGLE", itemCount: 1 },
      resourceList: [
        {
          id: "opaque",
          resourceId: "/private",
          resourceType: "COMMON_FILE",
          resourceName: "需求{{HUMAN_21}}",
          resourceCode: "secret",
        },
        { id: "HUMAN_21", resourceName: "不应展开" },
      ],
    },
    messageContent: "{{opaque}} literal /user/body",
    relatedResources: {
      files: [
        {
          fileId: "88",
          fileName: "需求.pdf",
          fileUrl: "/download",
          mediaType: "application/pdf",
          size: 42,
        },
      ],
    },
  });
  vi.mocked(repo.messages).mockResolvedValue([source]);
  vi.mocked(repo.countMessages).mockResolvedValue(1);
  const result = await service.context("20", "30", "101", 60, 30000, true);
  expect(result.messages[0]).toMatchObject({
    content: "需求{{HUMAN_21}} literal /user/body",
    attachments: [{ fileName: "需求.pdf", mediaType: "application/pdf", size: 42 }],
  });
  expect(result.messages[0]).not.toHaveProperty("resourceList");
  expect(JSON.stringify(result)).not.toMatch(/\/private|\/download|secret|不应展开/);
});

it("bounds merged preview by code points and never exposes enriched entry fields", async () => {
  const { repo } = setup();
  const entry = { speakerName: "甲", content: "😀".repeat(121), resourceCode: "secret" };
  const source = message({
    messageContent: "聊天记录（4 条）",
    metadata: {
      kind: "FORWARD_MERGED",
      forward: {
        forwardId: "9007199254740993",
        mode: "SINGLE",
        resourceMode: "SNAPSHOT_ONLY",
        itemCount: 4,
        preview: [entry, entry, entry, entry],
        physicalKey: "secret",
      },
      resourceList: [{ id: "opaque", resourceCode: "secret" }],
    },
  });
  const result = (await displayMessages(repo, [source], "20"))[0]!;
  expect(result.resourceList).toEqual([]);
  expect(result.forward.preview).toHaveLength(3);
  expect(result.forward.preview[0]).toEqual({ speakerName: "甲", content: "😀".repeat(120) });
  expect(JSON.stringify(result)).not.toContain("secret");
});

it("does not restore legacy executable references from a snapshot in traditional history", async () => {
  const { service, repo } = setup();
  const ref = {
    id: "opaque",
    resourceId: "/private",
    resourceType: "COMMON_FILE",
    resourceName: "需求说明",
    resourceCode: "secret-code",
    extData: "secret-ext",
  };
  const source = message({
    enterpriseId: "10",
    metadata: { kind: "FORWARD_SINGLE", resourceList: [ref] },
    relatedResources: {
      resourceList: [ref],
      files: [{ fileId: "88", fileName: "需求.pdf", fileUrl: "/private/download" }],
    },
  });
  vi.mocked(repo.messages).mockResolvedValue([source]);
  const result = await service.byIds("20", ["100"]);
  expect(JSON.stringify(result)).not.toMatch(/secret-code|secret-ext|\/private\/download/);
  expect(JSON.parse(result[0]!.metadata).forward.resourceMode).toBe("SNAPSHOT_ONLY");
});

it("preserves published destination-copy attachments in traditional history", async () => {
  const { service, repo } = setup();
  const file = {
    fileId: "88",
    fileName: "copy.pdf",
    fileUrl: "/commonFile/preview?filePath=copy.pdf",
  };
  vi.mocked(repo.messages).mockResolvedValue([
    message({
      metadata: {
        kind: "FORWARD_SINGLE",
        forward: { forwardId: "501", resourceMode: "SNAPSHOT_ONLY" },
      },
      relatedResources: { files: [file] },
    }),
  ]);
  const result = await service.byIds("20", ["100"]);
  expect(JSON.parse(result[0]!.relatedResources).files).toEqual([file]);
});
