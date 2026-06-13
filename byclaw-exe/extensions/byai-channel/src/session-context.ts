import path from "node:path";
import { EmitOptions, EventType, type GatewayDataEmitter } from "@byclaw/by-framework";
import type { ByaiInboundMessage, Language } from "./types.js";
import { isSessionDispatchBusy } from "./session-dispatch-gate.js";
import { clearPendingMessageToolSends } from "./pending-message-tool.js";

const CHANNEL_ID = "byai-channel" as const;
const DEFAULT_ACCOUNT_KEY = "default";
/** Must match `baiying-enhance/src/channel-session-resolve.ts` (read-only access to this store). */
const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_SESSION_CONTEXT_STORE__";

export const SESSION_FILES_ROOT = "/by/.sessions";

export function getSessionPathBySessionId(sessionId: string) {
  return path.posix.join(SESSION_FILES_ROOT, sessionId.trim());
}

export function resolveSdkLocalFilePath(rawPath: string, sessionId: string): string {
  const sessionRoot = getSessionPathBySessionId(sessionId);
  if (!path.posix.isAbsolute(rawPath)) {
    return path.posix.resolve(sessionRoot, rawPath);
  }

  const normalizedRawPath = path.posix.normalize(rawPath);
  const normalizedSessionRoot = path.posix.normalize(sessionRoot);
  if (
    normalizedRawPath === normalizedSessionRoot ||
    normalizedRawPath.startsWith(`${normalizedSessionRoot}/`)
  ) {
    return normalizedRawPath;
  }

  for (let start = 0; start < normalizedSessionRoot.length; start += 1) {
    const overlap = normalizedSessionRoot.slice(start);
    if (
      overlap.length <= 1 ||
      (normalizedRawPath !== overlap && !normalizedRawPath.startsWith(`${overlap}/`))
    ) {
      continue;
    }
    return `${normalizedSessionRoot.slice(0, start)}${normalizedRawPath}`;
  }

  return normalizedRawPath;
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
  /**
   * 置 awaitingFollowup=true 的时间戳（epoch ms）。subagent 结束后正常情况下 main 会被
   * direct-path announce 重新唤醒（新 lifecycle start，数秒内）；但 direct+steer 都失败或
   * 子 agent error 时 main 不会重启，awaitingFollowup 会永久挂住完成门。用它做短超时兜底。
   */
  awaitingFollowupSince?: number;
  deferredForFollowup: boolean;
  followupRunStarted: boolean;
  compactionRetryPending: boolean;
  modelFallbackPending: boolean;
  rootLifecyclePhase?: "end" | "error";
  hasEmittedContent: boolean;
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

const sdkEmitterLastChunks = new Map<string, EmitOptions & { traceId: string }>();

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
  clearPendingMessageToolSends(request.sessionKey);
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

export function getLastSdkEmitChunk(sessionId: string | number) {
  return sdkEmitterLastChunks.get(`${sessionId}`);
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
  sdkEmitterLastChunks.set(`${params.sessionId}`, {
    traceId: params.traceId || "",
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
    if (isSessionDispatchBusy(params.sessionKey)) {
      throw new Error(
        `byai-channel: refused to replace in-flight SDK request while session dispatch gate is held: ${params.sessionKey}`,
      );
    }
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
    compactionRetryPending: false,
    modelFallbackPending: false,
    rootLifecyclePhase: undefined,
    hasEmittedContent: false,
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
  request.compactionRetryPending = false;
  request.modelFallbackPending = false;
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

export type ActiveSdkModelFallbackOutcome =
  | "next_fallback"
  | "succeeded"
  | "chain_exhausted";

export function markActiveSdkModelFallbackStep(
  sessionKey: string | undefined,
  outcome: ActiveSdkModelFallbackOutcome,
): ActiveSdkRequest | undefined {
  if (!sessionKey || !isRootSessionKey(sessionKey)) {
    return undefined;
  }
  const request = resolveActiveSdkRequestBySessionKey(sessionKey);
  if (!request) {
    return undefined;
  }
  if (outcome === "next_fallback") {
    request.modelFallbackPending = true;
    request.rootLifecyclePhase = undefined;
    request.awaitingFollowup = false;
    request.followupRunStarted = false;
    return request;
  }
  request.modelFallbackPending = false;
  return request;
}

export function markActiveSdkCompactionRetryPending(
  sessionKey: string | undefined,
  pending: boolean,
): ActiveSdkRequest | undefined {
  if (!sessionKey) {
    return undefined;
  }
  const request = resolveActiveSdkRequestBySessionKey(sessionKey);
  if (!request) {
    return undefined;
  }
  request.compactionRetryPending = pending;
  if (pending) {
    request.awaitingFollowup = false;
    request.followupRunStarted = false;
  }
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

/**
 * subagent 全部结束后等待 main 续跑（重新 lifecycle start）的最长时间。正常 direct-path
 * announce 会在数秒内重启 main；超过此窗口仍未 start，视为 main 不会再续跑（direct+steer
 * 均失败 / 子 agent error 等），强制放行完成门，避免前端流永久不收尾、request 泄漏。
 */
const AWAITING_FOLLOWUP_TIMEOUT_MS = 45 * 1000;

/** awaitingFollowup 是否已超过等待窗口（main 续跑迟迟未到）。 */
function isAwaitingFollowupStale(request: ActiveSdkRequest, now = Date.now()): boolean {
  if (!request.awaitingFollowup) {
    return false;
  }
  if (request.awaitingFollowupSince === undefined) {
    return false;
  }
  return now - request.awaitingFollowupSince >= AWAITING_FOLLOWUP_TIMEOUT_MS;
}

export function shouldCompleteActiveSdkRequest(request: ActiveSdkRequest): boolean {
  // awaitingFollowup 正常会被 main 续跑的 lifecycle start 清掉；若超时仍未清，视为
  // 不会再续跑，放行完成门（followupRunStarted 不在此豁免——它表示续跑已真正开始）。
  const awaitingBlocks = request.awaitingFollowup && !isAwaitingFollowupStale(request);
  return Boolean(
    request.rootLifecyclePhase &&
      request.pendingChildSessionKeys.size === 0 &&
      request.pendingOutboundCount === 0 &&
      !awaitingBlocks &&
      !request.followupRunStarted &&
      !request.compactionRetryPending &&
      !request.modelFallbackPending,
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
  runId: string,
) {
  if (!requesterSessionKey || !childSessionKey) {
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
  request.compactionRetryPending = false;
  request.modelFallbackPending = false;
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
      requesterSessionKey,
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
  // 仅当所有子 session 都结束才进入"等 main 续跑"状态：还有兄弟子 agent 在跑时，
  if (request.pendingChildSessionKeys.size === 0) {
    request.awaitingFollowup = true;
    request.awaitingFollowupSince = Date.now();
    request.followupRunStarted = false;
    request.lastReasoningText = "";
    request.lastReasoningMessageId = "";
  }
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
  request.modelFallbackPending = false;
  return await completeActiveSdkRequest(request);
}
