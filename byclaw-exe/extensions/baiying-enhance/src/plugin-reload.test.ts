import { describe, expect, it } from "vitest";
import { resolveConfigSyncHotPrefixes } from "../index.js";

describe("plugin reload config", () => {
  it("hot-reloads baiying plugin config and agents by default", () => {
    expect(resolveConfigSyncHotPrefixes({})).toEqual([
      "plugins.entries.baiying-enhance",
      "agents",
    ]);
  });

  it("keeps extra plugin hot prefixes", () => {
    expect(
      resolveConfigSyncHotPrefixes({
        configSyncHotPluginEntriesPrefixes: ["byai-channel", "plugins.entries.minimax"],
      }),
    ).toEqual([
      "plugins.entries.baiying-enhance",
      "agents",
      "plugins.entries.byai-channel",
      "plugins.entries.minimax",
    ]);
  });
});
