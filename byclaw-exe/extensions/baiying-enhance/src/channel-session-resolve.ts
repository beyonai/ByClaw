/**
 * Resolve gateway/channel session id for `baiying_call` (per-request MCP X-Session-Id).
 *
 * Priority: explicit ctx fields → To/OriginatingTo `user:<id>` → byai-channel
 * in-process store (sessionKey / child) → none (executor may still use identity file).
 *
 * STORE_KEY must match `extensions/byai-channel/src/session-context.ts`.
 */

const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_SESSION_CONTEXT_STORE__";

const ACTIVE_SDK_REQUEST_TTL_MS = 15 * 60 * 1000;

export type ChannelSessionSource =
  | "ctx_channel_session_id"
  | "ctx_to"
  | "ctx_originating_to"
  | "active_session"
  | "child"
  | "none";

export interface ChannelSessionResolveResult {
  sessionId?: string;
  traceId?: string;
  source: ChannelSessionSource;
  language?: string;
  beyondToken?: string;
  parentSessionKey?: string;
}

export interface SharedChannelRequestContextLike {
  sessionKey?: string;
  traceId?: string;
  createdAt?: number;
  fields?: Record<string, unknown>;
}

interface ActiveSdkRequestLike {
  sessionKey?: string;
  sessionId?: string;
  traceId?: string;
  createdAt?: number;
}

interface SessionStoreLike {
  channelRequestContextsBySessionKey?: Map<string, SharedChannelRequestContextLike>;
  activeSdkRequestsBySession?: Map<string, ActiveSdkRequestLike>;
  activeSdkRequestsByChild?: Map<string, ActiveSdkRequestLike>;
}

function getOptionalStore(): SessionStoreLike | undefined {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: SessionStoreLike };
  return g[STORE_KEY];
}

function isFresh(request: ActiveSdkRequestLike | undefined, now: number): boolean {
  if (!request) {
    return false;
  }
  if (typeof request.createdAt !== "number") {
    return true;
  }
  return now - request.createdAt <= ACTIVE_SDK_REQUEST_TTL_MS;
}

/** Parse `user:<sessionId>` from channel-style addressing. */
export function parseUserPrefixedSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const t = value.trim();
  const m = /^user:(.+)$/i.exec(t);
  if (!m?.[1]) {
    return undefined;
  }
  const id = m[1].trim();
  return id || undefined;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function resolveChannelRequestContextBySessionKey(
  sessionKey: string | undefined,
): SharedChannelRequestContextLike | undefined {
  const normalizedSessionKey = normalizeText(sessionKey);
  if (!normalizedSessionKey) {
    return undefined;
  }
  const store = getOptionalStore();
  const context = store?.channelRequestContextsBySessionKey?.get(normalizedSessionKey);
  if (!isFresh(context, Date.now())) {
    return undefined;
  }
  return context;
}

function extractCommonFieldsFromSessionKey(
  sessionKey: string | undefined,
): Pick<ChannelSessionResolveResult, "language" | "beyondToken" | "traceId" | "sessionId" | "parentSessionKey"> {
  const context = resolveChannelRequestContextBySessionKey(sessionKey);
  if (!context) {
    return {};
  }
  const fields = asPlainRecord(context.fields);
  const beyondToken = normalizeText(fields?.beyondToken) ||
    normalizeText(fields?.beyond_token) ||
    normalizeText(fields?.["Beyond-Token"]) || undefined;
  const language =
    normalizeText(fields?.language) ||
    normalizeText(fields?.Language) ||
    undefined;
  const sessionIdFromFields = normalizeText(fields?.sessionId);
  const traceFromContext = normalizeText(context.traceId);
  return {
    language,
    beyondToken,
    parentSessionKey: fields?.requesterSessionKey as string | undefined,
    ...(sessionIdFromFields ? { sessionId: sessionIdFromFields } : {}),
    ...(traceFromContext ? { traceId: traceFromContext } : {}),
  };
}

function resolveFromGlobalStore(sessionKey: string): ChannelSessionResolveResult {
  const key = sessionKey.trim();
  if (!key) {
    return { source: "none" };
  }
  const store = getOptionalStore();
  if (!store?.activeSdkRequestsBySession) {
    return { source: "none" };
  }
  const now = Date.now();
  const bySession = store.activeSdkRequestsBySession.get(key);
  if (bySession && isFresh(bySession, now)) {
    const sid = typeof bySession.sessionId === "string" ? bySession.sessionId.trim() : "";
    if (sid) {
      const commonFields = extractCommonFieldsFromSessionKey(bySession.sessionKey || key);
      return {
        sessionId: sid,
        traceId: typeof bySession.traceId === "string" ? bySession.traceId.trim() : undefined,
        source: "active_session",
        ...commonFields,
      };
    }
  }
  const byChild = store.activeSdkRequestsByChild?.get(key);
  if (byChild && isFresh(byChild, now)) {
    const sid = typeof byChild.sessionId === "string" ? byChild.sessionId.trim() : "";
    if (sid) {
      const commonFields = extractCommonFieldsFromSessionKey(key);
      return {
        sessionId: sid,
        traceId: typeof byChild.traceId === "string" ? byChild.traceId.trim() : undefined,
        source: "child",
        ...commonFields,
      };
    }
  }
  return { source: "none" };
}

/**
 * Full resolution for one `baiying_call` execution.
 */
export function resolveChannelSessionIdForTool(ctx: unknown, sessionKey: string): ChannelSessionResolveResult {
  const c = ctx && typeof ctx === "object" ? (ctx as Record<string, unknown>) : {};

  const explicit =
    normalizeText(c.channelSessionId) ||
    normalizeText(c.ChannelSessionId) ||
    normalizeText(c.channel_session_id) ||
    normalizeText(c.gatewaySessionId);
  const explicitTraceId =
    normalizeText(c.channelTraceId) ||
    normalizeText(c.ChannelTraceId) ||
    normalizeText(c.channel_trace_id) ||
    normalizeText(c.gatewayTraceId) ||
    normalizeText(c.traceId) ||
    normalizeText(c.trace_id);
  const explicitLanguage = normalizeText(c.language) ||
    normalizeText(c.Language) ||
    normalizeText(c.ChannelLanguage);
  const explicitBeyondToken = normalizeText(c.ChannelBeyondToken) || normalizeText(c.BeyondToken);
  const commonFields = extractCommonFieldsFromSessionKey(sessionKey);

  const sessionId = explicit || commonFields.sessionId;
  if (sessionId) {
    return {
      sessionId,
      traceId: explicitTraceId || commonFields.traceId,
      source: "ctx_channel_session_id",
      language: explicitLanguage || commonFields.language,
      beyondToken: explicitBeyondToken || commonFields.beyondToken,
      parentSessionKey: commonFields.parentSessionKey,
    };
  }

  const fromTo = parseUserPrefixedSessionId(c.To);
  if (fromTo) {
    return { sessionId: fromTo, source: "ctx_to" };
  }
  const fromOrig = parseUserPrefixedSessionId(c.OriginatingTo);
  if (fromOrig) {
    return { sessionId: fromOrig, source: "ctx_originating_to" };
  }

  const fromStore = resolveFromGlobalStore(sessionKey);
  if (fromStore.sessionId) {
    return fromStore;
  }

  return { source: "none" };
}
