import { describe, expect, it, vi } from "vitest";
import type { AgentProfile, Run, RunService, Session } from "@byclaw/by-conductor";
import type { BeyondTokenVerifier } from "../auth/beyond-token.js";
import type { AuthorizedAgentCatalog } from "../business/agent-catalog.js";
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
