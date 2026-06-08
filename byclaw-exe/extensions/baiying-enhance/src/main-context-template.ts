import type { BaiyingRedisJsonStore, RedisJsonPayload } from "./redis-json-store.js";

export const DEFAULT_MAIN_CONTEXT_TEMPLATE_REDIS_KEY = "byai:SystemConfig:paramCode";
export const DEFAULT_MAIN_CONTEXT_TEMPLATE_PARAM_CODE =
  "OPENCLAW_AGENT_CONTEXT_TEMPLATE_SUPER_ASSISTANT";

export type MainWorkspaceContextWritePolicy =
  | "off"
  | "if_missing"
  | "if_managed_marker"
  | "always";

export type MainWorkspaceContextMergeStrategy = "append" | "replace";

export type MainWorkspaceContextFileName =
  | "AGENTS.md"
  | "SOUL.md"
  | "IDENTITY.md"
  | "USER.md"
  | "TOOLS.md";

export type MainWorkspaceContextFileConfig = {
  enabled?: boolean;
  priorityPrompt: string;
  mergeStrategy?: MainWorkspaceContextMergeStrategy;
};

export type MainWorkspaceContextTemplate = {
  writePolicy?: MainWorkspaceContextWritePolicy;
  files: Partial<Record<MainWorkspaceContextFileName, MainWorkspaceContextFileConfig>>;
};

type LoggerLike = {
  warn?: (message: string) => void;
};

const MAIN_CONTEXT_FILE_NAMES = new Set<MainWorkspaceContextFileName>([
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeWritePolicy(raw: unknown): MainWorkspaceContextWritePolicy | undefined {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value === "off" ||
    value === "if_missing" ||
    value === "if_managed_marker" ||
    value === "always"
    ? value
    : undefined;
}

function normalizeMergeStrategy(raw: unknown): MainWorkspaceContextMergeStrategy | undefined {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "append") {
    return "append";
  }
  if (value === "replace" || value === "overwrite" || value === "override" || value === "full") {
    return "replace";
  }
  return undefined;
}

function normalizeTemplateRoot(raw: unknown): Record<string, unknown> | null {
  // Redis 系统配置缓存通常是 ByaiSystemConfig 外层 JSON，模板在 paramValue 字符串里。
  if (isRecord(raw)) {
    const paramValue =
      typeof raw.paramValue === "string"
        ? raw.paramValue
        : typeof raw.param_value === "string"
          ? raw.param_value
          : "";
    if (paramValue.trim()) {
      return parseJsonObject(paramValue);
    }
    return raw;
  }
  // 兼容 field 值直接是 JSON 字符串的场景，便于本地调试或手工写 Redis。
  if (typeof raw === "string" && raw.trim()) {
    return parseJsonObject(raw);
  }
  return null;
}

function normalizeSchemaVersion(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return raw;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  return null;
}

export function resolveMainContextTemplateRedisKey(raw?: string): string {
  return raw?.trim() || DEFAULT_MAIN_CONTEXT_TEMPLATE_REDIS_KEY;
}

export function resolveMainContextTemplateParamCode(raw?: string): string {
  return raw?.trim() || DEFAULT_MAIN_CONTEXT_TEMPLATE_PARAM_CODE;
}

export function parseMainWorkspaceContextTemplate(
  payload: RedisJsonPayload | null,
  params: { log?: LoggerLike; label?: string } = {},
): MainWorkspaceContextTemplate | null {
  if (!payload) {
    return null;
  }
  const label = params.label ?? payload.key;
  const root = normalizeTemplateRoot(payload.raw);
  if (!root) {
    params.log?.warn?.(`baiying-enhance: main context template invalid JSON (${label})`);
    return null;
  }

  if (root.templateType !== "agentContext" || root.scope !== "mainWorkspace") {
    params.log?.warn?.(`baiying-enhance: main context template ignored (type/scope mismatch: ${label})`);
    return null;
  }

  const schemaVersion = normalizeSchemaVersion(root.schemaVersion);
  if (schemaVersion !== 1) {
    params.log?.warn?.(`baiying-enhance: main context template ignored (schemaVersion mismatch: ${label})`);
    return null;
  }

  // 新配置推荐使用 files；同时兼容已有文档形态里的 relPrompt，方便从 agentRole 配置平滑迁移。
  const filesRaw = isRecord(root.files) ? root.files : isRecord(root.relPrompt) ? root.relPrompt : {};
  const files: MainWorkspaceContextTemplate["files"] = {};
  for (const [filename, value] of Object.entries(filesRaw)) {
    if (!MAIN_CONTEXT_FILE_NAMES.has(filename as MainWorkspaceContextFileName)) {
      continue;
    }
    if (!isRecord(value) || value.enabled === false) {
      continue;
    }
    const priorityPrompt = typeof value.priorityPrompt === "string" ? value.priorityPrompt.trim() : "";
    if (!priorityPrompt) {
      continue;
    }
    files[filename as MainWorkspaceContextFileName] = {
      enabled: true,
      priorityPrompt,
      mergeStrategy: normalizeMergeStrategy(
        value.mergeStrategy ?? value.mergeMode ?? value.writeStrategy ?? value.strategy,
      ),
    };
  }

  return {
    writePolicy: normalizeWritePolicy(root.writePolicy),
    files,
  };
}

export async function loadMainWorkspaceContextTemplate(params: {
  redisJsonStore?: BaiyingRedisJsonStore;
  redisKey?: string;
  paramCode?: string;
  log?: LoggerLike;
}): Promise<MainWorkspaceContextTemplate | null> {
  if (!params.redisJsonStore?.getHashJson) {
    return null;
  }
  const redisKey = resolveMainContextTemplateRedisKey(params.redisKey);
  const paramCode = resolveMainContextTemplateParamCode(params.paramCode);
  try {
    const payload = await params.redisJsonStore.getHashJson({ key: redisKey, field: paramCode });
    return parseMainWorkspaceContextTemplate(payload, {
      log: params.log,
      label: `${redisKey}:${paramCode}`,
    });
  } catch (err) {
    params.log?.warn?.(
      `baiying-enhance: main context template read failed key=${redisKey} field=${paramCode}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
