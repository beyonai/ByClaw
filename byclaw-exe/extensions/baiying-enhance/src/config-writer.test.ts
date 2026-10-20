import { describe, expect, it, vi } from "vitest";
import { mutateOpenClawConfigFile } from "./config-writer.js";
import { runRuntimeUpdateContext, RuntimeUpdateDeferredError } from "../../shared/src/redis-runtime-update-gate.js";

describe("mutateOpenClawConfigFile", () => {
  it("uses mutateConfigFile when available so writes are based on the full disk config", async () => {
    const diskConfig = {
      agents: { list: [{ id: "main" }] },
      models: { providers: {} },
      plugins: { entries: { "byai-channel": { enabled: true } } },
    };
    const api = {
      runtime: {
        version: "2026.7.1",
        config: {
          loadConfig: vi.fn(() => {
            throw new Error("deprecated load should not be used");
          }),
          writeConfigFile: vi.fn(async () => {
            throw new Error("Config write rejected");
          }),
          mutateConfigFile: vi.fn(async (params) => {
            await params.mutate(diskConfig);
          }),
        },
      },
    } as any;

    await runRuntimeUpdateContext(() => mutateOpenClawConfigFile(api, (base) => {
      const next = structuredClone(base);
      next.models!.providers!["baiying-m-10000482"] = {
        api: "openai-completions",
        models: [{ id: "MiniMax-M3" }],
      };
      return next;
    }));

    expect(api.runtime.config.mutateConfigFile).toHaveBeenCalledTimes(1);
    expect(api.runtime.config.mutateConfigFile).toHaveBeenCalledWith({
      afterWrite: { mode: "auto" },
      mutate: expect.any(Function),
    });
    expect(api.runtime.config.writeConfigFile).not.toHaveBeenCalled();
    expect(diskConfig.plugins.entries["byai-channel"].enabled).toBe(true);
    expect(diskConfig.models.providers["baiying-m-10000482"]).toEqual(
      expect.objectContaining({
        api: "openai-completions",
        models: [expect.objectContaining({ id: "MiniMax-M3" })],
      }),
    );
  });

  it("falls back to writeConfigFile for older OpenClaw runtimes", async () => {
    const diskConfig = {
      agents: { list: [{ id: "main" }] },
      models: { providers: {} },
    };
    const api = {
      runtime: {
        version: "2026.7.1",
        config: {
          loadConfig: vi.fn(() => diskConfig),
          writeConfigFile: vi.fn(async () => undefined),
        },
      },
    } as any;

    await runRuntimeUpdateContext(() => mutateOpenClawConfigFile(api, (base) => ({
      ...base,
      agents: {
        ...base.agents,
        defaults: { model: { primary: "baiying-m-10000482/MiniMax-M3" } },
      },
    })));

    expect(api.runtime.config.loadConfig).toHaveBeenCalledTimes(1);
    expect(api.runtime.config.writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: expect.objectContaining({
          defaults: { model: { primary: "baiying-m-10000482/MiniMax-M3" } },
        }),
      }),
    );
  });

  function createApi(diskConfig: Record<string, any> = {}) {
    const committed = vi.fn();
    const api = {
      runtime: {
        version: "2026.7.1" as string | undefined,
        config: {
          current: vi.fn(() => diskConfig),
          loadConfig: vi.fn(() => diskConfig),
          writeConfigFile: vi.fn(async () => committed()),
          mutateConfigFile: vi.fn(async (params: { mutate: (base: any) => unknown }) => {
            await params.mutate(diskConfig);
            committed();
          }),
        },
      },
    };
    return { api: api as any, committed, diskConfig };
  }

  it("rejects an unqueued write outside the update context before reading or mutating config", async () => {
    const { api, committed } = createApi();
    const mutator = vi.fn((base) => ({ ...base, agents: { list: [] } }));

    await expect(mutateOpenClawConfigFile(api, mutator)).rejects.toBeInstanceOf(RuntimeUpdateDeferredError);

    expect(mutator).not.toHaveBeenCalled();
    expect(api.runtime.config.mutateConfigFile).not.toHaveBeenCalled();
    expect(api.runtime.config.loadConfig).not.toHaveBeenCalled();
    expect(api.runtime.config.writeConfigFile).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  });

  it("blocks a generated Thinking membership reload before the disk config is modified", async () => {
    const { api, committed, diskConfig } = createApi({ models: { providers: {} } });
    const original = structuredClone(diskConfig);

    await expect(runRuntimeUpdateContext(() => mutateOpenClawConfigFile(api, (base) => {
      base.models!.providers!.managed = {
        baseUrl: "https://models.example.test",
        models: [{
          id: "thinking-model",
          params: { baiyingReasoningConfig: { enabled: true, compatFormat: "bailian", capability: "effort" } },
        }],
      } as any;
      return base;
    }))).rejects.toBeInstanceOf(RuntimeUpdateDeferredError);

    expect(committed).not.toHaveBeenCalled();
    expect(api.runtime.config.writeConfigFile).not.toHaveBeenCalled();
    expect(diskConfig).toEqual(original);
  });

  it.each([undefined, "unknown", "2026.7.2"])("blocks unaudited runtime version %s before committing", async (version) => {
    const { api, committed, diskConfig } = createApi();
    api.runtime.version = version;

    await expect(runRuntimeUpdateContext(() => mutateOpenClawConfigFile(api, (base) => ({
      ...base,
      agents: { list: [] },
    })))).rejects.toBeInstanceOf(RuntimeUpdateDeferredError);

    expect(committed).not.toHaveBeenCalled();
    expect(diskConfig).toEqual({});
  });

  it.each(["off", "restart"])("blocks reload mode %s before committing", async (mode) => {
    const before = { gateway: { reload: { mode } } };
    const { api, committed, diskConfig } = createApi(structuredClone(before));

    await expect(runRuntimeUpdateContext(() => mutateOpenClawConfigFile(api, (base) => ({
      ...base,
      agents: { list: [] },
    })))).rejects.toBeInstanceOf(RuntimeUpdateDeferredError);

    expect(committed).not.toHaveBeenCalled();
    expect(diskConfig).toEqual(before);
  });

  it("keeps update permission local while an update callback is suspended", async () => {
    const { api, committed, diskConfig } = createApi();
    let resume!: () => void;
    const suspended = new Promise<void>((resolve) => { resume = resolve; });
    const update = runRuntimeUpdateContext(async () => {
      await suspended;
      await mutateOpenClawConfigFile(api, (base) => ({ ...base, agents: { list: [{ id: "safe" }] } }));
    });

    await expect(mutateOpenClawConfigFile(api, (base) => ({
      ...base,
      agents: { list: [{ id: "unqueued" }] },
    }))).rejects.toBeInstanceOf(RuntimeUpdateDeferredError);
    expect(committed).not.toHaveBeenCalled();

    resume();
    await update;
    expect(committed).toHaveBeenCalledTimes(1);
    expect(diskConfig.agents.list).toEqual([{ id: "safe" }]);
  });

  it("does not leak a rejected mutator's partial changes into a concurrent safe update", async () => {
    const { api, committed, diskConfig } = createApi({ agents: { list: [] } });

    const results = await Promise.allSettled([
      runRuntimeUpdateContext(() => mutateOpenClawConfigFile(api, (base) => {
        base.agents!.list!.push({ id: "rejected" });
        base.plugins = { entries: { "baiying-enhance": { enabled: false } } };
        return base;
      })),
      runRuntimeUpdateContext(() => mutateOpenClawConfigFile(api, (base) => ({
        ...base,
        agents: { ...base.agents, list: [...base.agents!.list!, { id: "safe" }] },
      }))),
    ]);

    expect(results[0]).toMatchObject({ status: "rejected", reason: expect.any(RuntimeUpdateDeferredError) });
    expect(results[1]).toMatchObject({ status: "fulfilled" });
    expect(committed).toHaveBeenCalledTimes(1);
    expect(diskConfig.agents.list).toEqual([{ id: "safe" }]);
    expect(diskConfig.plugins).toBeUndefined();
  });
});
