import { prepareSessionModelForDispatch, setSessionModelPreparer } from "../../shared/src/session-model-runtime.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSharedRedisJsonStore } from "./redis-json-store.js";
import {
  buildManagedAgentRuntimeModelSystemContext,
  hasManagedModelConfigDrift,
  resolveLangfuseSessionIdFromHookContext,
  resolveManagedAgentModelFromConfig,
  registerManagedAgentModelHooks,
  shouldDeferManagedAgentModelOverrideForRun,
  syncManagedAgentSessionModelForInbound,
  warnUnresolvedManagedProviderApiKeysAfterSync,
} from "./managed-agent-model-hook.js";

afterEach(() => { setSharedRedisJsonStore(null); setSessionModelPreparer(undefined); });

describe("registered before_model_resolve hook", () => {
  it("prepares a previously unknown provider before the channel captures its dispatch config", async () => {
    let current: any = structuredClone(registeredCfg);
    const stale = current;
    const hooks = new Map<string, (...args: any[]) => any>();
    const selection = { modelId: "9002", modelCode: "first-use-model" };
    const record = {
      instanceId: "9002", modelCode: "first-use-model", modelName: "First use",
      status: 1, authToken: "test-token", url: "https://example.test/v1",
      maxContentToken: "128000", instanceParam: { maxTokens: 1024 },
    };
    setSharedRedisJsonStore({
      getJsonByKey: async () => ({ raw: selection }),
      getHashJson: async () => ({ raw: record, content: JSON.stringify(record), hash: "new" }),
    } as never);
    registerManagedAgentModelHooks({
      on: (name: string, handler: (...args: any[]) => any) => hooks.set(name, handler),
      logger: { info: vi.fn(), warn: vi.fn() },
      runtime: { config: {
        current: () => current, loadConfig: () => current,
        writeConfigFile: async (next: any) => { current = next; },
      } },
    } as never, { pluginConfig: { mainParentAgentId: "main" } } as never);
    await prepareSessionModelForDispatch("11210442");
    const dispatchConfig = current;
    expect(stale.models.providers["baiying-m-9002"]).toBeUndefined();
    expect(dispatchConfig.models.providers["baiying-m-9002"].models[0].id).toBe("first-use-model");
    expect(await hooks.get("before_model_resolve")!({}, {
      agentId: "baiying-agent-10000455", sessionKey: "agent:baiying-agent-10000455:direct:11210442",
    })).toEqual({ providerOverride: "baiying-m-9002", modelOverride: "first-use-model" });
    expect(dispatchConfig.agents.list[0].model.primary).toBe(stale.agents.list[0].model.primary);
  });

  it("uses the selected session model at final resolution and falls back after reset without leaking to another session", async () => {
    const hooks = new Map<string, (...args: any[]) => any>();
    let selected = true;
    const read = vi.fn(async (key: string) => {
      if (!selected || key !== "byai:chat:session_model:11210442") return null;
      const raw = { modelId: "9001", modelCode: "selected-model" };
      return { raw, key, content: JSON.stringify(raw), hash: "selected" };
    });
    setSharedRedisJsonStore({ getJsonByKey: read } as never);
    const cfg = {
      ...registeredCfg,
      models: { providers: {
        ...registeredCfg.models.providers,
        "baiying-m-9001": { models: [{ id: "selected-model" }] },
      } },
    };
    registerManagedAgentModelHooks({
      on: (name: string, handler: (...args: any[]) => any) => hooks.set(name, handler),
      logger: { info: vi.fn(), warn: vi.fn() },
      runtime: { config: { current: () => cfg, loadConfig: () => cfg } },
    } as never, { pluginConfig: { mainParentAgentId: "main" } } as never);
    const resolve = hooks.get("before_model_resolve")!;
    const ctx = { agentId: "baiying-agent-10000455", sessionKey: "agent:baiying-agent-10000455:direct:11210442" };

    // Exercise the actual final hook without relying on before_dispatch firing first.
    expect(await resolve({}, ctx)).toEqual({ providerOverride: "baiying-m-9001", modelOverride: "selected-model" });
    expect(await resolve({}, { ...ctx, sessionKey: "agent:baiying-agent-10000455:direct:11210443" })).toEqual({
      providerOverride: "baiying-m-10003989", modelOverride: "qwen3.6-35b-a3b",
    });
    selected = false;
    expect(await resolve({}, ctx)).toEqual({
      providerOverride: "baiying-m-10003989", modelOverride: "qwen3.6-35b-a3b",
    });
    expect(cfg.agents.list[0].model.primary).toBe("baiying-m-10003989/qwen3.6-35b-a3b");
  });
});

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
  it("does not warn for Baiying aimodel SecretRefs handled by the runtime auth hook", () => {
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
    expect(warnings).toHaveLength(0);
  });

  it("warns when an unmanaged runtime provider apiKey is still a SecretRef", () => {
    const warnings: string[] = [];
    warnUnresolvedManagedProviderApiKeysAfterSync({
      cfg: {
        models: {
          providers: {
            "baiying-m-10004000": {
              apiKey: { source: "exec", provider: "vault", id: "provider/10004000" },
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

  it("skips model facts when the active run still uses the previous model", () => {
    expect(
      buildManagedAgentRuntimeModelSystemContext({
        agentId: "baiying-agent-10000455",
        cfg: registeredCfg,
        currentProvider: "baiying-m-10004014",
        currentModel: "deepseek-v4-flash",
      }),
    ).toBeUndefined();
  });
});

describe("resolveLangfuseSessionIdFromHookContext", () => {
  it("uses the byai-channel direct session id from sessionKey", () => {
    expect(
      resolveLangfuseSessionIdFromHookContext({
        sessionId: "openclaw-session",
        sessionKey: "agent:baiying-agent-10000455:byai-channel:direct:10006251",
      }),
    ).toBe("10006251");
  });

  it("falls back to hook sessionId when sessionKey has no channel session id", () => {
    expect(
      resolveLangfuseSessionIdFromHookContext({
        sessionId: "openclaw-session",
        sessionKey: "agent:main:main",
      }),
    ).toBe("openclaw-session");
  });
});

describe("shouldDeferManagedAgentModelOverrideForRun", () => {
  it("defers forced overrides when the current run was prepared with an older model", () => {
    expect(
      shouldDeferManagedAgentModelOverrideForRun({
        resolved: {
          providerOverride: "baiying-m-10003989",
          modelOverride: "qwen3.6-35b-a3b",
        },
        currentProvider: "baiying-m-10004014",
        currentModel: "deepseek-v4-flash",
      }),
    ).toBe(true);
  });

  it("allows overrides when the current run already matches the managed target", () => {
    expect(
      shouldDeferManagedAgentModelOverrideForRun({
        resolved: {
          providerOverride: "baiying-m-10003989",
          modelOverride: "qwen3.6-35b-a3b",
        },
        currentProvider: "baiying-m-10003989",
        currentModel: "qwen3.6-35b-a3b",
      }),
    ).toBe(false);
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

  it("aligns the session to the user-picked model when a session override is provided", async () => {
    const entry: Record<string, unknown> = {
      modelProvider: "baiying-m-10004000",
      model: "qwen3.6-27b",
    };
    const updateSessionStoreEntry = vi.fn(async (_params) => {
      const mutator = _params.update as (entry: Record<string, unknown>) => Promise<void>;
      await mutator(entry);
    });
    const cfg = {
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
          "baiying-m-10004000": { models: [{ id: "qwen3.6-27b" }] },
          "baiying-m-9001": { models: [{ id: "code-9001" }] },
        },
      },
    };
    const api = {
      runtime: {
        config: { current: () => cfg, loadConfig: () => cfg },
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
      modelRefOverride: "baiying-m-9001/code-9001",
    });

    expect(updateSessionStoreEntry).toHaveBeenCalledOnce();
    expect(entry.providerOverride).toBe("baiying-m-9001");
    expect(entry.modelOverride).toBe("code-9001");
    expect(entry.modelProvider).toBe("baiying-m-9001");
    expect(entry.model).toBe("code-9001");
  });
});
