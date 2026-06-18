import { describe, expect, it, vi } from "vitest";
import { mutateOpenClawConfigFile } from "./config-writer.js";

describe("mutateOpenClawConfigFile", () => {
  it("uses mutateConfigFile when available so writes are based on the full disk config", async () => {
    const diskConfig = {
      agents: { list: [{ id: "main" }] },
      models: { providers: {} },
      plugins: { entries: { "byai-channel": { enabled: true } } },
    };
    const api = {
      runtime: {
        config: {
          loadConfig: vi.fn(() => {
            throw new Error("deprecated load should not be used");
          }),
          writeConfigFile: vi.fn(async () => {
            throw new Error("Config write rejected");
          }),
          mutateConfigFile: vi.fn(async (mutator) => {
            await mutator(diskConfig);
          }),
        },
      },
    } as any;

    await mutateOpenClawConfigFile(api, (base) => {
      const next = structuredClone(base);
      next.models!.providers!["baiying-m-10000482"] = {
        api: "openai-completions",
        models: [{ id: "MiniMax-M3" }],
      };
      return next;
    });

    expect(api.runtime.config.mutateConfigFile).toHaveBeenCalledTimes(1);
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
        config: {
          loadConfig: vi.fn(() => diskConfig),
          writeConfigFile: vi.fn(async () => undefined),
        },
      },
    } as any;

    await mutateOpenClawConfigFile(api, (base) => ({
      ...base,
      agents: {
        ...base.agents,
        defaults: { model: { primary: "baiying-m-10000482/MiniMax-M3" } },
      },
    }));

    expect(api.runtime.config.loadConfig).toHaveBeenCalledTimes(1);
    expect(api.runtime.config.writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: expect.objectContaining({
          defaults: { model: { primary: "baiying-m-10000482/MiniMax-M3" } },
        }),
      }),
    );
  });
});
