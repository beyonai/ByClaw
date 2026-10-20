import { describe, expect, it, vi } from "vitest";
import { writeBaiyingMergedConfig } from "./config-write.js";
import { runRuntimeUpdateContext, RuntimeUpdateDeferredError } from "../../shared/src/redis-runtime-update-gate.js";

function createApi(before: Record<string, any> = {}) {
  return {
    runtime: {
      version: "2026.7.1",
      config: {
        current: vi.fn(() => before),
        loadConfig: vi.fn(() => before),
        writeConfigFile: vi.fn(async () => undefined),
      },
    },
  } as any;
}

describe("writeBaiyingMergedConfig", () => {
  it("requires update context before reading or writing config", async () => {
    const api = createApi();

    await expect(writeBaiyingMergedConfig(api, { agents: { list: [] } })).rejects.toBeInstanceOf(RuntimeUpdateDeferredError);

    expect(api.runtime.config.current).not.toHaveBeenCalled();
    expect(api.runtime.config.loadConfig).not.toHaveBeenCalled();
    expect(api.runtime.config.writeConfigFile).not.toHaveBeenCalled();
  });

  it("preserves generated and caller-supplied explicitSetPaths in a safe replacement", async () => {
    const api = createApi();
    const next = {
      models: { providers: { "baiying-m-100": { models: [{ id: "managed", compat: { supportsUsageInStreaming: true } }] } } },
    } as any;
    const options = { explicitSetPaths: [["agents", "defaults", "model"]] } as any;

    await runRuntimeUpdateContext(() => writeBaiyingMergedConfig(api, next, options));

    expect(api.runtime.config.writeConfigFile).toHaveBeenCalledWith(next, {
      explicitSetPaths: [
        ["models", "providers", "baiying-m-100", "models", "0", "compat"],
        ["agents", "defaults", "model"],
      ],
    });
    expect(options.explicitSetPaths).toEqual([["agents", "defaults", "model"]]);
  });

  it("blocks plugin membership changes even when replacement is in the update context", async () => {
    const api = createApi();
    const next = {
      models: { providers: { managed: { models: [{
        id: "thinking-model",
        params: { baiyingReasoningConfig: { enabled: true, compatFormat: "bailian", capability: "effort" } },
      }] } } },
    } as any;

    await expect(runRuntimeUpdateContext(() => writeBaiyingMergedConfig(api, next))).rejects.toBeInstanceOf(RuntimeUpdateDeferredError);

    expect(api.runtime.config.writeConfigFile).not.toHaveBeenCalled();
  });

  it("uses the current full config so replacements cannot silently remove plugin configuration", async () => {
    const api = createApi({ plugins: { entries: { "byai-channel": { enabled: true } } } });

    await expect(runRuntimeUpdateContext(() => writeBaiyingMergedConfig(api, { agents: { list: [] } }))).rejects.toBeInstanceOf(RuntimeUpdateDeferredError);

    expect(api.runtime.config.writeConfigFile).not.toHaveBeenCalled();
  });
});
