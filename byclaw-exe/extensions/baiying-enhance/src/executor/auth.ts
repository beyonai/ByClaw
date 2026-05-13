import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Dict } from "./types.js";
import { isRecord } from "./types.js";
import { canonicalHeaderName } from "./resource-type.js";

export type AuthContext = {
  session: string;
  userId: string;
  headers: Record<string, string>;
};

const DEFAULT_AUTH_FILE = path.join(homedir(), ".openclaw", "workspace", "baiying-session.json");

export function resolveAuthFilePath(overridePath?: string): string {
  const trimmed = overridePath?.trim();
  if (!trimmed) {
    return DEFAULT_AUTH_FILE;
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("~")) {
    return path.join(homedir(), trimmed.slice(1));
  }
  return path.resolve(trimmed);
}

/** Mirror of `_load_auth_context`. Reads `~/.openclaw/workspace/baiying-session.json`. */
export async function loadAuthContext(authFilePath: string): Promise<AuthContext> {
  const empty: AuthContext = { session: "", userId: "", headers: {} };
  let raw: string;
  try {
    raw = await readFile(authFilePath, "utf8");
  } catch {
    return empty;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!isRecord(parsed)) {
    return empty;
  }

  const headersRaw = parsed.headers;
  const headers: Record<string, string> = {};
  if (isRecord(headersRaw)) {
    for (const [k, v] of Object.entries(headersRaw)) {
      if (typeof k !== "string") continue;
      const key = k.trim().toLowerCase();
      if (!key) continue;
      let value: string;
      if (Array.isArray(v)) {
        value = v.map((item) => String(item ?? "").trim()).filter(Boolean).join("; ");
      } else {
        value = v == null ? "" : String(v).trim();
      }
      if (value) {
        headers[key] = value;
      }
    }
  }
  return {
    session: typeof parsed.session === "string" ? parsed.session.trim() : "",
    userId: typeof parsed.user_id === "string" ? parsed.user_id.trim() : "",
    headers,
  };
}

/** Mirror of `_normalize_custom_headers`. Accepts raw value which can be a JSON string or object. */
export function normalizeCustomHeaders(rawHeaders: unknown): Record<string, string> {
  let value: unknown = rawHeaders;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return {};
    try {
      value = JSON.parse(text);
    } catch {
      return {};
    }
  }
  if (!isRecord(value)) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Dict)) {
    if (typeof k !== "string") continue;
    const headerName = k.trim();
    if (!headerName) continue;
    if (v == null) continue;
    const headerValue = String(v).trim();
    if (!headerValue) continue;
    headers[headerName] = headerValue;
  }
  return headers;
}

const EXCLUDED_AUTH_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
]);

type MergeAuthHeadersParams = {
  baseHeaders: Record<string, string>;
  authContext: AuthContext;
  session?: string;
  ensureSessionCookie?: boolean;
  ensureUserIdCookie?: boolean;
  extraHeaders?: Record<string, string>;
};

/**
 * Mirror of `_merge_auth_headers`.
 * Returns merged headers. `session` is the effective session id (from params or auth file).
 * `Authorization` / `Beyond-Token` from env are applied later by `applyEnvAuthOverrides` only when still unset.
 */
export function mergeAuthHeaders(params: MergeAuthHeadersParams): {
  headers: Record<string, string>;
  effectiveSession: string;
} {
  const headers: Record<string, string> = { ...params.baseHeaders };
  const auth = params.authContext;

  for (const [rawKey, rawVal] of Object.entries(auth.headers)) {
    if (typeof rawKey !== "string" || typeof rawVal !== "string") continue;
    const lowKey = rawKey.toLowerCase().trim();
    if (EXCLUDED_AUTH_HEADERS.has(lowKey)) continue;
    const canonical = canonicalHeaderName(lowKey);
    if (canonical === "Cookie") {
      headers[canonical] = rawVal;
      continue;
    }
    if (!(canonical in headers)) {
      headers[canonical] = rawVal;
    }
  }

  let effectiveSession = params.session || auth.session || "";
  const userIdFromFile = auth.userId;
  if (params.ensureSessionCookie !== false) {
    let cookie = (headers.Cookie ?? "").trim();
    if (effectiveSession && !cookie.includes("SESSION=")) {
      cookie = cookie ? `${cookie}; SESSION=${effectiveSession}` : `SESSION=${effectiveSession}`;
    }
    if (params.ensureUserIdCookie && userIdFromFile && !cookie.includes("currentUserId=")) {
      cookie = cookie
        ? `${cookie}; currentUserId=${userIdFromFile}`
        : `currentUserId=${userIdFromFile}`;
    }
    if (cookie) {
      headers.Cookie = cookie;
    }
  }

  if (params.extraHeaders) {
    for (const [k, v] of Object.entries(params.extraHeaders)) {
      if (k && v) {
        headers[canonicalHeaderName(k.toLowerCase())] = v;
      }
    }
  }

  return { headers, effectiveSession };
}

/** True if any header key matches `headerNameLower` (case-insensitive) with a non-empty value. */
export function hasNonEmptyHeader(
  headers: Record<string, string>,
  headerNameLower: string,
): boolean {
  const target = headerNameLower.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target && String(v).trim()) {
      return true;
    }
  }
  return false;
}

/**
 * Env fallback for non-DOC HTTP/SSE calls: only fills headers that are still missing
 * after resource snapshots / `baiying-session.json` merges (resource wins over env).
 *
 * Rules:
 * 1) `BAIYING_AGENT_AUTH` -> `Authorization` when not already set
 * 2) `Beyond-Token` / `BEYOND_TOKEN` -> `Beyond-Token` when not already set
 */
export function applyEnvAuthOverrides(headers: Record<string, string>): Record<string, string> {
  const envAuth = String(process.env.BAIYING_AGENT_AUTH ?? "").trim();
  if (envAuth && !hasNonEmptyHeader(headers, "authorization")) {
    headers.Authorization = envAuth;
  }

  const envBeyondToken = String(
    process.env["Beyond-Token"] ?? process.env.BEYOND_TOKEN ?? "",
  ).trim();
  if (envBeyondToken && !hasNonEmptyHeader(headers, "beyond-token")) {
    // HTTP header keys are case-insensitive. Emitting both `Beyond-Token` and
    // `beyond-token` can be merged by proxies/gateways into a comma-joined
    // value, which breaks JWT parsing (`... Found: 4 period characters`).
    // Keep a single canonical header and drop lower/variant duplicates.
    delete headers["beyond-token"];
    delete headers["BEYOND-TOKEN"];
    headers["Beyond-Token"] = envBeyondToken;
  }

  return headers;
}

/** Mirror of `_ensure_mcp_identity_headers`. Mutates and returns `headers`. */
export function ensureMcpIdentityHeaders(headers: Record<string, string>): Record<string, string> {
  const hasUser = Object.entries(headers).some(
    ([k, v]) => k.toLowerCase() === "x-user-id" && String(v).trim(),
  );
  if (!hasUser) {
    const user = String(process.env.USER_CODE ?? "").trim();
    if (user) {
      headers["X-User-Id"] = user;
    }
  }
  const hasSession = Object.entries(headers).some(
    ([k, v]) => k.toLowerCase() === "x-session-id" && String(v).trim(),
  );
  if (!hasSession) {
    const session = String(process.env.BAIYING_SESSION ?? "").trim();
    if (session) {
      headers["X-Session-Id"] = session;
    }
  }
  return headers;
}
