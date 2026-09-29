import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T-03 / T-04 / T-05 — `baiying_call` entry gates (explicit type, resolved
 * type, precise resource matching) and tool-description rewrite.
 *
 * `runBaiyingExecutor` is mocked so "the executor was never called" is directly
 * observable; the channel/langfuse resolvers are stubbed so the tests do not
 * depend on Redis. `globalThis.fetch` is spied to prove no network access.
 */

vi.mock("openclaw/plugin-sdk/routing", () => ({ isSubagentSessionKey: () => false }));
vi.mock("./langfuse-observation.js", () => ({
  resolveLangfuseParentObservationId: vi.fn(async () => undefined),
  resolveLangfuseParentObservationIdWithRetry: vi.fn(async () => undefined),
  resolveLangfuseTraceId: vi.fn(async () => "0".repeat(32)),
  setActiveLangfuseSessionId: vi.fn(async () => undefined),
}));
vi.mock("./channel-session-resolve.js", () => ({
  resolveChannelSessionIdForTool: vi.fn(() => ({
    sessionId: "channel-session-1",
    traceId: "channel-trace-1",
    source: "test",
  })),
}));
vi.mock("./resource-metadata.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./resource-metadata.js")>();
  return {
    ...actual,
    runBaiyingExecutor: vi.fn(async () => ({ success: true, data: { text: "executor-ran" } })),
  };
});

import { buildBaiyingCallDescription, createBaiyingCallToolFactory } from "./baiying-call-tool.js";
import { runBaiyingExecutor } from "./resource-metadata.js";
import type { AdaptedManagedAgent } from "./agent-adapter.js";

const runBaiyingExecutorMock = vi.mocked(runBaiyingExecutor);

function makeAgent(overrides: Partial<AdaptedManagedAgent> = {}): AdaptedManagedAgent {
  return {
    sourceKey: "10039008",
    agentId: "baiying-agent-10039008",
    listEntry: { id: "baiying-agent-10039008", name: "Test agent" },
    associatedResources: [
      {
        resourceId: "10000045",
        resourceName: "销售管理视图",
        resourceType: "VIEW",
        resourceBizType: "VIEW",
        resourceCode: "scene_sales_management",
      },
      {
        resourceId: "10000046",
        resourceName: "产品知识库",
        resourceType: "KG_DOC",
        resourceBizType: "KG_DOC",
      },
    ],
    ...overrides,
  } as AdaptedManagedAgent;
}

function makeTool(agent: AdaptedManagedAgent) {
  const factory = createBaiyingCallToolFactory({
    registry: {
      get: () => agent,
      list: () => [agent],
    } as never,
    executorPath: "/tmp/does-not-exist",
  });
  const tool = factory({ agentId: agent.agentId, sessionKey: "agent:main:main" });
  if (!tool) {
    throw new Error("baiying_call tool was not created");
  }
  return tool as {
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ) => Promise<Record<string, unknown>>;
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  runBaiyingExecutorMock.mockResolvedValue({ success: true, data: { text: "executor-ran" } } as never);
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("baiying_call entry gate", () => {
  it("rejects an explicit disabled resource type before any executor or network access", async () => {
    const tool = makeTool(makeAgent());
    const result = await tool.execute("call-1", { resource_type: "OBJECT", query: "list objects" });

    expect(result).toMatchObject({ success: false, error_code: "RESOURCE_TYPE_DISABLED" });
    expect(result.error).toBe("该资源类型的能力已下线，不支持查询或调用");
    expect(runBaiyingExecutorMock).toHaveBeenCalledTimes(0);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it("rejects casing variants and whitespace of disabled types", async () => {
    const tool = makeTool(makeAgent());
    for (const resourceType of ["object", "View", "ontology_base", "Scene", " OBJECT "]) {
      const result = await tool.execute("call-x", { resource_type: resourceType, query: "q" });
      expect({ resourceType, error_code: result.error_code }).toEqual({
        resourceType,
        error_code: "RESOURCE_TYPE_DISABLED",
      });
    }
    expect(runBaiyingExecutorMock).toHaveBeenCalledTimes(0);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it("rejects the resolved type of a selected resource (second gate)", async () => {
    const tool = makeTool(makeAgent());
    const result = await tool.execute("call-2", { resource_id: "10000045", query: "show view" });

    expect(result).toMatchObject({ success: false, error_code: "RESOURCE_TYPE_DISABLED" });
    expect(runBaiyingExecutorMock).toHaveBeenCalledTimes(0);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it("does not treat a forged type as disabled", async () => {
    const tool = makeTool(makeAgent());
    const result = await tool.execute("call-3", {
      resource_id: "10000046",
      resource_type: "OBJECTX",
      query: "q",
    });

    expect(result.error_code).not.toBe("RESOURCE_TYPE_DISABLED");
    expect(runBaiyingExecutorMock).toHaveBeenCalledTimes(1);
  });
});

describe("baiying_call resource matching", () => {
  it("rejects an unassociated resource_id without falling back to another resource", async () => {
    const tool = makeTool(makeAgent());
    const result = await tool.execute("call-4", { resource_id: "not-associated-1", query: "q" });

    expect(result).toMatchObject({ success: false, error_code: "RESOURCE_NOT_FOUND" });
    expect(runBaiyingExecutorMock).toHaveBeenCalledTimes(0);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    // No associated resource leaked into the response (i.e. no fallback).
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("10000045");
    expect(serialized).not.toContain("10000046");
  });

  it("keeps the first-associated-resource semantics when no resource_id is given", async () => {
    const agent = makeAgent({
      associatedResources: [
        {
          resourceId: "10000046",
          resourceName: "产品知识库",
          resourceType: "KG_DOC",
          resourceBizType: "KG_DOC",
        },
        {
          resourceId: "10000047",
          resourceName: "另一个知识库",
          resourceType: "KG_DOC",
          resourceBizType: "KG_DOC",
        },
      ],
    } as Partial<AdaptedManagedAgent>);
    const tool = makeTool(agent);
    const result = await tool.execute("call-5", { query: "q" });

    expect(result.success).toBe(true);
    expect(runBaiyingExecutorMock).toHaveBeenCalledTimes(1);
    expect(runBaiyingExecutorMock.mock.calls[0][0]).toMatchObject({ resourceId: "10000046" });
  });

  it("blocks when the first associated resource is itself retired (no resource_id given)", async () => {
    // Default fixture: resources[0] is the VIEW, so the resolved real type is
    // retired and the request is rejected instead of silently executed.
    const tool = makeTool(makeAgent());
    const result = await tool.execute("call-5b", { query: "q" });

    expect(result).toMatchObject({ success: false, error_code: "RESOURCE_TYPE_DISABLED" });
    expect(runBaiyingExecutorMock).toHaveBeenCalledTimes(0);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it("keeps the root-agent override for an explicit retired type on the root agent id", async () => {
    const agent = makeAgent({
      agentHomeUrl: "http://agent.local/home",
      associatedResources: [
        {
          resourceId: "10000046",
          resourceName: "产品知识库",
          resourceType: "KG_DOC",
          resourceBizType: "KG_DOC",
        },
      ],
    } as Partial<AdaptedManagedAgent>);
    const tool = makeTool(agent);
    const result = await tool.execute("call-6", {
      resource_id: agent.sourceKey,
      resource_type: "OBJECT",
      query: "q",
    });

    // The resolved real type is AGENT, so the retired hint must not block it.
    expect(result.error_code).not.toBe("RESOURCE_TYPE_DISABLED");
    expect(runBaiyingExecutorMock).toHaveBeenCalledTimes(1);
    expect(runBaiyingExecutorMock.mock.calls[0][0]).toMatchObject({ resourceType: "AGENT" });
  });
});

describe("baiying_call description", () => {
  it("drops the retired call guidance and states the capability is offline", () => {
    const desc = buildBaiyingCallDescription({ agent: makeAgent() });

    expect(desc).not.toContain("call_object_ids");
    expect(desc).not.toContain("call_view_ids");
    expect(desc).not.toContain("dispatched through callAgent");
    expect(desc).not.toContain("dispatched to `BYCLAW_DATA`");
    expect(desc).not.toContain("file_url");
    expect(desc).not.toContain("KG_DOC, TOOLKIT, MCP, OBJECT, VIEW");
    expect(desc).not.toContain("销售管理视图");
    expect(desc).toContain("已下线");
  });

  it("keeps the guidance for the remaining capabilities", () => {
    const desc = buildBaiyingCallDescription({ agent: makeAgent() });

    expect(desc).toContain("TOOLKIT/MCP child tool");
    expect(desc).toContain("KG_DOC");
    expect(desc).toContain("产品知识库");
    expect(desc).toContain("Available resources: 1");
  });
});
