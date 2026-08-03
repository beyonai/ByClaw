import { describe, expect, it, vi } from "vitest";
import type {
  AgentProfile,
  GroupChatContextV1,
  Run,
  RunService,
  Session,
} from "@byclaw/by-conductor";
import type { BeyondTokenVerifier } from "../auth/beyond-token.js";
import type { AuthorizedAgentCatalog } from "../business/agent-catalog.js";
import type { GroupChatContextProvider } from "../business/group-chat-context.js";
import { RunIngressService } from "../ingress/run-ingress-service.js";

const PRINCIPAL_TOKEN = "creator-token";

function agent(id: string, code?: string): AgentProfile {
  return {
    id,
    ...(code ? { code } : {}),
    name: id,
    execution: { connectorId: "openclaw-by-framework", targetId: id },
  };
}

/** 仅实现 createSessionRun/createRun/getOwnedSession 三条路径所需的最小 RunService。 */
function fakeRunService() {
  const createSessionRun = vi.fn(async (input: { agentList: AgentProfile[] }): Promise<Run> => ({
    id: "run-1",
    sessionId: "session-1",
    input: "",
    agentList: input.agentList,
    status: "QUEUED",
    baseContextRevision: 0,
    attemptNo: 0,
    executionStage: "QUEUED",
    version: 0,
    createdAt: 0,
    updatedAt: 0,
  }));
  const createRun = vi.fn(async (input: { agentList: AgentProfile[] }): Promise<Run> => ({
    id: "run-2",
    sessionId: "session-1",
    input: "",
    agentList: input.agentList,
    status: "QUEUED",
    baseContextRevision: 0,
    attemptNo: 0,
    executionStage: "QUEUED",
    version: 0,
    createdAt: 0,
    updatedAt: 0,
  }));
  const getOwnedSession = vi.fn(async (): Promise<Session | undefined> => ({
    id: "session-1",
    owner: { userCode: "creator" },
    sessionContext: { schemaVersion: 1 },
    sessionContextVersion: 1,
    contextRevision: 0,
    createdAt: 0,
    updatedAt: 0,
  }));
  return {
    impl: { createSessionRun, createRun, getOwnedSession } as unknown as RunService,
    createSessionRun,
    createRun,
  };
}

function catalog(agents: AgentProfile[]): AuthorizedAgentCatalog {
  return { listAuthorizedAgents: async () => agents };
}

function makeIngress(
  agents: AgentProfile[],
  userCode: string,
): { ingress: RunIngressService; runService: ReturnType<typeof fakeRunService> } {
  const runService = fakeRunService();
  const verify: BeyondTokenVerifier = async () => ({ userCode });
  const ingress = new RunIngressService(runService.impl, verify, catalog(agents));
  return { ingress, runService };
}

describe("RunIngressService self-exclusion", () => {
  it("continues with an empty agent list and exposes the catalog error when discover fails", async () => {
    const runService = fakeRunService();
    const verify: BeyondTokenVerifier = async () => ({ userCode: "creator" });
    const warn = vi.fn();
    const ingress = new RunIngressService(
      runService.impl,
      verify,
      {
        listAuthorizedAgents: async () => {
          throw new Error("ByClaw BE discover request failed: fetch failed");
        },
      },
      7_200_000,
      undefined,
      { info: vi.fn(), warn },
    );

    const run = await ingress.createSessionRun({
      beyondToken: PRINCIPAL_TOKEN,
      message: "hi",
    });

    expect(run).toBeDefined();
    expect(runService.createSessionRun.mock.calls[0][0].agentList).toEqual([]);
    expect(runService.createSessionRun.mock.calls[0][0].ingressContext).toEqual({
      agentCatalogError: "ByClaw BE discover request failed: fetch failed",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: "ByClaw BE discover request failed: fetch failed",
      }),
      "数字员工列表不可用，本次由超级助手直接处理",
    );
  });

  it("HTTP path: falls back to {userCode}_main when sourceAgentId is absent", async () => {
    const { ingress, runService } = makeIngress(
      [agent("self", "creator_main"), agent("finance", "finance")],
      "creator",
    );
    await ingress.createSessionRun({
      beyondToken: PRINCIPAL_TOKEN,
      message: "hi",
    });
    expect(runService.createSessionRun.mock.calls[0][0].agentList.map((a: AgentProfile) => a.id)).toEqual([
      "finance",
    ]);
  });

  it("Worker path: excludes exact sourceAgentId in addition to {userCode}_main", async () => {
    const { ingress, runService } = makeIngress(
      [
        agent("self", "creator_main"),
        agent("finance", "finance"),
        agent("hr", "hr"),
      ],
      "creator",
    );
    await ingress.createSessionRun({
      beyondToken: PRINCIPAL_TOKEN,
      message: "hi",
      sourceAgentId: "finance",
    });
    expect(runService.createSessionRun.mock.calls[0][0].agentList.map((a: AgentProfile) => a.id)).toEqual([
      "hr",
    ]);
  });

  it("still creates a Run when only self is authorized (no recursion)", async () => {
    const { ingress, runService } = makeIngress([agent("self", "creator_main")], "creator");
    const run = await ingress.createSessionRun({
      beyondToken: PRINCIPAL_TOKEN,
      message: "hi",
    });
    expect(run).toBeDefined();
    expect(runService.createSessionRun.mock.calls[0][0].agentList).toEqual([]);
  });

  it("does not exclude a normal agent whose code merely contains 'main'", async () => {
    const { ingress, runService } = makeIngress(
      [agent("self", "creator_main"), agent("maintainer", "domain_maintain")],
      "creator",
    );
    await ingress.createRun({
      beyondToken: PRINCIPAL_TOKEN,
      sessionId: "session-1",
      message: "hi",
    });
    expect(runService.createRun.mock.calls[0][0].agentList.map((a: AgentProfile) => a.id)).toEqual([
      "maintainer",
    ]);
  });
});

describe("RunIngressService group chat snapshot", () => {
  it("loads once, removes Super's own answer, and freezes the result on the Run", async () => {
    const runService = fakeRunService();
    const verify: BeyondTokenVerifier = async () => ({ userCode: "creator" });
    const load = vi.fn(async (): Promise<GroupChatContextV1> => ({
      schemaVersion: "byclaw.group-chat-context/v1",
      conversationKey: "conversation-1",
      snapshot: {
        beforeMessageId: "message-3",
        generatedAt: 1_000,
      },
      messages: [
        {
          messageId: "message-1",
          sequence: 1,
          createdAt: 100,
          role: "assistant",
          speaker: {
            type: "agent",
            agentId: "agent-a",
            agentName: "Agent A",
          },
          content: "A 的结论",
        },
        {
          messageId: "message-2",
          sequence: 2,
          createdAt: 200,
          role: "assistant",
          speaker: {
            type: "agent",
            agentId: "super",
            agentName: "超级助手",
          },
          content: "Super 的旧回答",
        },
      ],
      truncation: {
        truncated: false,
        omittedMessageCount: 0,
      },
    }));
    const groupChatContexts: GroupChatContextProvider = { load };
    const ingress = new RunIngressService(
      runService.impl,
      verify,
      catalog([agent("agent-a")]),
      7_200_000,
      groupChatContexts,
    );

    await ingress.createSessionRun({
      beyondToken: PRINCIPAL_TOKEN,
      systemCode: "BYAI",
      message: "请规划",
      sourceAgentId: "super",
      groupChatRef: {
        schemaVersion: "byclaw.group-chat-ref/v1",
        conversationKey: "conversation-1",
        beforeMessageId: "message-3",
      },
    });

    expect(load).toHaveBeenCalledWith({
      conversationKey: "conversation-1",
      beforeMessageId: "message-3",
      beyondToken: PRINCIPAL_TOKEN,
      systemCode: "BYAI",
    });
    const ingressContext =
      runService.createSessionRun.mock.calls[0][0].ingressContext;
    expect(
      ingressContext.groupChat.messages.map(
        (message: { messageId: string }) => message.messageId,
      ),
    ).toEqual(["message-1"]);
    expect(ingressContext.groupChatFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("continues creating the first Run when the group chat API fails", async () => {
    const runService = fakeRunService();
    const verify: BeyondTokenVerifier = async () => ({ userCode: "creator" });
    const load = vi.fn(async (): Promise<GroupChatContextV1> => {
      throw new Error("BE unavailable");
    });
    const warn = vi.fn();
    const ingress = new RunIngressService(
      runService.impl,
      verify,
      catalog([agent("agent-a")]),
      7_200_000,
      { load },
      { info: vi.fn(), warn },
    );

    const run = await ingress.createSessionRun({
      beyondToken: PRINCIPAL_TOKEN,
      message: "请规划",
      groupChatRef: {
        schemaVersion: "byclaw.group-chat-ref/v1",
        conversationKey: "conversation-1",
        beforeMessageId: "message-3",
      },
    });

    expect(run).toBeDefined();
    expect(runService.createSessionRun).toHaveBeenCalledOnce();
    expect(runService.createSessionRun.mock.calls[0][0].ingressContext).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "conversation-1",
        beforeMessageId: "message-3",
        errorMessage: "BE unavailable",
      }),
      "群聊上下文不可用，本次按普通对话继续",
    );
  });

  it("continues appending a Run when the group chat API fails", async () => {
    const runService = fakeRunService();
    const verify: BeyondTokenVerifier = async () => ({ userCode: "creator" });
    const load = vi.fn(async (): Promise<GroupChatContextV1> => {
      throw new Error("BE timeout");
    });
    const ingress = new RunIngressService(
      runService.impl,
      verify,
      catalog([agent("agent-a")]),
      7_200_000,
      { load },
    );

    const run = await ingress.createRun({
      beyondToken: PRINCIPAL_TOKEN,
      sessionId: "session-1",
      message: "继续规划",
      groupChatRef: {
        schemaVersion: "byclaw.group-chat-ref/v1",
        conversationKey: "conversation-1",
        beforeMessageId: "message-4",
      },
    });

    expect(run).toBeDefined();
    expect(runService.createRun).toHaveBeenCalledOnce();
    expect(runService.createRun.mock.calls[0][0].ingressContext).toBeUndefined();
  });

  it("freezes the current resource model selection into every new Run", async () => {
    const runService = fakeRunService();
    const resolve = vi.fn(async () => ({
      modelId: "11000161",
      fingerprint: "a".repeat(64),
    }));
    const ingress = new RunIngressService(
      runService.impl,
      async () => ({ userCode: "creator" }),
      catalog([]),
      7_200_000,
      undefined,
      { info: vi.fn(), warn: vi.fn() },
      { resolve },
    );

    await ingress.createSessionRun({
      beyondToken: PRINCIPAL_TOKEN,
      systemCode: "BYAI",
      sourceAgentId: "10000249",
      message: "hello",
    });

    expect(resolve).toHaveBeenCalledWith({
      resourceId: "10000249",
      beyondToken: PRINCIPAL_TOKEN,
      systemCode: "BYAI",
    });
    expect(runService.createSessionRun.mock.calls[0][0].ingressContext).toEqual({
      leaderModel: {
        modelId: "11000161",
        fingerprint: "a".repeat(64),
      },
    });
  });

  it("retains the last known resource model when a later BE lookup fails", async () => {
    const runService = fakeRunService();
    const resolve = vi
      .fn()
      .mockResolvedValueOnce({ modelId: "100", fingerprint: "b".repeat(64) })
      .mockRejectedValueOnce(new Error("BE unavailable"));
    const warn = vi.fn();
    const ingress = new RunIngressService(
      runService.impl,
      async () => ({ userCode: "creator" }),
      catalog([]),
      7_200_000,
      undefined,
      { info: vi.fn(), warn },
      { resolve },
    );
    const input = {
      beyondToken: PRINCIPAL_TOKEN,
      sourceAgentId: "10000249",
      message: "hello",
    };

    await ingress.createSessionRun(input);
    await ingress.createRun({ ...input, sessionId: "session-1" });

    expect(runService.createRun.mock.calls[0][0].ingressContext.leaderModel).toEqual({
      modelId: "100",
      fingerprint: "b".repeat(64),
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: "10000249",
        retainedLastKnownModel: true,
      }),
      "超级助手模型绑定不可用，本次沿用最后一次有效模型",
    );
  });
});
