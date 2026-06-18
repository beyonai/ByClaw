import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  resolveManagedBaiyingAgentConfigReadiness,
  waitForManagedBaiyingAgentConfig,
} from "./managed-agent-config-wait.js";

function configWithManagedAgent(): OpenClawConfig {
  return {
    agents: {
      list: [
        {
          id: "baiying-agent-10003355",
          model: {
            primary: "baiying-m-10000482/MiniMax-M3",
          },
        },
      ],
    },
    models: {
      providers: {
        "baiying-m-10000482": {
          type: "openai-compatible",
          name: "MiniMax",
          baseURL: "http://example.test",
          models: [{ id: "MiniMax-M3", name: "MiniMax-M3" }],
        },
      },
    },
  } as unknown as OpenClawConfig;
}

describe("managed agent config wait", () => {
  it("reports a managed agent as not ready until its agent entry exists", () => {
    const readiness = resolveManagedBaiyingAgentConfigReadiness(
      { agents: { list: [] }, models: { providers: {} } } as unknown as OpenClawConfig,
      "baiying-agent-10003355",
    );

    expect(readiness).toMatchObject({
      ready: false,
      agentId: "baiying-agent-10003355",
      reason: "agent_missing",
    });
  });

  it("reports ready only when the configured provider contains the primary model", () => {
    const readiness = resolveManagedBaiyingAgentConfigReadiness(
      configWithManagedAgent(),
      "baiying-agent-10003355",
    );

    expect(readiness).toMatchObject({
      ready: true,
      primary: "baiying-m-10000482/MiniMax-M3",
      providerId: "baiying-m-10000482",
      modelId: "MiniMax-M3",
    });
  });

  it("waits for runtime config to include the managed agent model before dispatch", async () => {
    const coldConfig = {
      agents: { list: [] },
      models: { providers: {} },
    } as unknown as OpenClawConfig;
    const readyConfig = configWithManagedAgent();
    let calls = 0;
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    const result = await waitForManagedBaiyingAgentConfig({
      runtime: {
        config: {
          current: () => {
            calls += 1;
            return calls >= 3 ? readyConfig : coldConfig;
          },
        },
      },
      cfg: coldConfig,
      agentId: "baiying-agent-10003355",
      log,
      waitMs: 200,
      pollMs: 5,
    });

    expect(result).toBe(readyConfig);
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("waiting for managed agent config before dispatch"),
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("managed agent config ready before dispatch"),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });
});
