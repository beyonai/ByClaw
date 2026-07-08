import type {
  ByclawAgentTeam,
  ByclawLoop,
  ByclawRegistrySnapshot,
  ByclawSkillResource,
  ByclawWorkflow,
  JsonRecord,
  NormalizedByclawAgent,
} from "./types.js";
import { RedisClient } from "./redis-client.js";
import type { RedisConnectionConfig } from "./types.js";
import { redactSensitiveJson } from "./redact.js";
import {
  DEFAULTS,
  ENV,
  MODEL_DEFAULTS,
  MODEL_PROVIDER_API,
  MODEL_PROVIDER_MARKERS,
  REDIS_KEYS,
} from "./constants.js";

const DEFAULT_CLAUDE_CODE_MODEL =
  process.env[ENV.byclawAcpClaudeModel] || process.env[ENV.anthropicModel] || DEFAULTS.claudeCodeModel;
const DEFAULT_AIMODEL_CONFIG_REDIS_KEY =
  process.env[ENV.byclawAcpAimodelConfigRedisKey] || REDIS_KEYS.aimodelConfig;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function readString(source: JsonRecord, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" || typeof item === "number" ? String(item) : ""))
    .filter(Boolean);
}

function deriveRoleFromName(name: string): string {
  const withoutBrand = name.replace(/^\s*ByClaw\s+/iu, "").trim();
  const candidate = withoutBrand || name.trim();
  return candidate
    .toLowerCase()
    .replace(/[/\\]+/g, " ")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function positiveInt(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function inferProviderApi(params: {
  baseUrl?: string;
  modelCode?: string;
  instanceParam?: JsonRecord;
}): string {
  const haystack = [
    params.baseUrl,
    params.modelCode,
    readString(params.instanceParam ?? {}, ["providerName", "modelProtocol"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    haystack.includes(MODEL_PROVIDER_MARKERS.anthropic) ||
    haystack.includes(MODEL_PROVIDER_MARKERS.claude)
  ) {
    return MODEL_PROVIDER_API.anthropicMessages;
  }
  if (haystack.includes(MODEL_PROVIDER_MARKERS.responses)) {
    return MODEL_PROVIDER_API.openaiResponses;
  }
  return MODEL_PROVIDER_API.openaiCompletions;
}

function providerKeyForBaiyingModelId(modelId: string): string {
  const normalized =
    modelId
      .trim()
      .replace(/^-/, "neg-")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || MODEL_DEFAULTS.unknownProviderKey;
  return `${MODEL_DEFAULTS.providerKeyPrefix}-${normalized}`;
}

function readRecord(source: JsonRecord, keys: string[]): JsonRecord | undefined {
  for (const key of keys) {
    const value = parseMaybeJson(source[key]);
    if (isRecord(value)) {
      return value;
    }
  }
  return undefined;
}

function stripRedisPrefix(key: string, prefix: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function extractModelInfo(raw: JsonRecord): JsonRecord {
  const prologue = parseMaybeJson(raw.prologue);
  const runtime = isRecord(raw.runtime) ? raw.runtime : {};
  const prologueRecord = isRecord(prologue) ? prologue : {};
  return (
    readRecord(runtime, ["modelInfo", "modelConfig", "llmConfig"]) ||
    readRecord(prologueRecord, ["modelInfo", "modelConfig", "llmConfig"]) ||
    readRecord(raw, ["modelInfo", "modelConfig", "llmConfig"]) ||
    {}
  );
}

function buildModelConfig(
  modelId: string,
  raw: JsonRecord | undefined,
  inlineModelInfo: JsonRecord,
): JsonRecord | undefined {
  if (!modelId && !raw && !Object.keys(inlineModelInfo).length) {
    return undefined;
  }
  const record = raw ?? {};
  const instanceParam = isRecord(record.instanceParam) ? record.instanceParam : {};
  const modelCode =
    readString(inlineModelInfo, ["modelCode", "modelName"]) ||
    readString(record, ["modelCode", "model", "modelId"], modelId);
  const modelName =
    readString(inlineModelInfo, ["model", "modelName", "displayName"]) ||
    readString(record, ["modelName", "name"], modelCode);
  const baseUrl =
    readString(inlineModelInfo, ["url", "baseUrl", "endpoint"]) ||
    readString(record, ["url", "baseUrl", "endpoint"]);
  const providerApi = inferProviderApi({ baseUrl, modelCode, instanceParam });
  const providerKey = providerKeyForBaiyingModelId(modelId || modelName || modelCode);
  const config: JsonRecord = {
    source: "redis-aimodel-config",
    ...(modelId ? { baiyingModelId: modelId } : {}),
    model: modelCode,
    modelCode,
    modelName,
    displayName: modelName,
    providerKey,
    modelRef: `${providerKey}/${modelCode}`,
    providerApi,
    ...(baseUrl ? { baseUrl, url: baseUrl } : {}),
    modelType: readString(record, ["modelType"], MODEL_DEFAULTS.type),
    ...(positiveInt(record.maxContentToken) ? { contextWindow: positiveInt(record.maxContentToken) } : {}),
    ...(positiveInt(inlineModelInfo.history) ? { history: positiveInt(inlineModelInfo.history) } : {}),
    ...(positiveInt(instanceParam.maxTokens) ? { maxTokens: positiveInt(instanceParam.maxTokens) } : {}),
    ...(isRecord(instanceParam.reasoningConfig) ? { reasoningConfig: instanceParam.reasoningConfig } : {}),
    requestDefaults: {
      ...(typeof inlineModelInfo.temperature === "string" && inlineModelInfo.temperature.trim()
        ? { temperature: Number(inlineModelInfo.temperature) }
        : typeof inlineModelInfo.temperature === "number"
          ? { temperature: inlineModelInfo.temperature }
          : typeof instanceParam.temperature === "number"
            ? { temperature: instanceParam.temperature }
            : {}),
      stream: true,
      ...(isRecord(instanceParam.reasoningConfig)
        ? { enable_thinking: Boolean(instanceParam.reasoningConfig.enabled) }
        : {}),
    },
    access: {
      present: Boolean(readString(record, ["authToken"])),
      ...(modelId ? { ref: `${DEFAULT_AIMODEL_CONFIG_REDIS_KEY}:${modelId}` } : {}),
    },
  };
  return redactSensitiveJson(config);
}

function extractBaiyingModelId(raw: JsonRecord): string {
  const prologue = parseMaybeJson(raw.prologue);
  const runtime = isRecord(raw.runtime) ? raw.runtime : {};
  const prologueRecord = isRecord(prologue) ? prologue : {};
  const modelInfo = extractModelInfo(raw);
  return (
    readString(runtime, ["baiyingModelId", "modelConfigId", "modelId"]) ||
    readString(raw, ["baiyingModelId", "modelConfigId", "modelId"]) ||
    readString(prologueRecord, ["modelId", "modelConfigId"]) ||
    readString(modelInfo, ["modelId", "modelConfigId", "instanceId"]) ||
    ""
  );
}

function normalizeSkill(redisKey: string, raw: JsonRecord): ByclawSkillResource {
  const id = readString(raw, ["resourceId", "id", "skillId"], stripRedisPrefix(redisKey, REDIS_KEYS.skillPrefix));
  return {
    id,
    redisKey,
    name: readString(raw, ["resourceName", "name", "skillName"], `Skill ${id}`),
    code: readString(raw, ["resourceCode", "skillCode", "code"], id),
    description: readString(raw, ["resourceDesc", "description", "desc"], ""),
    ...(readString(raw, ["skillPath", "path"]) ? { skillPath: readString(raw, ["skillPath", "path"]) } : {}),
    ...(readString(raw, ["skillDocObjectKey"]) ? { skillDocObjectKey: readString(raw, ["skillDocObjectKey"]) } : {}),
    ...(readString(raw, ["skillType", "resourceType"]) ? { skillType: readString(raw, ["skillType", "resourceType"]) } : {}),
    source: redactSensitiveJson(raw),
  };
}

function normalizeAgent(
  redisKey: string,
  raw: JsonRecord,
  modelConfigById: ReadonlyMap<string, JsonRecord>,
  skillById: ReadonlyMap<string, ByclawSkillResource>,
): NormalizedByclawAgent {
  const prologue = parseMaybeJson(raw.prologue);
  const runtime = isRecord(raw.runtime) ? raw.runtime : {};
  const prologueRecord = isRecord(prologue) ? prologue : {};
  const modelInfo = extractModelInfo(raw);
  const baiyingModelId = extractBaiyingModelId(raw);
  const modelConfig = buildModelConfig(baiyingModelId, modelConfigById.get(baiyingModelId), modelInfo);
  const id = readString(
    raw,
    ["resourceId", "id", "agentId"],
    stripRedisPrefix(redisKey, REDIS_KEYS.digitalEmployeePrefix),
  );
  const name = readString(raw, ["resourceName", "name", "agentName"], `ByClaw Agent ${id}`);
  const role =
    readString(raw, ["agentRole", "role", "roleCode"]) ||
    readString(prologueRecord, ["role", "agentRole"]) ||
    deriveRoleFromName(name) ||
    "digital-employee";
  const description =
    readString(raw, ["resourceDesc", "description", "desc"]) ||
    readString(prologueRecord, ["descText", "description", "background"], "");
  const model =
    readString(runtime, ["model", "modelRef"]) ||
    readString(modelInfo, ["model", "modelRef", "modelName", "modelCode"]) ||
    readString(prologueRecord, ["model", "modelRef"]) ||
    readString(modelConfig ?? {}, ["modelName", "model", "modelCode"]) ||
    baiyingModelId ||
    DEFAULT_CLAUDE_CODE_MODEL;
  const acpAgentId =
    readString(runtime, ["acpAgentId", "harnessAgentId"]) ||
    readString(raw, ["acpAgentId", "openclawAcpAgentId"], DEFAULTS.acpAgentId);
  const relIds = readStringArray(parseMaybeJson(raw.relIds));
  const linkedSkills = relIds.map((relId) => skillById.get(relId)).filter(Boolean) as ByclawSkillResource[];

  return {
    id,
    redisKey,
    name,
    role,
    description,
    model,
    ...(baiyingModelId ? { baiyingModelId } : {}),
    ...(modelConfig ? { modelConfig } : {}),
    acpAgentId,
    linkedSkills,
    source: redactSensitiveJson(raw),
  };
}

function normalizeTeam(redisKey: string, raw: JsonRecord): ByclawAgentTeam {
  const id = readString(raw, ["id", "teamId"], stripRedisPrefix(redisKey, REDIS_KEYS.teamPrefix));
  return {
    id,
    name: readString(raw, ["name", "teamName"], id),
    memberAgentIds: readStringArray(raw.memberAgentIds ?? raw.members),
    coordinatorAgentId: readString(raw, ["coordinatorAgentId", "leaderAgentId"], ""),
    source: redactSensitiveJson(raw),
  };
}

function normalizeWorkflow(redisKey: string, raw: JsonRecord): ByclawWorkflow {
  const id = readString(raw, ["id", "workflowId"], stripRedisPrefix(redisKey, REDIS_KEYS.workflowPrefix));
  const steps = Array.isArray(raw.steps)
    ? raw.steps
        .filter(isRecord)
        .map((step, index) => ({
          id: readString(step, ["id", "stepId"], `step-${index + 1}`),
          name: readString(step, ["name", "stepName"], `Step ${index + 1}`),
          agentId: readString(step, ["agentId", "employeeId"], ""),
          instruction: readString(step, ["instruction", "prompt", "task"], ""),
        }))
    : [];
  return {
    id,
    name: readString(raw, ["name", "workflowName"], id),
    teamId: readString(raw, ["teamId"], ""),
    steps,
    source: redactSensitiveJson(raw),
  };
}

function normalizeLoop(redisKey: string, raw: JsonRecord): ByclawLoop {
  const id = readString(raw, ["id", "loopId"], stripRedisPrefix(redisKey, REDIS_KEYS.loopPrefix));
  return {
    id,
    name: readString(raw, ["name", "loopName"], id),
    workflowId: readString(raw, ["workflowId"], ""),
    maxIterations: Math.max(1, Number(raw.maxIterations ?? raw.maxLoops ?? 3) || 3),
    exitCriteria: readStringArray(raw.exitCriteria),
    source: redactSensitiveJson(raw),
  };
}

async function readJsonRecords(client: RedisClient, pattern: string): Promise<Array<[string, JsonRecord]>> {
  const keys = (await client.keys(pattern)).sort();
  const values = await client.mget(keys);
  const records: Array<[string, JsonRecord]> = [];
  keys.forEach((key, index) => {
    const parsed = parseMaybeJson(values[index]);
    if (isRecord(parsed)) {
      records.push([key, parsed]);
    }
  });
  return records;
}

async function readAimodelConfigs(
  client: RedisClient,
  modelIds: Iterable<string>,
): Promise<Map<string, JsonRecord>> {
  const configs = new Map<string, JsonRecord>();
  await Promise.all(
    Array.from(new Set(Array.from(modelIds).filter(Boolean))).map(async (modelId) => {
      const raw = await client.hget(DEFAULT_AIMODEL_CONFIG_REDIS_KEY, modelId);
      const parsed = parseMaybeJson(raw);
      if (isRecord(parsed)) {
        configs.set(modelId, parsed);
      }
    }),
  );
  return configs;
}

export class ByclawRegistry {
  private readonly client: RedisClient;

  constructor(config: RedisConnectionConfig) {
    this.client = new RedisClient(config);
  }

  async snapshot(): Promise<ByclawRegistrySnapshot> {
    const [agentRows, skillRows, teamRows, workflowRows, loopRows] = await Promise.all([
      readJsonRecords(this.client, REDIS_KEYS.digitalEmployeePattern),
      readJsonRecords(this.client, REDIS_KEYS.skillPattern),
      readJsonRecords(this.client, REDIS_KEYS.teamPattern),
      readJsonRecords(this.client, REDIS_KEYS.workflowPattern),
      readJsonRecords(this.client, REDIS_KEYS.loopPattern),
    ]);
    const modelConfigById = await readAimodelConfigs(
      this.client,
      agentRows.map(([, raw]) => extractBaiyingModelId(raw)),
    );
    const skills = skillRows.map(([key, raw]) => normalizeSkill(key, raw));
    const skillById = new Map(skills.map((skill) => [skill.id, skill]));

    return {
      agents: agentRows.map(([key, raw]) => normalizeAgent(key, raw, modelConfigById, skillById)),
      skills,
      teams: teamRows.map(([key, raw]) => normalizeTeam(key, raw)),
      workflows: workflowRows.map(([key, raw]) => normalizeWorkflow(key, raw)),
      loops: loopRows.map(([key, raw]) => normalizeLoop(key, raw)),
    };
  }

  close(): void {
    this.client.close();
  }
}
