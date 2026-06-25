import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  resolveBaiyingAgentConfigReadiness,
  resolveManagedBaiyingAgentConfigReadiness,
  waitForBaiyingAgentConfig,
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

function configWithMainDefaultModel(): OpenClawConfig {
  return {
    agents: {
      list: [{ id: "main" }],
      defaults: {
        model: {
          primary: "baiying-m-10000482/MiniMax-M3",
        },
      },
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

describe("baiying agent config wait", () => {
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

  it("reports main as not ready until a primary model is available", () => {
    const readiness = resolveBaiyingAgentConfigReadiness(
      {
        agents: {
          list: [{ id: "main" }],
          defaults: { model: {} },
        },
        models: { providers: {} },
      } as unknown as OpenClawConfig,
      "main",
    );

    expect(readiness).toMatchObject({
      ready: false,
      agentId: "main",
      reason: "primary_model_missing",
    });
  });

  it("reports main as ready when defaults point at a registered provider model", () => {
    const readiness = resolveBaiyingAgentConfigReadiness(configWithMainDefaultModel(), "main");

    expect(readiness).toMatchObject({
      ready: true,
      agentId: "main",
      primary: "baiying-m-10000482/MiniMax-M3",
      providerId: "baiying-m-10000482",
      modelId: "MiniMax-M3",
    });
  });

  it("does not wait for unrelated agent ids", () => {
    const readiness = resolveBaiyingAgentConfigReadiness(
      { agents: { list: [] }, models: { providers: {} } } as unknown as OpenClawConfig,
      "custom-agent",
    );

    expect(readiness).toMatchObject({
      ready: true,
      agentId: "custom-agent",
      reason: "not_baiying_config_wait_target",
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
      expect.stringContaining("waiting for baiying agent config before dispatch"),
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("baiying agent config ready before dispatch"),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("waits for main config to include its provider model before dispatch", async () => {
    const coldConfig = {
      agents: {
        list: [{ id: "main" }],
        defaults: { model: {} },
      },
      models: { providers: {} },
    } as unknown as OpenClawConfig;
    const readyConfig = configWithMainDefaultModel();
    let calls = 0;
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    const result = await waitForBaiyingAgentConfig({
      runtime: {
        config: {
          current: () => {
            calls += 1;
            return calls >= 3 ? readyConfig : coldConfig;
          },
        },
      },
      cfg: coldConfig,
      agentId: "main",
      log,
      waitMs: 200,
      pollMs: 5,
    });

    expect(result).toBe(readyConfig);
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("waiting for baiying agent config before dispatch: agent=main"),
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("baiying agent config ready before dispatch: agent=main"),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });
});
