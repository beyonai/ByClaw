import type { AuthContext } from "./executor/auth.js";
import { getSharedRedisJsonStore } from "./redis-json-store.js";
import type { BaiyingEnhanceLogger } from "./executor/debug-channel.js";
import { isRecord } from "./executor/types.js";

const PRIVATE_PARAMS_KEY_PREFIX = "byai:user:private_params:";
const SHARE_USER_KEY_PREFIX = "SHARE_BFM_USER_";
const PRIVATE_ENV_RE = /\$\{privateEnv\.([A-Z_][A-Z0-9_]{0,127})\}/g;

let warnedMissingUserCode = false;

export type PrivateParamsRuntime = {
  userCode: string;
  version?: unknown;
  params: Record<string, string>;
};

export function privateParamsRedisKey(userCode: string): string {
  return `${PRIVATE_PARAMS_KEY_PREFIX}${userCode.trim()}`;
}

function envUserCode(): string {
  return (
    String(process.env.USER_CODE ?? "").trim() ||
    String(process.env.BAIYING_USER_CODE ?? "").trim()
  );
}

function extractUserCode(raw: unknown): string {
  if (!isRecord(raw)) {
    return "";
  }
  const direct =
    raw.userCode ??
    raw.user_code ??
    raw.usercode ??
    raw.code ??
    raw.loginCode ??
    raw.login_code;
  if (typeof direct === "string" || typeof direct === "number") {
    return String(direct).trim();
  }
  for (const value of Object.values(raw)) {
    if (!isRecord(value)) continue;
    const nested = extractUserCode(value);
    if (nested) return nested;
  }
  return "";
}

export async function resolvePrivateParamsUserCode(params: {
  authContext?: AuthContext;
  logger?: BaiyingEnhanceLogger;
}): Promise<string> {
  const userId = String(params.authContext?.userId ?? "").trim();
  if (userId) {
    const store = getSharedRedisJsonStore({ logger: params.logger });
    const payload = await store
      .getJsonByKey(`${SHARE_USER_KEY_PREFIX}${userId}`)
      .catch((err: unknown) => {
        params.logger?.warn?.(
          `baiying-enhance: private params user lookup failed userId=${userId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      });
    const userCode = extractUserCode(payload?.raw);
    if (userCode) {
      return userCode;
    }
  }

  const fallback = envUserCode();
  if (fallback) {
    return fallback;
  }

  if (!warnedMissingUserCode) {
    warnedMissingUserCode = true;
    params.logger?.warn?.("baiying-enhance: private params skipped; userCode not resolved");
  }
  return "";
}

export async function loadPrivateParamsRuntime(params: {
  authContext?: AuthContext;
  logger?: BaiyingEnhanceLogger;
}): Promise<PrivateParamsRuntime | null> {
  const userCode = await resolvePrivateParamsUserCode(params);
  if (!userCode) {
    return null;
  }

  const store = getSharedRedisJsonStore({ logger: params.logger });
  const payload = await store
    .getJsonByKey(privateParamsRedisKey(userCode))
    .catch((err: unknown) => {
      params.logger?.warn?.(
        `baiying-enhance: private params read failed userCode=${userCode}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    });
  if (!payload || !isRecord(payload.raw)) {
    return { userCode, params: {} };
  }

  const rawParams = isRecord(payload.raw.params) ? payload.raw.params : {};
  const runtimeParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === "string") {
      runtimeParams[key] = value;
    }
  }
  return {
    userCode,
    version: payload.raw.version,
    params: runtimeParams,
  };
}

function replacePrivateEnvString(value: string, params: Record<string, string>, logger?: BaiyingEnhanceLogger): string {
  return value.replace(PRIVATE_ENV_RE, (placeholder, key: string) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return params[key];
    }
    logger?.warn?.(`baiying-enhance: private param ${key} not found; keeping placeholder`);
    return placeholder;
  });
}

export function applyPrivateEnvPlaceholders<T>(
  value: T,
  params: Record<string, string> | undefined,
  logger?: BaiyingEnhanceLogger,
): T {
  if (!params) {
    return value;
  }
  if (typeof value === "string") {
    return replacePrivateEnvString(value, params, logger) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyPrivateEnvPlaceholders(item, params, logger)) as T;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = applyPrivateEnvPlaceholders(item, params, logger);
    }
    return out as T;
  }
  return value;
}

function redactPrivateValueString(value: string, params: Record<string, string>): string {
  let redacted = value;
  for (const privateValue of Object.values(params)) {
    if (privateValue && redacted.includes(privateValue)) {
      redacted = redacted.split(privateValue).join("***");
    }
  }
  return redacted;
}

export function redactPrivateParamValues<T>(value: T, params: Record<string, string> | undefined): T {
  if (!params || Object.keys(params).length === 0) {
    return value;
  }
  if (typeof value === "string") {
    return redactPrivateValueString(value, params) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactPrivateParamValues(item, params)) as T;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactPrivateParamValues(item, params);
    }
    return out as T;
  }
  return value;
}
