export type JsonRecord = Record<string, unknown>;

export type RedisConnectionConfig = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  database: number;
  keyPrefix: string;
  connectTimeoutMs: number;
};

export type ResolvedByclawAcpAdapterConfig = {
  defaultAcpAgentId: string;
  defaultAcpClientType: string;
  defaultCwd: string;
  sqlitePath: string;
  httpPathPrefix: string;
  redis: RedisConnectionConfig;
  toolNames: {
    plan: string;
    run: string;
  };
};

export type NormalizedByclawAgent = {
  id: string;
  redisKey: string;
  name: string;
  role: string;
  description: string;
  model: string;
  baiyingModelId?: string;
  modelConfig?: JsonRecord;
  acpAgentId: string;
  linkedSkills: ByclawSkillResource[];
  source: JsonRecord;
};

export type ByclawSkillResource = {
  id: string;
  redisKey: string;
  name: string;
  code: string;
  description: string;
  skillPath?: string;
  skillDocObjectKey?: string;
  skillType?: string;
  source: JsonRecord;
};

export type ByclawAgentTeam = {
  id: string;
  name: string;
  memberAgentIds: string[];
  coordinatorAgentId?: string;
  source: JsonRecord;
};

export type ByclawWorkflow = {
  id: string;
  name: string;
  teamId: string;
  steps: Array<{ id: string; name: string; agentId: string; instruction: string }>;
  source: JsonRecord;
};

export type ByclawLoop = {
  id: string;
  name: string;
  workflowId: string;
  maxIterations: number;
  exitCriteria: string[];
  source: JsonRecord;
};

export type ByclawRegistrySnapshot = {
  agents: NormalizedByclawAgent[];
  skills: ByclawSkillResource[];
  teams: ByclawAgentTeam[];
  workflows: ByclawWorkflow[];
  loops: ByclawLoop[];
};

export type ByclawAcpPlanRequest = {
  kind?: "agent" | "team" | "workflow" | "loop";
  id?: string;
  input?: unknown;
  model?: string;
  cwd?: string;
  acpAgentId?: string;
  acpClientType?: string;
  sessionId?: string;
  language?: string;
  replyLanguage?: string;
  languageProvided?: boolean;
};

export type ByclawAcpPlan = {
  kind: "agent" | "team" | "workflow" | "loop";
  id: string;
  name: string;
  acpAgentId: string;
  model: string;
  cwd: string;
  replyLanguage: string;
  languageProvided: boolean;
  sessionsSpawn: JsonRecord;
  task: string;
  metadata: JsonRecord;
};

export type ByclawAcpRunRecord = {
  runId: string;
  pipelineRunId?: string;
  kind: string;
  byclawId: string;
  status: string;
  plan: ByclawAcpPlan;
  input: unknown;
  createdAtMs: number;
  updatedAtMs: number;
  endedAtMs?: number;
  error?: string;
};
