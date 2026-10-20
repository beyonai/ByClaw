import { describe, expect, it } from "vitest";
import { classifyRuntimeConfigUpdate } from "./config-update-policy.js";

describe("classifyRuntimeConfigUpdate", () => {
  it("allows ordinary agent/model/skill changes and reports actual leaf paths", () => {
    const before = {
      agents: { list: [{ id: "main", skills: ["old"] }] },
      models: { providers: { managed: { baseUrl: "https://old.example.test", models: [{ id: "old" }] } } },
      skills: { entries: { old: { enabled: true } } },
    };
    const after = {
      agents: { list: [{ id: "main", skills: ["new"] }] },
      models: { providers: { managed: { baseUrl: "https://new.example.test", models: [{ id: "new" }] } } },
      skills: { entries: { old: { enabled: false } } },
      meta: { lastTouchedAt: "2026-10-20T00:00:00Z" },
    };

    expect(classifyRuntimeConfigUpdate({ before, after, runtimeVersion: "2026.7.1" })).toEqual({
      safe: true,
      changedPaths: [
        "agents.list",
        "meta.lastTouchedAt",
        "models.providers.managed.baseUrl",
        "models.providers.managed.models",
        "skills.entries.old.enabled",
      ],
    });
  });

  it.each(["hot", "hybrid", undefined])("accepts reload mode %s", (mode) => {
    const gateway = mode === undefined ? undefined : { reload: { mode } };
    expect(classifyRuntimeConfigUpdate({
      before: { gateway, agents: { list: [] } },
      after: { gateway, agents: { list: [{ id: "main" }] } },
    }).safe).toBe(true);
  });

  it.each(["off", "restart", "unknown", null, 0, ""])("defers reload mode %s", (mode) => {
    const gateway = { reload: { mode } };
    expect(classifyRuntimeConfigUpdate({
      before: { gateway, models: { mode: "merge" } },
      after: { gateway, models: { mode: "replace" } },
    })).toMatchObject({ safe: false, reason: "Gateway reload mode must be hot or hybrid" });
  });

  it.each(["2026.7.1", "2026.7.1-1", "2026.7.1-beta.1", "2026.7.1+build.abc"])("accepts audited version %s", (runtimeVersion) => {
    expect(classifyRuntimeConfigUpdate({ before: {}, after: { agents: { list: [] } }, runtimeVersion }).safe).toBe(true);
  });

  it.each(["unknown", "2026.7.10", "2026.7.2", "2026.8.1", "", "2026.7.1x"])("defers unaudited version %s", (runtimeVersion) => {
    expect(classifyRuntimeConfigUpdate({ before: {}, after: { agents: { list: [] } }, runtimeVersion })).toMatchObject({
      safe: false,
      reason: "OpenClaw runtime version has not been audited for safe updates",
    });
  });

  it("does not interpret lastTouchedVersion as the current runtime version", () => {
    expect(classifyRuntimeConfigUpdate({
      before: { meta: { lastTouchedVersion: "2026.7.1" } },
      after: { meta: { lastTouchedVersion: "2026.7.1" }, agents: { list: [] } },
      runtimeVersion: "unknown",
    }).safe).toBe(false);
  });

  it.each(["add", "edit", "delete"])("rejects pricing %s even when the models object is added or removed", (operation) => {
    const pricing = { models: { pricing: { enabled: true }, providers: {} } };
    const before = operation === "add" ? {} : pricing;
    const after = operation === "delete" ? {} : { models: { pricing: { enabled: false }, providers: {} } };
    expect(classifyRuntimeConfigUpdate({ before, after })).toMatchObject({ safe: false });
    expect(classifyRuntimeConfigUpdate({ before, after }).changedPaths).toContain("models.pricing.enabled");
  });

  it.each([
    { plugins: { entries: { "baiying-enhance": { config: { thinkingProviderIds: ["managed"] } } } } },
    { plugins: { entries: { zread: { config: { model: "managed/new" } } } } },
    { mcp: { servers: { managed: { command: "mcp" } } } },
    { channels: { "byai-channel": { enabled: true } } },
    { gateway: { reload: { mode: "hot" } } },
    { tools: { allow: ["exec"] } },
    { session: { scope: "per-sender" } },
    { secrets: { defaults: { exec: "managed" } } },
    { unknown: { field: true } },
  ])("rejects paths outside the ordinary update allowlist: %j", (change) => {
    expect(classifyRuntimeConfigUpdate({ before: {}, after: change }).safe).toBe(false);
  });

  it("does not let custom plugin hot prefixes bypass the allowlist", () => {
    const entry = { config: { configSyncHotPluginEntriesPrefixes: ["zread"] } };
    const before = { plugins: { entries: { "baiying-enhance": entry, zread: { config: { model: "old" } } } } };
    const after = { plugins: { entries: { "baiying-enhance": entry, zread: { config: { model: "new" } } } } };
    expect(classifyRuntimeConfigUpdate({ before, after })).toMatchObject({
      safe: false,
      changedPaths: ["plugins.entries.zread.config.model"],
    });
  });

  it("allows managed secret provider creation but rejects a mixed defaults change", () => {
    const provider = { source: "exec", command: "/managed/resolver", args: ["--json"] };
    expect(classifyRuntimeConfigUpdate({ before: {}, after: { secrets: { providers: { managed: provider } } } })).toEqual({
      safe: true,
      changedPaths: ["secrets.providers.managed.args", "secrets.providers.managed.command", "secrets.providers.managed.source"],
    });
    expect(classifyRuntimeConfigUpdate({
      before: {},
      after: { secrets: { providers: { managed: provider }, defaults: { exec: "managed" } } },
    }).safe).toBe(false);
  });

  it("rejects a mixed safe and unsafe update as one unit", () => {
    expect(classifyRuntimeConfigUpdate({
      before: {},
      after: { agents: { list: [{ id: "main" }] }, plugins: { entries: { "baiying-enhance": { enabled: true } } } },
    })).toMatchObject({
      safe: false,
      changedPaths: ["agents.list", "plugins.entries.baiying-enhance.enabled"],
    });
  });

  it("compares array values as whole paths, independent of object key order", () => {
    const before = { agents: { list: [{ id: "main", name: "Main" }] } };
    const after = { agents: { list: [{ name: "Main", id: "main" }] } };
    expect(classifyRuntimeConfigUpdate({ before, after })).toEqual({ safe: true, changedPaths: [] });
  });

  it("does not confuse similarly named prefixes with safe config paths", () => {
    expect(classifyRuntimeConfigUpdate({ before: {}, after: { modelsExtra: {} } }).safe).toBe(false);
    expect(classifyRuntimeConfigUpdate({ before: {}, after: { secrets: { providersExtra: {} } } }).safe).toBe(false);
  });

  it("matches actual object segments instead of interpreting dotted property names as config paths", () => {
    expect(classifyRuntimeConfigUpdate({ before: {}, after: { "agents.list": [] } }).safe).toBe(false);
    expect(classifyRuntimeConfigUpdate({ before: {}, after: { secrets: { "providers.managed": {} } } }).safe).toBe(false);
    expect(classifyRuntimeConfigUpdate({
      before: {},
      after: { models: { providers: { "provider.with.dots": { models: [] } } } },
    }).safe).toBe(true);
  });

  it.each([null, [], "invalid"])("rejects malformed root config %j", (after) => {
    expect(classifyRuntimeConfigUpdate({ before: {}, after }).safe).toBe(false);
  });

  it.each([null, [], "invalid"])("rejects malformed models object %j", (models) => {
    expect(classifyRuntimeConfigUpdate({ before: {}, after: { models } }).safe).toBe(false);
  });
});
