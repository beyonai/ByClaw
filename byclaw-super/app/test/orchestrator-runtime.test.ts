import { describe, expect, it, vi } from "vitest";
import {
  ByClawBeOrchestratorRuntimeError,
  ByClawBeOrchestratorRuntimeProvider,
} from "../business/orchestrator-runtime.js";

describe("ByClaw BE orchestrator runtime provider", () => {
  it("loads an authorized expert-team snapshot and maps its members", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        code: 0,
        success: true,
        data: runtimeResponse(),
      }),
    );
    const resolveByModelId = vi.fn(async () => modelConfig());
    const provider = new ByClawBeOrchestratorRuntimeProvider({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as typeof fetch,
      llmProvider: { resolveByModelId },
    });

    const resolved = await provider.resolve({
      orchestrator: {
        schemaVersion: "byclaw.orchestrator-ref/v1",
        kind: "EXPERT_TEAM",
        id: "90001",
      },
      beyondToken: "run-token",
      systemCode: "BYAI",
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://127.0.0.1:8086/byaiService/internal/v1/orchestrators/resolve-runtime",
    );
    expect(init?.headers).toMatchObject({
      "Beyond-Token": "run-token",
      "System-Code": "BYAI",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: "byclaw.orchestrator-runtime-request/v1",
      kind: "EXPERT_TEAM",
      orchestratorId: "90001",
    });
    expect(resolved.orchestrator).toEqual({
      schemaVersion: "byclaw.orchestrator-runtime/v1",
      kind: "EXPERT_TEAM",
      id: "90001",
      name: "营销专家团",
      prompt: { content: "只负责协调营销专家。", version: "12" },
      contextProfile: "EXPERT_TEAM_MINIMAL_V1",
      configVersion: "21",
    });
    expect(resolved.agents).toEqual([
      {
        id: "20001",
        code: "market_research",
        name: "市场调研专家",
        description:
          "负责市场与竞品调研；技能：project-context、notice、project-cloud-knowledge",
        role: "调研分析",
        skills: [
          "project-context",
          "notice",
          "project-cloud-knowledge",
        ],
        execution: {
          connectorId: "openclaw-by-framework",
          targetId: "20001",
        },
      },
    ]);
    expect(resolveByModelId).toHaveBeenCalledWith("10023");
    expect(resolved.leaderModel).toEqual({
      modelId: "10023",
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(resolved)).not.toContain("secret");
  });

  it("rejects a response for a different orchestrator", async () => {
    const response = runtimeResponse();
    response.orchestrator.id = "other-team";
    const provider = new ByClawBeOrchestratorRuntimeProvider({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () =>
        Response.json({ code: 0, success: true, data: response }),
      ) as typeof fetch,
      llmProvider: { resolveByModelId: vi.fn(async () => modelConfig()) },
    });

    await expect(
      provider.resolve({
        orchestrator: {
          schemaVersion: "byclaw.orchestrator-ref/v1",
          kind: "EXPERT_TEAM",
          id: "90001",
        },
        beyondToken: "run-token",
      }),
    ).rejects.toBeInstanceOf(ByClawBeOrchestratorRuntimeError);
  });
});

function runtimeResponse() {
  return {
    schemaVersion: "byclaw.orchestrator-runtime/v1",
    orchestrator: {
      id: "90001",
      kind: "EXPERT_TEAM",
      name: "营销专家团",
    },
    prompt: { content: "只负责协调营销专家。", version: "12" },
    contextProfile: "EXPERT_TEAM_MINIMAL_V1",
    model: { modelId: "10023", configVersion: "7" },
    agents: [
      {
        id: "20001",
        resourceCode: "market_research",
        name: "市场调研专家",
        description: "负责市场与竞品调研",
        teamRole: "调研分析",
        createType: "SELF",
        agentType: "001",
      },
    ],
    configVersion: "21",
  };
}

function modelConfig() {
  return {
    providerId: "provider",
    providerName: "Provider",
    modelId: "model",
    modelName: "Model",
    baseUrl: "https://example.test/v1",
    apiKey: "secret",
    authHeader: true,
    protocol: "openai-completions" as const,
    input: ["text" as const],
    contextWindow: 128_000,
    maxTokens: 8_192,
    reasoning: { enabled: false as const },
  };
}
