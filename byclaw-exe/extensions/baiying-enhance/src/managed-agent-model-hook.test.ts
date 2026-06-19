import { describe, expect, it, vi } from "vitest";
import {
  buildManagedAgentRuntimeModelSystemContext,
  hasManagedModelConfigDrift,
  resolveManagedAgentModelFromConfig,
  syncManagedAgentSessionModelForInbound,
  warnUnresolvedManagedProviderApiKeysAfterSync,
} from "./managed-agent-model-hook.js";

const registeredCfg = {
  agents: {
    list: [
      {
        id: "baiying-agent-10000455",
        model: { primary: "baiying-m-10003989/qwen3.6-35b-a3b" },
      },
    ],
  },
  models: {
    providers: {
      "baiying-m-10003989": {
        models: [{ id: "qwen3.6-35b-a3b" }],
      },
    },
  },
};

describe("hasManagedModelConfigDrift", () => {
  it("detects when agents.list primary lags Redis-managed modelRef", () => {
    expect(
      hasManagedModelConfigDrift({
        cfg: {
          agents: {
            list: [
              {
                id: "baiying-agent-10000455",
                model: { primary: "baiying-m-10004009/deepseek-v4-pro" },
              },
            ],
          },
        },
        managed: [
          {
            agentId: "baiying-agent-10000455",
            modelRef: "baiying-m-10004000/qwen3.6-27b",
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("warnUnresolvedManagedProviderApiKeysAfterSync", () => {
  it("warns when runtime provider apiKey is still a SecretRef", () => {
    const warnings: string[] = [];
    warnUnresolvedManagedProviderApiKeysAfterSync({
      cfg: {
        models: {
          providers: {
            "baiying-m-10004000": {
              apiKey: { source: "exec", provider: "baiying-aimodel-redis", id: "model:10004000" },
            },
          },
        },
      },
      managed: [
        {
          agentId: "baiying-agent-10000455",
          providerKey: "baiying-m-10004000",
          modelRef: "baiying-m-10004000/qwen3.6-27b",
        },
      ],
      log: { warn: (m) => warnings.push(m) },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("runtime secrets snapshot did not materialize");
  });
});

describe("resolveManagedAgentModelFromConfig", () => {
  it("returns provider/model overrides for managed agents", () => {
    expect(
      resolveManagedAgentModelFromConfig({
        agentId: "baiying-agent-10000455",
        cfg: registeredCfg,
      }),
    ).toEqual({
      providerOverride: "baiying-m-10003989",
      modelOverride: "qwen3.6-35b-a3b",
    });
  });

  it("skips override when models.providers is missing the model", () => {
    expect(
      resolveManagedAgentModelFromConfig({
        agentId: "baiying-agent-10000455",
        cfg: {
          agents: registeredCfg.agents,
          models: { providers: {} },
        },
      }),
    ).toBeUndefined();
  });

  it("ignores non-managed agents", () => {
    expect(
      resolveManagedAgentModelFromConfig({
        agentId: "main",
        cfg: {
          agents: {
            list: [{ id: "main", model: { primary: "minimax/MiniMax-M2.7-highspeed" } }],
          },
        },
      }),
    ).toBeUndefined();
  });
});

describe("buildManagedAgentRuntimeModelSystemContext", () => {
  it("injects a current-model fact for managed agents", () => {
    const context = buildManagedAgentRuntimeModelSystemContext({
      agentId: "baiying-agent-10000455",
      cfg: registeredCfg,
    });

    expect(context).toContain("baiying-m-10003989/qwen3.6-35b-a3b");
    expect(context).toContain("Ignore earlier transcript self-identification");
  });

  it("skips non-managed agents", () => {
    expect(
      buildManagedAgentRuntimeModelSystemContext({
        agentId: "main",
        cfg: registeredCfg,
      }),
    ).toBeUndefined();
  });
});

describe("syncManagedAgentSessionModelForInbound", () => {
  it("writes overrides for a new managed session before dispatch", async () => {
    const entry: Record<string, unknown> = {
      modelProvider: "baiying-m-10004019",
      model: "kimi-k2.6",
    };
    const updateSessionStoreEntry = vi.fn(async (_params) => {
      const mutator = _params.update as (entry: Record<string, unknown>) => Promise<void>;
      await mutator(entry);
    });
    const api = {
      runtime: {
        config: {
          current: () => ({
            session: { store: "(multiple)" },
            agents: {
              list: [
                {
                  id: "baiying-agent-10000455",
                  model: { primary: "baiying-m-10004000/qwen3.6-27b" },
                },
              ],
            },
            models: {
              providers: {
                "baiying-m-10004000": {
                  models: [{ id: "qwen3.6-27b" }],
                },
              },
            },
          }),
          loadConfig: () => ({
            session: { store: "(multiple)" },
            agents: {
              list: [
                {
                  id: "baiying-agent-10000455",
                  model: { primary: "baiying-m-10004000/qwen3.6-27b" },
                },
              ],
            },
            models: {
              providers: {
                "baiying-m-10004000": {
                  models: [{ id: "qwen3.6-27b" }],
                },
              },
            },
          }),
        },
        agent: {
          session: {
            resolveStorePath: () => "/tmp/sessions.json",
            updateSessionStoreEntry,
          },
        },
      },
    } as never;

    await syncManagedAgentSessionModelForInbound({
      api,
      sessionKey: "agent:baiying-agent-10000455:byai-channel:direct:10006251",
    });

    expect(updateSessionStoreEntry).toHaveBeenCalledOnce();
    expect(entry.providerOverride).toBe("baiying-m-10004000");
    expect(entry.modelOverride).toBe("qwen3.6-27b");
    expect(entry.modelOverrideSource).toBe("auto");
  });
});
