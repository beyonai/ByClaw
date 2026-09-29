import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T-10 / T-11 / T-12 / T-13 / T-14 — gate-level tests for the conversation
 * execution path (resolver gates, executor gate, final entry gate, MCP/callAgent
 * dispatch gate).
 *
 * The host packages (`openclaw`), the SDK (`@byclaw/by-framework`) and the shared
 * Redis/callAgent modules are not resolvable from this package (pre-existing test
 * infrastructure defect, see the card's design A7.1), so they are mocked here —
 * the same pattern already used by `src/backend-service-discovery.test.ts`.
 */

vi.mock("openclaw/plugin-sdk/routing", () => ({ isSubagentSessionKey: () => false }));
vi.mock("openclaw/plugin-sdk/gateway-runtime", () => ({ GatewayClient: class {} }));
vi.mock("openclaw/plugin-sdk/compat", () => ({}));
vi.mock("openclaw/plugin-sdk/image-generation", () => ({}));
vi.mock("openclaw/plugin-sdk/image-generation-runtime", () => ({}));
vi.mock("@byclaw/by-framework", () => ({
  callAgent: vi.fn(),
  createRedisCallAgentDeps: vi.fn(),
  GatewayDataEmitter: class {},
  EventType: {},
  QueueNames: { ctrl_stream: (target: string) => `ctrl:${target}` },
  RegistryKeys: {},
  SseReasonMessageType: {},
  SseMessageType: {},
  WorkerRegistry: class {},
  RoutePolicy: {},
}));
vi.mock("../../../shared/src/redis-compat.js", () => ({
  byFrameworkRedisKeys: {
    serviceInstances: (domainName: string) => `byai_gateway:sd:instances:${domainName}`,
  },
  createRedisClient: vi.fn(),
  hasRedisConnectionConfig: vi.fn(() => false),
  readRedisConfig: vi.fn(() => ({})),
}));
vi.mock("../../../shared/src/call-agent.js", () => ({
  __callAgentTestInternals: {},
  executeViaCallAgent: vi.fn(),
  buildCallAgentLangfuseEnvelope: vi.fn(),
}));
vi.mock("./local-snapshot.js", () => ({ loadCapabilityDetails: vi.fn(async () => null) }));
vi.mock("./mcp-client.js", () => ({ refreshMcpCapability: vi.fn(async (params: { capability: unknown }) => params.capability) }));
vi.mock("../personal-params.js", () => ({ loadPrivateParamsRuntime: vi.fn(async () => null) }));

import { loadCapabilityDetails } from "./local-snapshot.js";
import { refreshMcpCapability } from "./mcp-client.js";
import { resolveCapability } from "./capability-resolver.js";
import { runBaiyingExecutor } from "./index.js";
import { executeMcp } from "./resource-types/mcp.js";
import { BaiyingExecutor } from "./executor.js";
import { executeViaCallAgent } from "../../../shared/src/call-agent.js";

const loadCapabilityDetailsMock = vi.mocked(loadCapabilityDetails);
const refreshMcpCapabilityMock = vi.mocked(refreshMcpCapability);
const executeViaCallAgentMock = vi.mocked(executeViaCallAgent);

const AUTH = { session: "", userId: "", headers: {} };

function emptyContext(): Record<string, unknown> {
  return { root_agent: { resourceId: "10039008" } };
}

function objectSnapshot(): Record<string, unknown> {
  return {
    resource_type: "OBJECT",
    name: "用户信息表",
    description: "平台用户维度对象",
    metadata: { resource_id: "10000018" },
    mcp: { server_url: "http://datacloud.local/mcp", tools: [] },
    _discovery_source: "local_snapshot",
    // A stale cached payload must not influence the type decision.
    targetContent: "legacy snapshot body mentioning OBJECT",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadCapabilityDetailsMock.mockResolvedValue(null);
});

describe("resolveCapability gates", () => {
  it("rejects a disabled hint before any snapshot read or MCP discovery", async () => {
    const fetchImpl = vi.fn();
    const result = await resolveCapability({
      resourcesDir: "/tmp/does-not-exist",
      capabilityId: "10000018",
      resourceType: "OBJECT",
      resourceContext: emptyContext(),
      authContext: AUTH,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ capability: null, resolvedType: "OBJECT", disabled: true });
    expect(loadCapabilityDetailsMock).toHaveBeenCalledTimes(0);
    expect(refreshMcpCapabilityMock).toHaveBeenCalledTimes(0);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  it("rejects every casing variant of a disabled hint", async () => {
    for (const resourceType of ["object", "View", "ontology_base", "Scene", " OBJECT "]) {
      const result = await resolveCapability({
        resourcesDir: "/tmp/does-not-exist",
        capabilityId: "10000018",
        resourceType,
        resourceContext: emptyContext(),
        authContext: AUTH,
      });
      expect({ resourceType, disabled: result.disabled }).toEqual({ resourceType, disabled: true });
      expect(result.capability).toBeNull();
    }
    expect(loadCapabilityDetailsMock).toHaveBeenCalledTimes(0);
  });

  it("rejects a disabled selected_resource (context fallback source)", async () => {
    const result = await resolveCapability({
      resourcesDir: "/tmp/does-not-exist",
      capabilityId: "10000018",
      resourceType: undefined,
      resourceContext: {
        root_agent: { resourceId: "10039008" },
        selected_resource: { resourceId: "10000018", resourceBizType: "VIEW" },
      },
      authContext: AUTH,
    });

    expect(result.disabled).toBe(true);
    expect(result.capability).toBeNull();
    expect(loadCapabilityDetailsMock).toHaveBeenCalledTimes(0);
    expect(refreshMcpCapabilityMock).toHaveBeenCalledTimes(0);
  });

  it("rejects a disabled capability coming from a stale local snapshot", async () => {
    loadCapabilityDetailsMock.mockImplementation(async (params: { resourceType: string }) =>
      params.resourceType === "object" ? (objectSnapshot() as never) : null,
    );
    const fetchImpl = vi.fn();

    const result = await resolveCapability({
      resourcesDir: "/tmp/does-not-exist",
      capabilityId: "10000018",
      resourceType: "MCP",
      resourceContext: emptyContext(),
      authContext: AUTH,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Went through the snapshot path (gate 2), not the entry gate.
    expect(loadCapabilityDetailsMock).toHaveBeenCalled();
    expect(result).toEqual({ capability: null, resolvedType: "object", disabled: true });
    expect(refreshMcpCapabilityMock).toHaveBeenCalledTimes(0);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  it("rejects a direct-stub-shaped request at the entry gate", async () => {
    // `buildDirectCapabilityStub` derives its type from the same hint, so a
    // retired direct stub is structurally pre-empted by gate 1; assert that the
    // request is blocked and never reaches snapshot/network work.
    const result = await resolveCapability({
      resourcesDir: "/tmp/does-not-exist",
      capabilityId: "10000018",
      resourceType: "view",
      resourceContext: emptyContext(),
      authContext: AUTH,
    });
    expect(result).toEqual({ capability: null, resolvedType: "view", disabled: true });
    expect(loadCapabilityDetailsMock).toHaveBeenCalledTimes(0);
  });

  it("still resolves normal types", async () => {
    loadCapabilityDetailsMock.mockImplementation(async (params: { resourceType: string }) =>
      params.resourceType === "mcp"
        ? ({
            resource_type: "MCP",
            name: "normal mcp",
            metadata: { resource_id: "10000019" },
            mcp: { server_url: "http://mcp.local/mcp", tools: [] },
            _discovery_source: "local_snapshot",
          } as never)
        : null,
    );

    const result = await resolveCapability({
      resourcesDir: "/tmp/does-not-exist",
      capabilityId: "10000019",
      resourceType: "MCP",
      resourceContext: emptyContext(),
      authContext: AUTH,
    });

    expect(result.disabled).toBeUndefined();
    expect(result.capability?.resource_type).toBe("MCP");
    expect(refreshMcpCapabilityMock).toHaveBeenCalledTimes(1);
  });
});

describe("executor gates", () => {
  it("runBaiyingExecutor rejects a disabled type before constructing an executor", async () => {
    for (const resourceType of ["OBJECT", "ontology_base", "scene"]) {
      const result = await runBaiyingExecutor({
        resourcesDir: "/tmp/does-not-exist",
        resourceId: "10000018",
        resourceType,
        payload: {},
      });
      expect(result).toMatchObject({ success: false, error_code: "RESOURCE_TYPE_DISABLED" });
    }
    expect(refreshMcpCapabilityMock).toHaveBeenCalledTimes(0);
  });

  it("BaiyingExecutor.execute does not dispatch a retired resolved type", async () => {
    // Synthetic bypass: the `object` snapshot folder wins the lookup while the
    // capability declares another type, so the resolver returns
    // `resolvedType === "object"` with no disabled flag and no MCP refresh. The
    // executor's independent dispatch gate must still stop it — without that
    // gate this request would reach `executeMcp`.
    loadCapabilityDetailsMock.mockImplementation(async (params: { resourceType: string }) =>
      params.resourceType === "object"
        ? ({
            resource_type: "TOOLKIT",
            name: "legacy object folder entry",
            metadata: { resource_id: "10000018" },
            _discovery_source: "local_snapshot",
          } as never)
        : null,
    );

    const executor = new BaiyingExecutor({
      resourcesDir: "/tmp/does-not-exist",
      authFilePath: "/tmp/baiying-does-not-exist.json",
    });
    const result = await executor.execute({ capabilityId: "10000018", resourceType: "MCP", payload: {} });

    expect(result).toMatchObject({ success: false, error_code: "RESOURCE_TYPE_DISABLED" });
    expect(refreshMcpCapabilityMock).toHaveBeenCalledTimes(0);
    expect(executeViaCallAgentMock).toHaveBeenCalledTimes(0);
  });

  it("BaiyingExecutor.describe reports a disabled type as an error", async () => {
    const executor = new BaiyingExecutor({
      resourcesDir: "/tmp/does-not-exist",
      authFilePath: "/tmp/baiying-does-not-exist.json",
    });
    const result = await executor.describe({ capabilityId: "10000018", resourceType: "VIEW", payload: {} });

    expect(result).toMatchObject({ success: false, error_code: "RESOURCE_TYPE_DISABLED" });
    expect(loadCapabilityDetailsMock).toHaveBeenCalledTimes(0);
  });
});

describe("executeMcp gate", () => {
  it("rejects every disabled label form and never enters the callAgent path", async () => {
    for (const resourceType of ["OBJECT", "object", "VIEW", "view", "ONTOLOGY_BASE", "ontology_base", "SCENE", "scene"]) {
      const result = await executeMcp({
        capability: {
          resource_type: resourceType,
          name: "用户信息表",
          metadata: { resource_id: "10000018" },
          mcp: { server_url: "http://datacloud.local/mcp", tools: [] },
        } as never,
        action: "",
        parameters: {},
        authContext: AUTH,
      });
      expect({ resourceType, result }).toMatchObject({
        resourceType,
        result: { success: false, error_code: "RESOURCE_TYPE_DISABLED" },
      });
    }
    expect(executeViaCallAgentMock).toHaveBeenCalledTimes(0);
  });
});
