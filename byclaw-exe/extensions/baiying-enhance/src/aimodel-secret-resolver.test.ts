import { describe, expect, it } from "vitest";
import { resolveAimodelSecretRequest } from "./aimodel-secret-resolver.js";

describe("baiying aimodel secret resolver", () => {
  it("resolves a model ref from the Redis model hash without logging the token", async () => {
    const result = await resolveAimodelSecretRequest({
      request: JSON.stringify({ protocolVersion: 1, ids: ["model:model-instance-1"] }),
      redisJsonStore: {
        getHashJson: async ({ key, field }) => ({
          key,
          content: "model",
          hash: "hash",
          raw: {
            status: 1,
            instanceId: field,
            modelCode: "model-code",
            url: "https://model.example/v1",
            authToken: "runtime-token",
            instanceParam: { providerName: "openai" },
          },
        }),
      },
    } as never);

    expect(result).toEqual({
      protocolVersion: 1,
      values: { "model:model-instance-1": "runtime-token" },
    });
  });
});
