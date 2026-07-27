import { describe, expect, it } from "vitest";
import {
  DELEGATE_AGENT_TOOL_NAME,
  resolveActiveLeaderToolNames,
} from "../src/context/active-leader-tools.js";
import type { AgentProfile } from "../src/types.js";

const analyst: AgentProfile = {
  id: "1001",
  name: "Analyst",
  execution: {
    connectorId: "fake",
    targetId: "1001",
  },
};

describe("resolveActiveLeaderToolNames", () => {
  it("exposes no Leader tools when no Agent is authorized and Ask User is disabled", () => {
    expect(resolveActiveLeaderToolNames([])).toEqual([]);
  });

  it("only enables delegation when at least one Agent is authorized", () => {
    expect(resolveActiveLeaderToolNames([analyst])).toEqual([
      DELEGATE_AGENT_TOOL_NAME,
    ]);
  });

  it("recomputes the tool set independently for consecutive Runs", () => {
    expect(resolveActiveLeaderToolNames([analyst])).toContain(
      DELEGATE_AGENT_TOOL_NAME,
    );
    expect(resolveActiveLeaderToolNames([])).not.toContain(
      DELEGATE_AGENT_TOOL_NAME,
    );
    expect(resolveActiveLeaderToolNames([analyst])).toContain(
      DELEGATE_AGENT_TOOL_NAME,
    );
  });
});
