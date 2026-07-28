import { describe, expect, it } from "vitest";
import { filterDelegableAgents } from "../src/delegable-agents.js";
import type { AgentProfile } from "../src/types.js";

function agent(id: string, code?: string): AgentProfile {
  return {
    id,
    ...(code ? { code } : {}),
    name: id,
    execution: { connectorId: "openclaw-by-framework", targetId: id },
  };
}

const CATALOG = [
  agent("self_main", "alice_main"),
  agent("finance", "finance"),
  agent("maintainer", "domain_maintain"),
  agent("mainframe", "mainframe"),
  agent("other_main", "bob_main"),
];

describe("filterDelegableAgents", () => {
  it("excludes the exact sourceAgentId by AgentProfile.id", () => {
    const result = filterDelegableAgents({
      agents: CATALOG,
      sourceAgentId: "finance",
    });
    expect(result.map((a) => a.id)).toEqual([
      "self_main",
      "maintainer",
      "mainframe",
      "other_main",
    ]);
  });

  it("falls back to {userCode}_main when sourceAgentId is absent", () => {
    const result = filterDelegableAgents({
      agents: CATALOG,
      principalUserCode: "alice",
    });
    // alice_main (self_main) 被排除；bob_main 不受影响
    expect(result.map((a) => a.id)).toEqual([
      "finance",
      "maintainer",
      "mainframe",
      "other_main",
    ]);
  });

  it("does NOT exclude agents whose code merely contains 'main'", () => {
    const result = filterDelegableAgents({
      agents: CATALOG,
      principalUserCode: "alice",
    });
    // domain_maintain / mainframe 都不是 alice_main，必须保留
    expect(result.some((a) => a.id === "maintainer")).toBe(true);
    expect(result.some((a) => a.id === "mainframe")).toBe(true);
  });

  it("unions sourceAgentId and {userCode}_main", () => {
    const result = filterDelegableAgents({
      agents: CATALOG,
      sourceAgentId: "finance",
      principalUserCode: "bob",
    });
    // 排除 finance（精确）+ bob_main（兜底）
    expect(result.map((a) => a.id)).toEqual([
      "self_main",
      "maintainer",
      "mainframe",
    ]);
  });

  it("returns empty array when only self is authorized", () => {
    const result = filterDelegableAgents({
      agents: [agent("only", "alice_main")],
      principalUserCode: "alice",
    });
    expect(result).toEqual([]);
  });

  it("returns a copy of the input when no filter is provided", () => {
    const result = filterDelegableAgents({ agents: CATALOG });
    expect(result.map((a) => a.id)).toEqual([
      "self_main",
      "finance",
      "maintainer",
      "mainframe",
      "other_main",
    ]);
    expect(result).not.toBe(CATALOG);
  });

  it("ignores blank sourceAgentId / principalUserCode", () => {
    const result = filterDelegableAgents({
      agents: CATALOG,
      sourceAgentId: "   ",
      principalUserCode: "  ",
    });
    expect(result.map((a) => a.id)).toEqual([
      "self_main",
      "finance",
      "maintainer",
      "mainframe",
      "other_main",
    ]);
  });

  it("sourceAgentId that matches nothing excludes nothing", () => {
    const result = filterDelegableAgents({
      agents: CATALOG,
      sourceAgentId: "ghost",
    });
    expect(result.map((a) => a.id)).toEqual([
      "self_main",
      "finance",
      "maintainer",
      "mainframe",
      "other_main",
    ]);
  });
});
