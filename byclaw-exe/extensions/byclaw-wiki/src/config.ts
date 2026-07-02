import path from "node:path";
import type {
  ByclawWikiPluginConfig,
  ResolvedByclawWikiConfig,
  ResolvedWikiRepositoryConfig,
  WikiRepositoryConfig,
} from "./types.js";
import {
  expandPath,
  resolveDataPath,
  resolveDefaultDataDir,
  resolveOpenClawStateDir,
  sanitizePathSegment,
} from "./paths.js";

const DEFAULT_REPOSITORY: WikiRepositoryConfig = {
  id: "byclaw",
  remoteUrl: "https://github.com/beyonai/ByClaw.git",
  branch: "develop",
};

export const byclawWikiConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    repositories: {
      type: "array",
      description: "Git repositories to mirror and index. Defaults to beyonai/ByClaw develop.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "remoteUrl", "branch"],
        properties: {
          id: { type: "string" },
          remoteUrl: { type: "string" },
          branch: { type: "string" },
          localPath: { type: "string" },
        },
      },
    },
    dataDir: {
      type: "string",
      description: "Plugin data directory. Defaults to OPENCLAW_STATE_DIR/byclaw-wiki.",
    },
    timezone: {
      type: "string",
      description: "IANA timezone for weekly sync.",
      default: "Asia/Shanghai",
    },
    syncDayOfWeek: {
      type: "number",
      description: "Scheduled sync day, where 0 is Sunday and 6 is Saturday.",
      default: 6,
    },
    syncHour: { type: "number", default: 3 },
    syncMinute: { type: "number", default: 0 },
    runOnStartup: { type: "boolean", default: true },
    toolName: { type: "string", default: "code_to_wiki" },
    httpPath: { type: "string", default: "/plugins/byclaw-wiki" },
    gitCommand: { type: "string", default: "git" },
    codegraphCommand: { type: "string", default: "codegraph" },
    commandTimeoutMs: { type: "number", default: 300000 },
    maxOutputBytes: { type: "number", default: 131072 },
    retryInitialDelayMs: {
      type: "number",
      description: "Initial retry delay after clone, pull, or index failure.",
      default: 300000,
    },
    retryMaxDelayMs: {
      type: "number",
      description: "Maximum exponential backoff retry delay.",
      default: 21600000,
    },
    retryMaxAttempts: {
      type: "number",
      description: "Maximum automatic retry attempts after a failed sync.",
      default: 3,
    },
    includeRawOutputInToolResult: {
      type: "boolean",
      description:
        "Whether code_to_wiki returns raw CodeGraph output to OpenClaw. Default true lets agents inspect source and generate documents.",
      default: true,
    },
    gitDepth: {
      type: "number",
      description: "Git clone/fetch depth. Default 1 keeps only the latest commit for faster sync.",
      default: 1,
    },
    notificationWebhookUrl: {
      type: "string",
      description: "Optional group robot webhook URL.",
    },
    notificationDingtalkAccessToken: {
      type: "string",
      description:
        "Optional DingTalk custom robot access token. Used to build the webhook URL when notificationWebhookUrl is not set.",
    },
    notificationDingtalkSecret: {
      type: "string",
      description: "Optional DingTalk robot SEC secret used to sign webhook requests.",
    },
    notificationDingtalkActionCardBtnTitle: {
      type: "string",
      description: "DingTalk ActionCard single button title.",
      default: "通过",
    },
    notificationDingtalkActionCardBtnUrl: {
      type: "string",
      description: "Optional DingTalk ActionCard button URL. Leave empty to send the card without a jump URL.",
      default: "",
    },
    notificationDocumentUploadUrl: {
      type: "string",
      description:
        "COS upload endpoint for generated operation documents. Relative paths resolve against BYCLAW_WIKI_COS_UPLOAD_BASE_URL or http://localhost:3000.",
      default: "/api/cos/upload",
    },
    notificationDocumentUploadPrefix: {
      type: "string",
      description: "Optional COS object prefix for generated operation documents.",
      default: "",
    },
    notificationRobotType: {
      enum: ["generic", "wecom", "dingtalk", "feishu"],
      description: "Group robot payload format.",
      default: "generic",
    },
    notificationMaxOutputChars: {
      type: "number",
      description: "Maximum CodeGraph output characters included in robot notification.",
      default: 3000,
    },
    notificationMinOutputChars: {
      type: "number",
      description: "Minimum output characters required before sending a notification.",
      default: 1,
    },
  },
} as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readIntegerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed === "number" && Number.isFinite(parsed)) {
    const integer = Math.trunc(parsed);
    if (integer >= min && integer <= max) {
      return integer;
    }
  }
  return fallback;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
    return Math.trunc(parsed);
  }
  return fallback;
}

function readNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0) {
    return Math.trunc(parsed);
  }
  return fallback;
}

function readRobotType(value: unknown): "generic" | "wecom" | "dingtalk" | "feishu" {
  const raw = readString(value, "generic");
  return raw === "wecom" || raw === "dingtalk" || raw === "feishu" ? raw : "generic";
}

function resolveConfiguredDataDir(value: unknown): string {
  const raw = readString(value, "");
  if (!raw) {
    return resolveDefaultDataDir();
  }
  if (raw.startsWith("~") || path.isAbsolute(raw)) {
    return expandPath(raw);
  }
  return path.join(resolveOpenClawStateDir(), raw);
}

function normalizeRepository(value: unknown): WikiRepositoryConfig | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const id = readString(value.id, "");
  const remoteUrl = readString(value.remoteUrl, "");
  const branch = readString(value.branch, "");
  if (!id || !remoteUrl || !branch) {
    return null;
  }
  return {
    id: sanitizePathSegment(id),
    remoteUrl,
    branch,
    localPath: readString(value.localPath, ""),
  };
}

function resolveRepositories(raw: unknown, dataDir: string): ResolvedWikiRepositoryConfig[] {
  const candidates = Array.isArray(raw) ? raw.map(normalizeRepository).filter(Boolean) : [];
  const repositories = candidates.length > 0 ? candidates : [DEFAULT_REPOSITORY];
  const seen = new Set<string>();
  return repositories.map((repository) => {
    const baseId = sanitizePathSegment(repository.id);
    let id = baseId;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${baseId}-${suffix++}`;
    }
    seen.add(id);

    const localPath = repository.localPath
      ? resolveDataPath(path.join(dataDir, "repos"), repository.localPath)
      : path.join(dataDir, "repos", id);

    return {
      id,
      remoteUrl: repository.remoteUrl,
      branch: repository.branch,
      localPath,
    };
  });
}

export function resolveByclawWikiConfig(raw: unknown): ResolvedByclawWikiConfig {
  const config = isPlainRecord(raw) ? (raw as ByclawWikiPluginConfig) : {};
  const dataDir = resolveConfiguredDataDir(config.dataDir);
  const repositories = resolveRepositories(config.repositories, dataDir);

  return {
    repositories,
    defaultRepositoryId: repositories[0]?.id ?? DEFAULT_REPOSITORY.id,
    dataDir,
    timezone: readString(config.timezone, "Asia/Shanghai"),
    syncDayOfWeek: readIntegerInRange(config.syncDayOfWeek, 6, 0, 6),
    syncHour: readIntegerInRange(config.syncHour, 3, 0, 23),
    syncMinute: readIntegerInRange(config.syncMinute, 0, 0, 59),
    runOnStartup: readBoolean(config.runOnStartup, true),
    toolName: readString(config.toolName, "code_to_wiki"),
    httpPath: readString(config.httpPath, "/plugins/byclaw-wiki"),
    gitCommand: readString(config.gitCommand, "git"),
    codegraphCommand: readString(config.codegraphCommand, "codegraph"),
    commandTimeoutMs: readPositiveInteger(config.commandTimeoutMs, 300000),
    maxOutputBytes: readPositiveInteger(config.maxOutputBytes, 128 * 1024),
    retryInitialDelayMs: readPositiveInteger(config.retryInitialDelayMs, 5 * 60 * 1000),
    retryMaxDelayMs: readPositiveInteger(config.retryMaxDelayMs, 6 * 60 * 60 * 1000),
    retryMaxAttempts: readPositiveInteger(config.retryMaxAttempts, 3),
    includeRawOutputInToolResult: readBoolean(config.includeRawOutputInToolResult, true),
    gitDepth: readPositiveInteger(config.gitDepth, 1),
    notification: {
      webhookUrl: readString(config.notificationWebhookUrl, "") || undefined,
      dingtalkAccessToken: readString(config.notificationDingtalkAccessToken, "") || undefined,
      dingtalkSecret: readString(config.notificationDingtalkSecret, "") || undefined,
      dingtalkActionCardBtnTitle: readString(
        config.notificationDingtalkActionCardBtnTitle,
        "通过",
      ),
      dingtalkActionCardBtnUrl: readString(
        config.notificationDingtalkActionCardBtnUrl,
        "",
      ),
      documentUploadUrl: readString(config.notificationDocumentUploadUrl, "/api/cos/upload"),
      documentUploadPrefix: readString(config.notificationDocumentUploadPrefix, ""),
      robotType: readRobotType(config.notificationRobotType),
      maxOutputChars: readPositiveInteger(config.notificationMaxOutputChars, 3000),
      minOutputChars: readNonNegativeInteger(config.notificationMinOutputChars, 1),
    },
  };
}
