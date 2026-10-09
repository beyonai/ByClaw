import { describe, expect, it } from "vitest";
import { parseGroupCoordination } from "../src/domain/group-coordination.js";

describe("group coordination scope", () => {
  const scope = {
    schemaVersion: "byclaw.group-coordination/v1",
    mode: "COORDINATED",
    groupSessionId: "30",
    taskSessionId: "50",
    coordinatorAgentId: "90",
    allowedAgentIds: ["42", "43"],
  };

  it("round-trips the selected team without accepting an unversioned scope", () => {
    expect(parseGroupCoordination(JSON.stringify(scope))).toEqual(scope);
    expect(() => parseGroupCoordination({ ...scope, schemaVersion: "unknown" })).toThrow(
      "INVALID_GROUP_COORDINATION_SCOPE",
    );
  });

  it("rejects noncanonical agent IDs instead of silently widening the scope", () => {
    expect(() => parseGroupCoordination({ ...scope, allowedAgentIds: ["42", "0"] })).toThrow(
      "INVALID_GROUP_COORDINATION_SCOPE",
    );
  });
});
