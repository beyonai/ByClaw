import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

const REDIS_ENV_KEYS = new Set([
  "REDIS_HOST",
  "REDIS_PORT",
  "REDIS_USERNAME",
  "REDIS_PASSWORD",
  "REDIS_DATABASE",
  "USER_CODE",
  "DIG_EMPLOYEE_PUBSUB_CHANNEL",
  "BAIYING_DIG_EMPLOYEE_CHANGE_CHANNEL",
  "BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE",
  "BAIYING_DIG_CHANGE_SUBSCRIBE_STRICT_AUTH",
  "BAIYING_DIG_AUTH_POLL_MS",
  "BAIYING_DIG_AUTH_REDIS_CONNECT_TIMEOUT_MS",
  "BAIYING_DIG_AUTH_KEY_MISSING_GRACE_MS",
  "BAIYING_BACKEND_SD_DEFAULT_PATH_PREFIX",
  "BAIYING_WORKSPACE_ARCHIVE_BASE_URL",
]);

let loaded = false;

function parseDotenvValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadDotenvFile(filePath: string): number {
  if (!existsSync(filePath)) {
    return 0;
  }
  let count = 0;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    if (!REDIS_ENV_KEYS.has(key) || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = parseDotenvValue(trimmed.slice(idx + 1));
    count += 1;
  }
  return count;
}

function findUpDotenv(startDir: string): string[] {
  const out: string[] = [];
  let current = path.resolve(startDir);
  while (true) {
    out.push(path.join(current, ".env"));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return out;
}

export function loadBaiyingRedisEnvDefaults(params: { logger?: LoggerLike } = {}): void {
  if (loaded) {
    return;
  }
  loaded = true;
  const candidates = Array.from(
    new Set(
      [
        process.env.BAIYING_ENV_FILE?.trim(),
        ...findUpDotenv(process.cwd()),
        path.join(process.env.OPENCLAW_STATE_DIR?.trim() || path.join(homedir(), ".openclaw"), ".env"),
      ].filter((p): p is string => !!p),
    ),
  );
  let loadedCount = 0;
  for (const candidate of candidates) {
    try {
      loadedCount += loadDotenvFile(candidate);
    } catch (err) {
      params.logger?.warn?.(
        `baiying-enhance: failed to load Redis env defaults from ${candidate}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  if (loadedCount > 0) {
    params.logger?.info?.(`baiying-enhance: loaded ${loadedCount} Redis env default(s) from .env`);
  }
}
