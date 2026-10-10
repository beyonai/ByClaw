import { DomainError } from "./errors.js";
import { requireId } from "./values.js";

export const GROUP_COORDINATION_SCOPE = "group_coordination_scope";
export const GROUP_COORDINATOR_AGENT_ID = "group_coordinator_agent_id";

export interface GroupCoordination {
  schemaVersion: "byclaw.group-coordination/v1";
  mode: "COORDINATED" | "DIRECT";
  groupSessionId: string;
  taskSessionId: string;
  coordinatorAgentId: string;
  allowedAgentIds: string[];
}

/** The stored scope is authoritative for a task; text mentions never expand it. */
export function parseGroupCoordination(value: unknown): GroupCoordination | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  try {
    const scope = typeof value === "string" ? JSON.parse(value) : value;
    if (
      !scope ||
      typeof scope !== "object" ||
      scope.schemaVersion !== "byclaw.group-coordination/v1" ||
      !["COORDINATED", "DIRECT"].includes(scope.mode) ||
      !Array.isArray(scope.allowedAgentIds)
    )
      throw new Error("invalid scope");
    const allowedAgentIds = [...new Set<string>(scope.allowedAgentIds.map(requireId))];
    return {
      schemaVersion: "byclaw.group-coordination/v1",
      mode: scope.mode,
      groupSessionId: requireId(scope.groupSessionId),
      taskSessionId: requireId(scope.taskSessionId),
      coordinatorAgentId: requireId(scope.coordinatorAgentId),
      allowedAgentIds,
    };
  } catch {
    throw new DomainError("INVALID_GROUP_COORDINATION_SCOPE");
  }
}
