import { beforeEach, describe, expect, it, vi } from "vitest";
import { rememberAimodelAuthToken, resetAimodelAuthTokenCacheForTests } from "./aimodel-auth-cache.js";
import { registerBaiyingAimodelRuntimeProvider } from "./aimodel-runtime-provider.js";

describe("baiying dynamic model runtime provider", () => {
  beforeEach(() => resetAimodelAuthTokenCacheForTests());

  it("resolves cached Redis tokens only for managed providers", () => {
    const registerProvider = vi.fn();
    const api = {
      logger: { warn: vi.fn() },
      registerProvider,
    } as never;
    rememberAimodelAuthToken({ modelId: "model-instance-1", token: "runtime-token" });

    registerBaiyingAimodelRuntimeProvider(api, {});
    const provider = registerProvider.mock.calls[0]?.[0] as {
      resolveSyntheticAuth: (input: { provider: string; providerConfig: { apiKey: unknown } }) => unknown;
    };

    expect(provider.resolveSyntheticAuth({ provider: "baiying-m-model-instance-1", providerConfig: { apiKey: undefined } })).toMatchObject({
      apiKey: "runtime-token",
      mode: "api-key",
    });
    expect(provider.resolveSyntheticAuth({ provider: "static-provider", providerConfig: { apiKey: undefined } })).toBeUndefined();
  });
});
