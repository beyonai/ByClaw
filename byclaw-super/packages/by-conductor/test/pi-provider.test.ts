import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiLeaderSessionFactory } from "../src/pi-leader.js";
import { buildPiRuntimeProviderConfig } from "../src/pi-model-provider.js";

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

    const leader = await factory.create("internal-session-1");
    const [instanceDirectory] = await readdir(cacheDirectory);
    expect(instanceDirectory).toBeDefined();
    await expect(
      access(join(cacheDirectory, instanceDirectory!, "internal-session-1", "files")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await leader.dispose();
  });

  it("uses system instead of developer for Ark Responses compatibility", () => {
    const provider = buildPiRuntimeProviderConfig({
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
      },
    });

    expect(provider.provider.models[0]?.compat).toMatchObject({
      supportsDeveloperRole: false,
    });
  });

  it("uses system by default for every Responses provider", () => {
    const provider = buildPiRuntimeProviderConfig({
      providerId: "custom-responses",
      providerName: "Custom Responses",
      modelId: "model",
      modelName: "Model",
      baseUrl: "https://example.test/v1",
      apiKey: "test-only",
      authHeader: true,
      protocol: "openai-responses",
      input: ["text"],
      contextWindow: 128_000,
      maxTokens: 8_192,
      reasoning: {
        enabled: true,
      },
    });

    expect(provider.provider.models[0]?.compat).toMatchObject({
      supportsDeveloperRole: false,
    });
  });

  it("removes developer from the final Leader provider request", async () => {
    let capturedPayload: Record<string, unknown> | undefined;
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (request, init) => {
        const body =
          init?.body ??
          (request instanceof Request ? await request.clone().text() : undefined);
        capturedPayload = JSON.parse(String(body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ error: { message: "request captured token=secret-live-value" } }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );

    try {
      const cacheDirectory = await mkdtemp(join(tmpdir(), "byclaw-role-provider-"));
      tempDirectories.push(cacheDirectory);
      const factory = await PiLeaderSessionFactory.create({
        llmProvider: {
          providerId: "custom-responses",
          providerName: "Custom Responses",
          modelId: "reasoning-model",
          modelName: "Reasoning Model",
          baseUrl: "https://provider.example.test/v1",
          apiKey: "test-only",
          authHeader: true,
          protocol: "openai-responses",
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 8_192,
          reasoning: { enabled: true },
        },
        instanceId: "role-provider-test",
        sessionCacheDirectory: cacheDirectory,
        logger: { info, warn, error },
      });
      const leader = await factory.create("internal-session-role-test");

      await expect(
        leader.run({
          message: "hello",
          observability: {
            runId: "run-role-test",
            sessionId: "session-role-test",
            externalSessionId: "external-session-role-test",
            traceId: "trace-role-test",
          },
          attachments: [],
          thinkingLevel: "medium",
          agents: [],
          sessionContext: { schemaVersion: 1 },
          currentTime: Date.now(),
          signal: new AbortController().signal,
          onDelta: () => undefined,
          delegate: async () => {
            throw new Error("not used");
          },
          askUser: async () => {
            throw new Error("not used");
          },
        }),
      ).rejects.toThrow("Leader model call failed");

      const input = capturedPayload?.input;
      expect(Array.isArray(input) ? input[0] : undefined).toMatchObject({ role: "system" });
      expect(JSON.stringify(capturedPayload)).not.toContain('"role":"developer"');
      const structuredLogs = [...info.mock.calls, ...warn.mock.calls].map(
        ([bindings]) => bindings as Record<string, unknown>,
      );
      expect(structuredLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stage: "leader_run_started",
            internalSessionId: "internal-session-role-test",
            sessionId: "session-role-test",
            externalSessionId: "external-session-role-test",
          }),
          expect.objectContaining({
            stage: "leader_provider_request_started",
            turnNumber: 1,
          }),
          expect.objectContaining({
            stage: "leader_provider_request_finished",
            stopReason: "error",
          }),
          expect.objectContaining({
            stage: "leader_run_finished",
            turnCount: 1,
          }),
        ]),
      );
      expect(JSON.stringify(structuredLogs)).not.toContain("secret-live-value");
      expect(error).not.toHaveBeenCalled();
      await leader.dispose();
    } finally {
      fetchMock.mockRestore();
    }
  });
});
