import { describe, expect, it } from "vitest";
import { normalizeByaiAgentId, resolveSdkTargetAgentId } from "./session-key.js";

describe("normalizeByaiAgentId", () => {
  it("normalizes numeric Baiying agent ids from strings and numbers", () => {
    expect(normalizeByaiAgentId("10003355")).toBe("baiying-agent-10003355");
    expect(normalizeByaiAgentId(10003355)).toBe("baiying-agent-10003355");
  });

  it("keeps non-numeric agent ids trimmed and ignores unsupported values", () => {
    expect(normalizeByaiAgentId(" custom-agent ")).toBe("custom-agent");
    expect(normalizeByaiAgentId(null)).toBe("");
    expect(normalizeByaiAgentId({ id: "10003355" })).toBe("");
  });
});

describe("resolveSdkTargetAgentId", () => {
  it("accepts numeric agent_id values from gateway extra payload", () => {
    expect(resolveSdkTargetAgentId("main", { agent_id: 10003355 })).toBe(
      "baiying-agent-10003355",
    );
  });

  it("falls back to agent_code or routing agent id", () => {
    expect(resolveSdkTargetAgentId("main", { agent_code: " custom-agent " })).toBe(
      "custom-agent",
    );
    expect(resolveSdkTargetAgentId("main", {})).toBe("main");
  });
});
