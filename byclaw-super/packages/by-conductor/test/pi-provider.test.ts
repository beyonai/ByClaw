import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiLeaderSessionFactory } from "../src/pi-leader.js";

describe("Pi provider registration", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("selects the Volcengine Ark DeepSeek Responses model", async () => {
    vi.stubEnv("ARK_API_KEY", "test-only");
    const cacheDirectory = await mkdtemp(join(tmpdir(), "byclaw-ark-provider-"));
    tempDirectories.push(cacheDirectory);

    const factory = await PiLeaderSessionFactory.create({
      provider: "volcengine-ark",
      model: "deepseek-v4-pro-260425",
      arkBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
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
