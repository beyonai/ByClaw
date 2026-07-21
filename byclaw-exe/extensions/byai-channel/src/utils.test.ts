import { describe, expect, it, vi } from "vitest";
import {
  appendIncrementalTextSnapshot,
  clearIncrementalTextSnapshot,
  emitIncrementalText,
} from "./utils.js";

vi.mock("openclaw/plugin-sdk/runtime-store", () => ({
  createPluginRuntimeStore: () => ({
    getRuntime: () => ({
      config: {
        loadConfig: () => ({ agents: { list: [] } }),
      },
    }),
    setRuntime: vi.fn(),
    tryGetRuntime: vi.fn(),
  }),
}));

vi.mock("../../shared/src/redis-compat.js", () => ({
  applyByFrameworkRedisKeyPatch: vi.fn(),
  byFrameworkRedisKeys: {
    sessionEventDataStream: () => "test-stream",
  },
  createRedisClient: vi.fn(),
  hasRedisConnectionConfig: () => false,
  readRedisConfig: () => ({
    mode: "standalone",
    clusterNodes: [],
    keySchemaVersion: "v1",
  }),
}));

describe("emitIncrementalText", () => {
  it("keeps cumulative snapshots isolated when runs are interleaved", async () => {
    const emitted: Record<string, string[]> = { runA: [], runB: [] };
    const runAKey = "utils-test-run-a:assistant:answer";
    const runBKey = "utils-test-run-b:assistant:answer";
    clearIncrementalTextSnapshot("utils-test-");

    await emitIncrementalText({
      key: runAKey,
      rawText: "初稿已写入工作区。",
      emit: async (text) => {
        emitted.runA.push(text);
      },
    });
    await emitIncrementalText({
      key: runBKey,
      rawText: "已",
      emit: async (text) => {
        emitted.runB.push(text);
      },
    });
    await emitIncrementalText({
      key: runAKey,
      rawText: "初稿已写入工作区。以下是正文：",
      emit: async (text) => {
        emitted.runA.push(text);
      },
    });

    expect(emitted.runA).toEqual(["初稿已写入工作区。", "以下是正文："]);
    expect(emitted.runB).toEqual(["已"]);
  });

  it("can clear all snapshots for a run prefix", async () => {
    const emitted: string[] = [];
    const key = "utils-test-clear-run:assistant:answer";
    clearIncrementalTextSnapshot("utils-test-clear-run:");

    await emitIncrementalText({
      key,
      rawText: "abc",
      emit: async (text) => {
        emitted.push(text);
      },
    });
    clearIncrementalTextSnapshot("utils-test-clear-run:");
    await emitIncrementalText({
      key,
      rawText: "abcd",
      emit: async (text) => {
        emitted.push(text);
      },
    });

    expect(emitted).toEqual(["abc", "abcd"]);
  });

  it("can track repeated explicit deltas without blocking later cumulative fallback", async () => {
    const emitted: string[] = [];
    const key = "utils-test-repeat-delta:assistant:answer";
    clearIncrementalTextSnapshot("utils-test-repeat-delta:");

    appendIncrementalTextSnapshot({ key, delta: "哈" });
    emitted.push("哈");
    appendIncrementalTextSnapshot({ key, delta: "哈" });
    emitted.push("哈");

    await emitIncrementalText({
      key,
      rawText: "哈哈哈",
      emit: async (text) => {
        emitted.push(text);
      },
    });

    expect(emitted).toEqual(["哈", "哈", "哈"]);
  });
});
