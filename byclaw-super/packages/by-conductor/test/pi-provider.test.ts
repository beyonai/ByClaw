import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiLeaderSessionFactory } from "../src/pi-leader.js";

describe("Pi provider registration", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("selects the Volcengine Ark DeepSeek Responses model", async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), "byclaw-ark-provider-"));
    tempDirectories.push(cacheDirectory);

    const factory = await PiLeaderSessionFactory.create({
      llmProvider: {
        providerId: "volcengine-ark",
        providerName: "Volcengine Ark",
        modelId: "deepseek-v4-pro-260425",
        modelName: "DeepSeek V4 Pro 260425",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "test-only",
        authHeader: true,
        protocol: "openai-responses",
        input: ["text"],
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        reasoning: {
          enabled: true,
          capability: "effort",
          defaultLevel: "medium",
          supportedEfforts: ["low", "medium", "high"],
        },
      },
      instanceId: "ark-provider-test",
      sessionCacheDirectory: cacheDirectory,
    });

    await expect(factory.health()).resolves.toEqual({
      healthy: true,
      model: "volcengine-ark/deepseek-v4-pro-260425",
    });
    expect(
      (
        factory as unknown as {
          selectedModel: { thinkingLevelMap?: Record<string, string | null> };
        }
      ).selectedModel.thinkingLevelMap,
    ).toEqual({
      off: null,
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "high",
      max: "high",
    });
  });
});
