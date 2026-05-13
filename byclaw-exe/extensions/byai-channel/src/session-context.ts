import path from "node:path";
import { EmitOptions, EventType, type GatewayDataEmitter } from "@byclaw/by-framework";
import type { ByaiInboundMessage, Language } from "./types.js";

const CHANNEL_ID = "byai-channel" as const;
const DEFAULT_ACCOUNT_KEY = "default";
/** Must match `baiying-enhance/src/channel-session-resolve.ts` (read-only access to this store). */
const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_SESSION_CONTEXT_STORE__";

export const SESSION_FILES_ROOT = "/by/.sessions";

export function getSessionPathBySessionId(sessionId: string) {
  return path.posix.join(SESSION_FILES_ROOT, sessionId.trim());
}

export interface ByaiSdkSessionContext {
  accountId: string;
  sessionId: string;
  userId: string;
  traceId?: string;
  language: string;
}

export interface SharedChannelRequestContext {
  traceId: string;
  sessionKey: string;
  accountId: string;
  createdAt: number;
  fields: Record<string, unknown>;
}

export interface ActiveSdkRequest {
  accountId: string;
  sessionKey: string;
  to: string;
  sessionId: string;
  traceId: string;
  createdAt: number;
  boundRunIds: Set<string>;
  pendingChildSessionKeys: Set<string>;
  pendingOutboundCount: number;
  awaitingFollowup: boolean;
  deferredForFollowup: boolean;
  followupRunStarted: boolean;
  rootLifecyclePhase?: "end" | "error";
  lastReasoningText: string;
  lastReasoningMessageId: string;
  language: Language;
  /** Mirrors `ByaiSdkInboundMessage.languageProvided` (LANG env or metadata.language). */
  languageProvided: boolean;
  channelExtension?: Record<string, unknown> | string;
  abortController?: AbortController;
  beyondToken?: string;
}

interface ActiveSdkRunBinding {
  request: ActiveSdkRequest;
  sessionKey: string;
}

interface SessionContextStore {
  webhookContexts: Map<string, ByaiInboundMessage>;
  sdkEmitters: Map<string, GatewayDataEmitter>;
  channelRequestContextsBySessionKey: Map<string, SharedChannelRequestContext>;
  activeSdkRequestsByTarget: Map<string, ActiveSdkRequest>;
  activeSdkRequestsByTraceId: Map<string, ActiveSdkRequest>;
  activeSdkRequestsBySession: Map<string, ActiveSdkRequest>;
  activeSdkRequestsByChild: Map<string, ActiveSdkRequest>;
  activeSdkRequestsByRun: Map<string, ActiveSdkRunBinding>;
}

function getSessionContextStore(): SessionContextStore {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_KEY]?: SessionContextStore;
  };

  if (!globalStore[STORE_KEY]) {
    globalStore[STORE_KEY] = {
      webhookContexts: new Map<string, ByaiInboundMessage>(),
      sdkEmitters: new Map<string, GatewayDataEmitter>(),
      channelRequestContextsBySessionKey: new Map<string, SharedChannelRequestContext>(),
      activeSdkRequestsByTarget: new Map<string, ActiveSdkRequest>(),
      activeSdkRequestsByTraceId: new Map<string, ActiveSdkRequest>(),
      activeSdkRequestsBySession: new Map<string, ActiveSdkRequest>(),
      activeSdkRequestsByChild: new Map<string, ActiveSdkRequest>(),
      activeSdkRequestsByRun: new Map<string, ActiveSdkRunBinding>(),
    };
  }

  return globalStore[STORE_KEY];
}

const {
  webhookContexts,
  sdkEmitters,
  channelRequestContextsBySessionKey,
  activeSdkRequestsByTarget,
  activeSdkRequestsByTraceId,
  activeSdkRequestsBySession,
  activeSdkRequestsByChild,
  activeSdkRequestsByRun,
} = getSessionContextStore();

const sdkEmitterLastChunks = new WeakMap<GatewayDataEmitter, EmitOptions>();

function normalizeAlias(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeAccountId(value: string | undefined | null): string {
  return normalizeAlias(value) ?? DEFAULT_ACCOUNT_KEY;
}

function sanitizeSharedChannelFields(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  if (!fields) {
    return next;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

function buildContextAliases(params: {
  sessionId: string;
  userId: string;
}): string[] {
  const aliases = new Set<string>();
  const candidates = [
    params.sessionId,
    params.userId,
    `user:${params.sessionId}`,
    `user:${params.userId}`,
    `${CHANNEL_ID}:${params.sessionId}`,
    `${CHANNEL_ID}:${params.userId}`,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeAlias(candidate);
    if (normalized) {
      aliases.add(normalized);
    }
  }

  return [...aliases];
}

function buildSdkContextKey(accountId: string, alias: string): string {
  return `${normalizeAccountId(accountId)}::${alias}`;
}

function buildActiveSdkTargetKey(accountId: string, to: string): string {
  return `${normalizeAccountId(accountId)}::${to}`;
}

export function clearActiveSdkRequestRecord(request: ActiveSdkRequest): void {
  activeSdkRequestsByTarget.delete(buildActiveSdkTargetKey(request.accountId, request.to));
  activeSdkRequestsByTraceId.delete(request.traceId);
  channelRequestContextsBySessionKey.delete(request.sessionKey);
  activeSdkRequestsBySession.delete(request.sessionKey);
  for (const childSessionKey of request.pendingChildSessionKeys) {
    channelRequestContextsBySessionKey.delete(childSessionKey);
    activeSdkRequestsByChild.delete(childSessionKey);
  }
  for (const runId of request.boundRunIds) {
    activeSdkRequestsByRun.delete(runId);
  }
  request.boundRunIds.clear();
}

function pruneStaleActiveSdkRequests(now = Date.now()): void {
  // for (const request of activeSdkRequestsByTarget.values()) {
  //   if (now - request.createdAt > ACTIVE_SDK_REQUEST_TTL_MS) {
  //     clearActiveSdkRequestRecord(request);
  //   }
  // }
}

export function registerWebhookContext(message: ByaiInboundMessage): void {
  for (const alias of buildContextAliases(message)) {
    webhookContexts.set(alias, message);
  }
}

export function resolveWebhookContext(target: string): ByaiInboundMessage | undefined {
  const normalized = normalizeAlias(target);
  return normalized ? webhookContexts.get(normalized) : undefined;
}

export function registerSdkEmitter(accountId: string, emitter: GatewayDataEmitter): void {
  sdkEmitters.set(normalizeAccountId(accountId), emitter);
}

export function resolveSdkEmitter(accountId: string): GatewayDataEmitter | undefined {
  return sdkEmitters.get(normalizeAccountId(accountId));
}

export function getLastSdkEmitChunkByEmitter(
  emitter: GatewayDataEmitter | undefined,
) {
  if (!emitter) {
    return undefined;
  }
  return sdkEmitterLastChunks.get(emitter);
}

export function getLastSdkEmitChunk(accountId: string) {
  return getLastSdkEmitChunkByEmitter(resolveSdkEmitter(accountId));
}

export async function emitSdkChunkTracked(params: {
  emitter: GatewayDataEmitter | undefined;
  sessionId: string;
  traceId?: string;
  text: string;
  options?: EmitOptions;
}): Promise<void> {
  if (!params.emitter) {
    return;
  }
  await params.emitter.emitChunk(
    params.sessionId,
    params.traceId || "",
    params.text,
    params.options || {},
  );
  sdkEmitterLastChunks.set(params.emitter, {
    messageId: params.options?.messageId,
    parentMessageId: params.options?.parentMessageId,
    eventType: params.options?.eventType,
    contentType: params.options?.contentType,
  });
}

export function upsertChannelRequestContextBySessionKey(params: {
  sessionKey: string;
  accountId: string;
  traceId?: string;
  fields?: Record<string, unknown>;
  createdAt?: number;
}): SharedChannelRequestContext | undefined {
  const normalizedSessionKey = normalizeAlias(params.sessionKey);
  if (!normalizedSessionKey) {
    return undefined;
  }
  const existing = channelRequestContextsBySessionKey.get(normalizedSessionKey);
  const context: SharedChannelRequestContext = {
    traceId: normalizeAlias(params.traceId) ?? existing?.traceId ?? "",
    sessionKey: normalizedSessionKey,
    accountId: normalizeAccountId(params.accountId || existing?.accountId),
    createdAt: existing?.createdAt ?? params.createdAt ?? Date.now(),
    fields: {
      ...(existing?.fields ?? {}),
      ...sanitizeSharedChannelFields(params.fields),
    },
  };
  channelRequestContextsBySessionKey.set(normalizedSessionKey, context);
  return context;
}

export function resolveChannelRequestContextBySessionKey(
  sessionKey: string | undefined,
): SharedChannelRequestContext | undefined {
  const normalizedSessionKey = normalizeAlias(sessionKey);
  if (!normalizedSessionKey) {
    return undefined;
  }
  return channelRequestContextsBySessionKey.get(normalizedSessionKey);
}

export function registerActiveSdkRequest(params: {
  accountId: string;
  sessionKey: string;
  to: string;
  sessionId: string;
  traceId: string;
  language: Language;
  languageProvided: boolean;
  channelExtension?: Record<string, unknown> | string;
  abortController?: AbortController;
  beyondToken?: string;
}): ActiveSdkRequest {
  pruneStaleActiveSdkRequests();
  const existingByTarget = activeSdkRequestsByTarget.get(
    buildActiveSdkTargetKey(params.accountId, params.to),
  );
  if (existingByTarget) {
    clearActiveSdkRequestRecord(existingByTarget);
  }
  const existingBySession = activeSdkRequestsBySession.get(params.sessionKey);
  if (existingBySession) {
    clearActiveSdkRequestRecord(existingBySession);
  }
  const existingRequestByTraceId = activeSdkRequestsByTraceId.get(params.traceId);
  if (existingRequestByTraceId) {
    clearActiveSdkRequestRecord(existingRequestByTraceId);
  }
  const request: ActiveSdkRequest = {
    accountId: normalizeAccountId(params.accountId),
    sessionKey: params.sessionKey,
    to: params.to,
    sessionId: params.sessionId,
    traceId: params.traceId,
    createdAt: Date.now(),
    boundRunIds: new Set<string>(),
    pendingChildSessionKeys: new Set<string>(),
    pendingOutboundCount: 0,
    awaitingFollowup: false,
    deferredForFollowup: false,
    followupRunStarted: false,
    rootLifecyclePhase: undefined,
    lastReasoningText: "",
    lastReasoningMessageId: "",
    language: params.language,
    languageProvided: params.languageProvided,
    channelExtension: params.channelExtension,
    abortController: params.abortController,
    beyondToken: params.beyondToken,
  };

  activeSdkRequestsByTarget.set(
    buildActiveSdkTargetKey(request.accountId, request.to),
    request,
  );
  activeSdkRequestsByTraceId.set(request.traceId, request);
  activeSdkRequestsBySession.set(request.sessionKey, request);
  upsertChannelRequestContextBySessionKey({
    sessionKey: request.sessionKey,
    traceId: request.traceId,
    accountId: request.accountId,
    createdAt: request.createdAt,
    fields: {
      sessionId: request.sessionId,
      language: request.language,
      languageProvided: request.languageProvided,
      channelExtension: request.channelExtension,
      beyondToken: params.beyondToken,
    },
  });

  return request;
}

export function resolveActiveSdkRequestByTarget(
  accountId: string,
  to: string,
): ActiveSdkRequest | undefined {
  pruneStaleActiveSdkRequests();
  return activeSdkRequestsByTarget.get(buildActiveSdkTargetKey(accountId, to));
}

export function resolveActiveSdkRequestByTraceId(
  traceId: string | undefined,
): ActiveSdkRequest | undefined {
  const normalizedTraceId = normalizeAlias(traceId);
  if (!normalizedTraceId) {
    return undefined;
  }
  return activeSdkRequestsByTraceId.get(normalizedTraceId);
}

export function resolveActiveSdkRequestBySessionKey(
  sessionKey: string,
): ActiveSdkRequest | undefined {
  pruneStaleActiveSdkRequests();
  return activeSdkRequestsBySession.get(sessionKey) ?? activeSdkRequestsByChild.get(sessionKey);
}

export function bindActiveSdkRequestRunId(
  sessionKey: string | undefined,
  runId: string | undefined,
) {
  const normalizedSessionKey = normalizeAlias(sessionKey);
  const normalizedRunId = normalizeAlias(runId);
  if (!normalizedSessionKey || !normalizedRunId) {
    return false;
  }
  const request = resolveActiveSdkRequestBySessionKey(normalizedSessionKey);
  if (!request) {
    return false;
  }
  const existingBinding = activeSdkRequestsByRun.get(normalizedRunId);
  if (existingBinding && existingBinding.request !== request) {
    existingBinding.request.boundRunIds.delete(normalizedRunId);
  }
  request.boundRunIds.add(normalizedRunId);
  activeSdkRequestsByRun.set(normalizedRunId, {
    request,
    sessionKey: normalizedSessionKey,
  });
  return true;
}

export function resolveActiveSdkRunBinding(
  runId: string | undefined,
): ActiveSdkRunBinding | undefined {
  const normalizedRunId = normalizeAlias(runId);
  if (!normalizedRunId) {
    return undefined;
  }
  pruneStaleActiveSdkRequests();
  return activeSdkRequestsByRun.get(normalizedRunId);
}

export function isRootSessionKey(sessionKey?: string) {
  return !!sessionKey && !!activeSdkRequestsBySession.get(sessionKey);
}

export function isChildSessionKey(sessionKey?: string) {
  return !!sessionKey && !!activeSdkRequestsByChild.get(sessionKey);
}

export function clearActiveSdkRequestByTarget(accountId: string, to: string): void {
  const request = resolveActiveSdkRequestByTarget(accountId, to);
  if (!request) {
    return;
  }
  clearActiveSdkRequestRecord(request);
}

export function shouldDeferActiveSdkFinal(accountId: string, to: string): boolean {
  const request = resolveActiveSdkRequestByTarget(accountId, to);
  if (!request) {
    return false;
  }
  return (
    request.pendingChildSessionKeys.size > 0 ||
    request.awaitingFollowup ||
    request.followupRunStarted
  );
}

export function markActiveSdkRequestDeferred(
  accountId: string,
  to: string,
): ActiveSdkRequest | undefined {
  const request = resolveActiveSdkRequestByTarget(accountId, to);
  if (!request) {
    return undefined;
  }
  request.deferredForFollowup = true;
  request.lastReasoningText = "";
  request.lastReasoningMessageId = "";
  return request;
}

export function markActiveSdkRootLifecycleStarted(
  sessionKey: string | undefined,
): ActiveSdkRequest | undefined {
  if (!sessionKey || !isRootSessionKey(sessionKey)) {
    return undefined;
  }
  const request = resolveActiveSdkRequestBySessionKey(sessionKey);
  if (!request) {
    return undefined;
  }
  request.rootLifecyclePhase = undefined;
  if (request.awaitingFollowup) {
    request.awaitingFollowup = false;
    request.deferredForFollowup = true;
    request.followupRunStarted = true;
  }
  return request;
}

export function markActiveSdkRootLifecycleFinished(
  sessionKey: string | undefined,
  phase: "end" | "error",
): ActiveSdkRequest | undefined {
  if (!sessionKey || !isRootSessionKey(sessionKey)) {
    return undefined;
  }
  const request = resolveActiveSdkRequestBySessionKey(sessionKey);
  if (!request) {
    return undefined;
  }
  request.rootLifecyclePhase = phase;
  request.awaitingFollowup = false;
  request.followupRunStarted = false;
  return request;
}

export function markActiveSdkOutboundSending(
  accountId: string | undefined,
  to: string | undefined,
): ActiveSdkRequest | undefined {
  if (!to) {
    return undefined;
  }
  const request = resolveActiveSdkRequestByTarget(accountId ?? DEFAULT_ACCOUNT_KEY, to);
  if (!request) {
    return undefined;
  }
  request.pendingOutboundCount += 1;
  return request;
}

export function markActiveSdkOutboundSent(
  accountId: string | undefined,
  to: string | undefined,
): ActiveSdkRequest | undefined {
  if (!to) {
    return undefined;
  }
  const request = resolveActiveSdkRequestByTarget(accountId ?? DEFAULT_ACCOUNT_KEY, to);
  if (!request) {
    return undefined;
  }
  request.pendingOutboundCount = Math.max(0, request.pendingOutboundCount - 1);
  return request;
}

export function shouldCompleteActiveSdkRequest(request: ActiveSdkRequest): boolean {
  return Boolean(
    request.rootLifecyclePhase &&
      request.pendingChildSessionKeys.size === 0 &&
      request.pendingOutboundCount === 0 &&
      !request.awaitingFollowup &&
      !request.followupRunStarted,
  );
}

export async function completeActiveSdkRequest(
  request: ActiveSdkRequest | undefined,
): Promise<boolean> {
  if (!request) {
    return false;
  }
  const latest = resolveActiveSdkRequestBySessionKey(request.sessionKey);
  if (!latest || latest !== request) {
    return false;
  }
  if (!shouldCompleteActiveSdkRequest(latest)) {
    return false;
  }
  const sdkEmitter = resolveSdkEmitter(latest.accountId);
  if (!sdkEmitter) {
    throw new Error(`No active SDK emitter for account: ${latest.accountId}`);
  }
  await sdkEmitter.emitState(
    latest.sessionId,
    latest.traceId || "",
    "",
    {
      eventType: EventType.APP_STREAM_RESPONSE,
    },
  );
  clearActiveSdkRequestRecord(latest);
  return true;
}

export async function markActiveSdkRequestSubagentSpawned(
  requesterSessionKey: string,
  childSessionKey: string,
  agentId: string,
  runId: string,
) {
  if (!requesterSessionKey || !childSessionKey || !agentId) {
    return undefined;
  }
  const request = resolveActiveSdkRequestBySessionKey(requesterSessionKey);
  if (!request) {
    return undefined;
  }
  request.pendingChildSessionKeys.add(childSessionKey);
  request.rootLifecyclePhase = undefined;
  request.awaitingFollowup = false;
  request.deferredForFollowup = false;
  request.followupRunStarted = false;
  request.lastReasoningText = "";
  request.lastReasoningMessageId = "";
  activeSdkRequestsByChild.set(childSessionKey, request);
  upsertChannelRequestContextBySessionKey({
    sessionKey: childSessionKey,
    traceId: request.traceId,
    accountId: request.accountId,
    createdAt: request.createdAt,
    fields: {
      ...(channelRequestContextsBySessionKey.get(request.sessionKey)?.fields ?? {}),
    },
  });

  bindActiveSdkRequestRunId(childSessionKey, runId);
  return request;
}

export function markActiveSdkRequestSubagentEnded(
  childSessionKey: string | undefined,
): ActiveSdkRequest | undefined {
  if (!childSessionKey) {
    return undefined;
  }
  pruneStaleActiveSdkRequests();
  const request = activeSdkRequestsByChild.get(childSessionKey);
  if (!request) {
    return undefined;
  }
  request.pendingChildSessionKeys.delete(childSessionKey);
  channelRequestContextsBySessionKey.delete(childSessionKey);
  activeSdkRequestsByChild.delete(childSessionKey);
  if (request.pendingChildSessionKeys.size === 0) {
    request.awaitingFollowup = !request.rootLifecyclePhase;
    request.followupRunStarted = false;
    request.lastReasoningText = "";
    request.lastReasoningMessageId = "";
  }
  return request;
}

export function markActiveSdkFollowupRunStarted(
  sessionKey: string | undefined,
): ActiveSdkRequest | undefined {
  if (!sessionKey) {
    return undefined;
  }
  const request = resolveActiveSdkRequestBySessionKey(sessionKey);
  if (!request || !request.awaitingFollowup) {
    return undefined;
  }
  request.rootLifecyclePhase = undefined;
  request.awaitingFollowup = false;
  request.deferredForFollowup = true;
  request.followupRunStarted = true;
  request.lastReasoningText = "";
  request.lastReasoningMessageId = "";
  return request;
}

export async function completeActiveSdkFollowupBySessionKey(
  sessionKey: string | undefined,
): Promise<boolean> {
  if (!sessionKey) {
    return false;
  }
  const request = resolveActiveSdkRequestBySessionKey(sessionKey);
  if (!request || (!request.awaitingFollowup && !request.followupRunStarted && !request.deferredForFollowup)) {
    return false;
  }
  request.awaitingFollowup = false;
  request.followupRunStarted = false;
  request.rootLifecyclePhase = "end";
  return await completeActiveSdkRequest(request);
}
