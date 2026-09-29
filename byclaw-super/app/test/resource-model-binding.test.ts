import { describe, expect, it, vi } from "vitest";
import { ByClawBeResourceModelResolver } from "../business/resource-model-binding.js";

describe("ByClaw BE resource model resolver", () => {
  it("loads the resource prologue and validates its model through Redis", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            resourceId: "10000249",
            prologue: JSON.stringify({
              modelInfo: { modelId: 10014488, model: "deepseek-v4-flash" },
            }),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const resolveByModelId = vi.fn(async () => ({
      providerId: "baiying-m-10014488",
      providerName: "DeepSeek",
      modelId: "deepseek-v4-flash",
      modelName: "DeepSeek V4 Flash",
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      authHeader: true,
      protocol: "openai-completions" as const,
      input: ["text" as const],
      contextWindow: 128_000,
      maxTokens: 8_192,
      reasoning: { enabled: false as const },
    }));
    const resolver = new ByClawBeResourceModelResolver({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as typeof fetch,
      llmProvider: { resolveByModelId } as never,
    });

    const selection = await resolver.resolve({
      resourceId: "10000249",
      beyondToken: "run-token",
      systemCode: "BYAI",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8086/byaiService/open/api/v1/queryDigEmployeeDetail"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Beyond-Token": "run-token",
          "System-Code": "BYAI",
        }),
        body: JSON.stringify({ resourceId: "10000249" }),
      }),
    );
    expect(resolveByModelId).toHaveBeenCalledWith("10014488");
    expect(selection).toEqual({
      modelId: "10014488",
    });
    expect(JSON.stringify(selection)).not.toContain("secret");
  });

  it("keeps the same model selection when its credential rotates", async () => {
    const resolveByModelId = vi.fn()
      .mockResolvedValueOnce(modelConfig())
      .mockResolvedValueOnce({ ...modelConfig(), apiKey: "rotated-secret" });
    const resolver = new ByClawBeResourceModelResolver({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () => Response.json({
        code: 0,
        data: { prologue: JSON.stringify({ modelId: "10014488" }) },
      })) as typeof fetch,
      llmProvider: { resolveByModelId } as never,
    });

    const first = await resolver.resolve({ resourceId: "1", beyondToken: "token" });
    const second = await resolver.resolve({ resourceId: "1", beyondToken: "token" });

    expect(first).toEqual({ modelId: "10014488" });
    expect(second).toEqual(first);
    expect(resolveByModelId).toHaveBeenCalledTimes(2);
  });

  it("prefers the top-level modelId over the compatibility nested field", async () => {
    const resolveByModelId = vi.fn(async () => modelConfig());
    const resolver = new ByClawBeResourceModelResolver({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              prologue: JSON.stringify({
                modelId: -2000,
                modelInfo: { modelId: 10014488 },
              }),
            },
          }),
        ),
      ) as typeof fetch,
      llmProvider: { resolveByModelId } as never,
    });

    await resolver.resolve({ resourceId: "1", beyondToken: "token" });

    expect(resolveByModelId).toHaveBeenCalledWith("-2000");
  });
});

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
