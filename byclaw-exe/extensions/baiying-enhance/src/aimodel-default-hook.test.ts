import { describe, expect, it, vi } from "vitest";
import { registerBaiyingDefaultModelHook } from "./aimodel-default-hook.js";

describe("baiying default model hook", () => {
  it("returns the Redis default model before the main agent run", async () => {
    let handler: ((event: unknown, ctx: { agentId?: string }) => Promise<unknown>) | undefined;
    const api = {
      on: vi.fn((_event: string, callback: typeof handler) => {
        handler = callback as typeof handler;
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
      runtime: {
        config: {
          current: () => ({ agents: { defaults: { model: {} }, list: [{ id: "main" }] }, models: { providers: {} } }),
        },
      },
    };
    const ensureConfig = vi.fn(async () => undefined);
    registerBaiyingDefaultModelHook({
      api,
      pluginConfig: {},
      redisJsonStore: {
        getHashJson: async () => ({
          key: "byai:aimodel:typelist",
          content: "typelist",
          hash: "hash",
          raw: [{
            status: 1,
            isDefault: 1,
            instanceId: "default-model",
            modelCode: "default-code",
            url: "https://model.example/v1",
            authToken: "runtime-token",
            modelType: "LLM",
            instanceParam: { providerName: "openai" },
          }],
        }),
      },
      ensureConfig,
    } as never);

    const result = await handler?.({}, { agentId: "main" });
    expect(result).toEqual({ providerOverride: "baiying-m-default-model", modelOverride: "default-code" });
    expect(ensureConfig).toHaveBeenCalledOnce();
  });

  it("returns the Redis default model for a managed agent without an explicit model", async () => {
    let handler: ((event: unknown, ctx: { agentId?: string }) => Promise<unknown>) | undefined;
    const api = {
      on: vi.fn((_event: string, callback: typeof handler) => {
        handler = callback as typeof handler;
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
      runtime: {
        config: {
          current: () => ({
            agents: {
              defaults: { model: {} },
              list: [{ id: "main" }, { id: "baiying-agent-10000235" }],
            },
            models: { providers: {} },
          }),
        },
      },
    };
    const ensureConfig = vi.fn(async () => undefined);
    registerBaiyingDefaultModelHook({
      api,
      pluginConfig: {},
      redisJsonStore: {
        getHashJson: async () => ({
          key: "byai:aimodel:typelist",
          content: "typelist",
          hash: "hash",
          raw: [{
            status: 1,
            isDefault: 1,
            instanceId: "managed-agent-model",
            modelCode: "managed-agent-code",
            url: "https://model.example/v1",
            authToken: "runtime-token",
            modelType: "LLM",
            instanceParam: { providerName: "openai" },
          }],
        }),
      },
      ensureConfig,
    } as never);

    const result = await handler?.({}, { agentId: "baiying-agent-10000235" });
    expect(result).toEqual({
      providerOverride: "baiying-m-managed-agent-model",
      modelOverride: "managed-agent-code",
    });
    expect(ensureConfig).toHaveBeenCalledOnce();
  });
});
