import { isEnglishLanguage } from "./i18n";

type ToolEventData = {
  toolName?: string;
  args?: unknown;
};

const ARG_PRIORITY = [
  "path",
  "filePath",
  "url",
  "query",
  "command",
  "cmd",
  "script",
  "action",
  "operation",
  "message",
  "text",
  "prompt",
  "content",
  "name",
  "jobId",
  "sessionKey",
  "agentId",
  "node",
  "ref",
] as const;

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passwd|api[-_]?key|cookie|authorization|credential/i;

const MAX_VALUE_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();

    return normalized.length > MAX_VALUE_LENGTH
      ? `${normalized.slice(0, MAX_VALUE_LENGTH - 3)}...`
      : normalized;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 5).map(stringifyValue);

    return `[${items.join(", ")}${value.length > 5 ? ", ..." : ""}]`;
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .slice(0, 5)
      .map(([key, nestedValue]) => {
        const safeValue = SENSITIVE_KEY_PATTERN.test(key)
          ? "***"
          : stringifyValue(nestedValue);

        return `${key}=${safeValue}`;
      })
      .join(", ");
  }

  return "";
}

function formatArg(key: string, value: unknown): string {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return `${key}="***"`;
  }

  return stringifyValue(value);
  // return formattedValue ? `${key}=${formattedValue}` : "";
}

export function getToolCallUIDescription(data: ToolEventData): string {
  if (!isRecord(data?.args)) {
    return "";
  }

  const args = data.args;
  const displayedKeys = new Set<string>();

  const prioritizedArgs = ARG_PRIORITY
    .filter((key) => key in args)
    .map((key) => {
      displayedKeys.add(key);
      return formatArg(key, args[key]);
    })
    .filter(Boolean);

  if (prioritizedArgs.length > 0) {
    return prioritizedArgs[0].slice(0, MAX_DESCRIPTION_LENGTH);
  }

  const fallbackArgs = Object.entries(args)
    .filter(([key]) => !displayedKeys.has(key))
    .slice(0, 3)
    .map(([key, value]) => formatArg(key, value))
    .filter(Boolean);
  if (fallbackArgs.length > 0) {
    return fallbackArgs[0].slice(0, MAX_DESCRIPTION_LENGTH);
  }

  return "";
}
