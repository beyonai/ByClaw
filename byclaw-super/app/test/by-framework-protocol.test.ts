import { describe, expect, it } from "vitest";
import { commandSourceAgentId } from "../worker/by-framework-protocol.js";

describe("commandSourceAgentId", () => {
  it("coerces a numeric agent_id to a string", () => {
    expect(
      commandSourceAgentId({ extraPayload: { agent_id: 123 } }),
    ).toBe("123");
  });

  it("trims a string agent_id", () => {
    expect(
      commandSourceAgentId({ extraPayload: { agent_id: "  self_main  " } }),
    ).toBe("self_main");
  });

  it("falls back to camelCase agentId", () => {
    expect(
      commandSourceAgentId({ extraPayload: { agentId: "self_main" } }),
    ).toBe("self_main");
  });

  it("matches case-insensitively", () => {
    expect(
      commandSourceAgentId({ extraPayload: { Agent_ID: "self_main" } }),
    ).toBe("self_main");
  });

  it("prefers agent_id over agentId", () => {
    expect(
      commandSourceAgentId({
        extraPayload: { agent_id: "first", agentId: "second" },
      }),
    ).toBe("first");
  });

  it("returns empty string when missing", () => {
    expect(commandSourceAgentId({ extraPayload: {} })).toBe("");
    expect(commandSourceAgentId({})).toBe("");
  });

  it("returns empty string for blank or non-scalar values", () => {
    expect(
      commandSourceAgentId({ extraPayload: { agent_id: "   " } }),
    ).toBe("");
    expect(
      commandSourceAgentId({ extraPayload: { agent_id: { x: 1 } } }),
    ).toBe("");
    expect(
      commandSourceAgentId({ extraPayload: { agent_id: null } }),
    ).toBe("");
  });
});
