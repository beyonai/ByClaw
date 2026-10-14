import { afterEach, describe, expect, it } from "vitest";
import { bindRunModelSnapshot, getRunModelSnapshot, parseRunModelSnapshot, prepareSessionModelForDispatch, setSessionModelPreparer } from "../../shared/src/session-model-runtime.js";

const snapshot = {
  schemaVersion: 1, selectionMode: "auto", runId: "r1", modelId: "42", thinkingLevel: "medium", modelConfigVersion: "v1", policyVersion: "auto-v1",
} as const;

afterEach(() => {
  bindRunModelSnapshot("a", undefined);
  bindRunModelSnapshot("b", undefined);
  setSessionModelPreparer(undefined);
});

describe("Auto model runtime snapshots", () => {
  it("isolates sessions and removes completed snapshots", () => {
    bindRunModelSnapshot("a", snapshot);
    bindRunModelSnapshot("b", { ...snapshot, modelId: "43", runId: "r2" });
    expect(getRunModelSnapshot("a")?.modelId).toBe("42");
    expect(getRunModelSnapshot("b")?.modelId).toBe("43");
    bindRunModelSnapshot("a", undefined);
    expect(getRunModelSnapshot("a")).toBeUndefined();
    expect(getRunModelSnapshot("b")?.modelId).toBe("43");
  });

  it("rejects malformed snapshots and requires a provider preparer for Auto", async () => {
    expect(() => parseRunModelSnapshot({ ...snapshot, modelId: "-1" })).toThrow();
    expect(() => parseRunModelSnapshot({ ...snapshot, thinkingLevel: "unknown" })).toThrow();
    await expect(prepareSessionModelForDispatch("s", snapshot)).rejects.toThrow("unavailable");
    let modelId = "";
    setSessionModelPreparer(async (_sessionId, current) => { modelId = current?.modelId ?? ""; });
    await prepareSessionModelForDispatch("s", snapshot);
    expect(modelId).toBe("42");
  });
});
