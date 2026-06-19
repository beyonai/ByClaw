import { describe, expect, it } from "vitest";
import { resolveConfigSyncHotPrefixes, resolveDigEmployeePubSub } from "../index.js";

describe("plugin reload config", () => {
  it("hot-reloads baiying plugin config and agents by default", () => {
    expect(resolveConfigSyncHotPrefixes({})).toEqual([
      "plugins.entries.baiying-enhance",
      "agents",
      "models",
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
      "models",
      "plugins.entries.byai-channel",
      "plugins.entries.minimax",
    ]);
  });
});

describe("dig employee Pub/Sub config", () => {
  it("subscribes by default unless explicitly disabled", () => {
    const prev = process.env.BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE;
    delete process.env.BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE;
    try {
      expect(resolveDigEmployeePubSub({}).subscribe).toBe(true);
      expect(resolveDigEmployeePubSub({ digEmployeeChangeSubscribe: false }).subscribe).toBe(false);
    } finally {
      if (prev === undefined) {
        delete process.env.BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE;
      } else {
        process.env.BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE = prev;
      }
    }
  });

  it("accepts the Python listener channel environment variable", () => {
    const prevA = process.env.BAIYING_DIG_EMPLOYEE_CHANGE_CHANNEL;
    const prevB = process.env.DIG_EMPLOYEE_PUBSUB_CHANNEL;
    delete process.env.BAIYING_DIG_EMPLOYEE_CHANGE_CHANNEL;
    process.env.DIG_EMPLOYEE_PUBSUB_CHANNEL = "custom:channel";
    try {
      expect(resolveDigEmployeePubSub({}).channel).toBe("custom:channel");
    } finally {
      if (prevA === undefined) {
        delete process.env.BAIYING_DIG_EMPLOYEE_CHANGE_CHANNEL;
      } else {
        process.env.BAIYING_DIG_EMPLOYEE_CHANGE_CHANNEL = prevA;
      }
      if (prevB === undefined) {
        delete process.env.DIG_EMPLOYEE_PUBSUB_CHANNEL;
      } else {
        process.env.DIG_EMPLOYEE_PUBSUB_CHANNEL = prevB;
      }
    }
  });
});
