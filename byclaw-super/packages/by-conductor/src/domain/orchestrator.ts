export const ORCHESTRATOR_REF_SCHEMA_VERSION =
  "byclaw.orchestrator-ref/v1" as const;
export const ORCHESTRATOR_RUNTIME_SCHEMA_VERSION =
  "byclaw.orchestrator-runtime/v1" as const;

export const ORCHESTRATOR_KINDS = [
  "SUPER_ASSISTANT",
  "EXPERT_TEAM",
] as const;
export type OrchestratorKind = (typeof ORCHESTRATOR_KINDS)[number];

export const EXPERT_TEAM_CONTEXT_PROFILE =
  "EXPERT_TEAM_MINIMAL_V1" as const;

/** by-framework 入站只传递编排者定位，不把它当成授权结果。 */
export interface OrchestratorRefV1 {
  schemaVersion: typeof ORCHESTRATOR_REF_SCHEMA_VERSION;
  kind: OrchestratorKind;
  id: string;
}

/** BE 验权后冻结到 Run 的专家团运行时配置；不包含凭证和 Connector 信息。 */
export interface ExpertTeamRuntimeSnapshotV1 {
  schemaVersion: typeof ORCHESTRATOR_RUNTIME_SCHEMA_VERSION;
  kind: "EXPERT_TEAM";
  id: string;
  name: string;
  prompt: {
    content: string;
    version: string;
  };
  contextProfile: typeof EXPERT_TEAM_CONTEXT_PROFILE;
  configVersion: string;
}

export function parseOrchestratorRef(value: unknown): OrchestratorRefV1 {
  const record = requiredRecord(value, "orchestrator");
  if (record.schemaVersion !== ORCHESTRATOR_REF_SCHEMA_VERSION) {
    throw new Error(
      `orchestrator.schemaVersion must be ${ORCHESTRATOR_REF_SCHEMA_VERSION}`,
    );
  }
  if (!ORCHESTRATOR_KINDS.includes(record.kind as OrchestratorKind)) {
    throw new Error(
      `orchestrator.kind must be one of ${ORCHESTRATOR_KINDS.join(", ")}`,
    );
  }
  return {
    schemaVersion: ORCHESTRATOR_REF_SCHEMA_VERSION,
    kind: record.kind as OrchestratorKind,
    id: requiredString(record.id, "orchestrator.id", 512),
  };
}

export function parseExpertTeamRuntimeSnapshot(
  value: unknown,
): ExpertTeamRuntimeSnapshotV1 {
  const record = requiredRecord(value, "expert team runtime");
  if (record.schemaVersion !== ORCHESTRATOR_RUNTIME_SCHEMA_VERSION) {
    throw new Error(
      `expert team runtime schemaVersion must be ${ORCHESTRATOR_RUNTIME_SCHEMA_VERSION}`,
    );
  }
  if (record.kind !== "EXPERT_TEAM") {
    throw new Error("expert team runtime kind must be EXPERT_TEAM");
  }
  if (record.contextProfile !== EXPERT_TEAM_CONTEXT_PROFILE) {
    throw new Error(
      `expert team runtime contextProfile must be ${EXPERT_TEAM_CONTEXT_PROFILE}`,
    );
  }
  const prompt = requiredRecord(record.prompt, "expert team runtime prompt");
  return {
    schemaVersion: ORCHESTRATOR_RUNTIME_SCHEMA_VERSION,
    kind: "EXPERT_TEAM",
    id: requiredString(record.id, "expert team runtime id", 512),
    name: requiredString(record.name, "expert team runtime name", 512),
    prompt: {
      content: requiredString(
        prompt.content,
        "expert team runtime prompt.content",
        100_000,
      ),
      version: requiredString(
        prompt.version,
        "expert team runtime prompt.version",
        256,
      ),
    },
    contextProfile: EXPERT_TEAM_CONTEXT_PROFILE,
    configVersion: requiredString(
      record.configVersion,
      "expert team runtime configVersion",
      256,
    ),
  };
}

function requiredRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string, maxLength: number): string {
  const normalized =
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${name} exceeds ${maxLength} characters`);
  }
  return normalized;
}
