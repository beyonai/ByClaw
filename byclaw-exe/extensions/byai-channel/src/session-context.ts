import path from "node:path";
import { EmitOptions, EventType, type GatewayDataEmitter } from "@byclaw/by-framework";
import type { ByaiInboundMessage, ByaiLaneMetadata, Language } from "./types.js";
import { isSessionDispatchBusy } from "./session-dispatch-gate.js";
import { clearPendingMessageToolSends } from "./pending-message-tool.js";
import { generateRandomId } from "./utils.js";
import { buildContextOverflowText, resolveInboundLanguage } from "./i18n.js";
import { emitByaiSdkFirstResponse } from "./diagnostics.js";
import { SESSION_FILES_ROOT, getSessionPathBySessionId } from "./session-path.js";
import {
    deleteChannelRequestContextBySessionKey as deleteSharedChannelRequestContextBySessionKey,
    resolveChannelRequestContextBySessionKey as resolveSharedChannelRequestContextBySessionKey,
    upsertChannelRequestContextBySessionKey as upsertSharedChannelRequestContextBySessionKey,
} from "./channel-request-context.js";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
import type { ConnectorAuthorizationMap } from "./connector-authorization.js";

const CHANNEL_ID = "byai-channel" as const;
const DEFAULT_ACCOUNT_KEY = "default";
/** Must match `baiying-enhance/src/channel-session-resolve.ts` (read-only access to this store). */
const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_SESSION_CONTEXT_STORE__";
const MAX_CHAT_CONTEXT_MESSAGES_PER_SESSION = 80;
const MAX_CHAT_CONTEXT_TEXT_CHARS = 12000;

export { SESSION_FILES_ROOT, getSessionPathBySessionId };

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

export type ActiveSdkOverflowDiagnostic = {
  stopReason?: string;
  usage?: unknown;
  contextWindow?: number;
  detectedAt: number;
};

export type ByclawChatContextRole = "user" | "assistant";

export interface ByclawChatContextMessage {
    id: string;
    role: ByclawChatContextRole;
    sessionId: string;
    sessionKey?: string;
    traceId?: string;
    agentId?: string;
    agentName?: string;
    laneId?: string;
    turnId?: string;
    clientRequestId?: string;
    queryMessageId?: string;
    answerMessageId?: string;
    text: string;
    createdAt: number;
    updatedAt: number;
}

export interface ByclawChatContextLaneSummary {
    laneId?: string;
    turnId?: string;
    agentId?: string;
    agentName?: string;
    sessionKey?: string;
    messageCount: number;
    lastUpdatedAt: number;
}

export interface ByclawChatContextSnapshot {
    sessionId: string;
    messages: ByclawChatContextMessage[];
    lanes: ByclawChatContextLaneSummary[];
    totalMessages: number;
    truncated: boolean;
}

export interface ActiveSdkRequest {
  accountId: string;
  sessionKey: string;
  to: string;
  sessionId: string;
  traceId: string;
  createdAt: number;
  firstAnswerDeltaAt?: number;
  firstVisibleResponseAt?: number;
  boundRunIds: Set<string>;
  pendingChildSessionKeys: Set<string>;
  /**
   * 本 request 派出、尚未回灌结果的委派工作（RemoteAgent 异步任务）tool_call_id 集合。
   * 由 baiying_call 返回 status=DELEGATED_TASK_STATUS 时登记（见 agent-event.handleToolEvent），
   * 由 dispatchRemoteTaskFollowup 成功回灌后消除。非空表示「任务尚未结束，等待所有委派任务完成」，
   * 完成门据此挂住，避免委派结果回来前前端流被提前收尾。与 pendingChildSessionKeys（原生 subagent）
   * 正交：那是 openclaw subagent，这是 redis 驱动的外部委派。
   */
  delegatedWorkToolCallIds: Set<string>;
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
  /** 当前已收到 lifecycle/start、尚未收到匹配终态的 root run。 */
  activeRootRunId?: string;
  /** 已由 remote-task-watch 派发、但尚未收到 lifecycle/start 的 delegated follow-up run。 */
  pendingDelegatedFollowupRunId?: string;
  compactionRetryPending: boolean;
  modelFallbackPending: boolean;
  rootLifecyclePhase?: "end" | "error";
  /**
   * 主 dispatch promise 已 resolve（agent run 已彻底终结）。这是比 onAgentEvent 更权威的
   * 终结信号：context-overflow precheck-blocked 等路径下 onAgentEvent 零事件、rootLifecyclePhase
   * 永远 undefined，但 dispatchReplyFromConfig 仍会返回。settle 在 dispatch resolve 之后运行，
   * 进入完成判定前置位此标记，避免完成门被伪信号永久挡住。
   */
  dispatchSettled: boolean;
  /**
   * 最近一次 model 调用的有效上下文窗口 / token 预算快照，由 model_call_started hook 捕获。
   * core 不把 contextTokenBudget 透传进 agent_end 的 ctx，故在此按 sessionKey 暂存，供 agent_end
   * 判别 length 截断是否属上下文压力（对齐 core threshold 判据 totalTokens > window-reserveTokens）。
   */
  lastContextWindow?: number;
  lastContextBudget?: number;
  /**
   * 上一轮 agent run 以「上下文压力型 length 截断」结束（length + 上下文已越过 core 压缩阈值）。
   * 由 agent_end hook 经 isContextPressureLength 判定后置位，under-gate 在 dispatch 返回后
   * 读取以决定是否自动续跑。读取后即清。仅作单次快照，不参与完成门判定。
   */
  lastRunOverflowLength: boolean;
  lastRunOverflowDiagnostic?: ActiveSdkOverflowDiagnostic;
  /**
   * 检测到上下文压力截断、正在/即将自动续跑（让 core 在 pre-prompt 压缩后续写真答案）。置位期间
   * 阻断完成门，避免截断 run 的 lifecycle-end 让 settle 提前收尾、丢掉续跑答案。续跑 dispatch
   * 返回后清。与 30min settle 硬超时叠加兜底。
   */
  overflowContinuePending: boolean;
  overflowContinuationCompactionObserved: boolean;
  /** 本 request 已自动续跑次数。达 MAX_OVERFLOW_AUTO_CONTINUE 后不再续，防压缩后仍溢出的死循环。 */
  overflowContinueCount: number;
  hasEmittedContent: boolean;
  lastReasoningText: string;
  lastReasoningMessageId: string;
  language: Language;
  /** Mirrors `ByaiSdkInboundMessage.languageProvided` (LANG env or metadata.language). */
  languageProvided: boolean;
  channelExtension?: Record<string, unknown> | string;
  authConnectorList?: ConnectorAuthorizationMap;
  abortController?: AbortController;
  beyondToken?: string;
  laneMetadata?: ByaiLaneMetadata;
  agentEndHooks?: Map<string, Promise<{
    success?: boolean;
    error?: string;
  }>>
}

interface ActiveSdkRunBinding {
    request: ActiveSdkRequest;
    sessionKey: string;
}

interface AgentEndResult {
    success?: boolean;
    error?: string;
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
    chatContextBySessionId: Map<string, Map<string, ByclawChatContextMessage>>;
    agentEndResultByRun: Map<string, {
        resolve: (result: AgentEndResult) => void;
        reject: (reason?: unknown) => void;
        promise: Promise<AgentEndResult>;
    }>;
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
            chatContextBySessionId: new Map(),
            agentEndResultByRun: new Map(),
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
    chatContextBySessionId,
    agentEndResultByRun,
} = getSessionContextStore();

const sdkEmitterLastChunks = new Map<string, EmitOptions & { traceId: string }>();

function normalizeAlias(value: string | undefined | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function normalizeAccountId(value: string | undefined | null): string {
    return normalizeAlias(value) ?? DEFAULT_ACCOUNT_KEY;
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

function setMetadataField(
    metadata: Record<string, any>,
    key: string,
    value: string | undefined,
): void {
    if (value !== undefined && value !== "") {
        metadata[key] = value;
    }
}

function normalizeChatText(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }
    const normalized = value.replace(/\r\n/g, "\n");
    return normalized.length > MAX_CHAT_CONTEXT_TEXT_CHARS
        ? normalized.slice(-MAX_CHAT_CONTEXT_TEXT_CHARS)
        : normalized;
}

function normalizeChatContextId(value: string | undefined, fallback: string): string {
    return normalizeAlias(value) ?? fallback;
}

function pruneChatContextSession(messages: Map<string, ByclawChatContextMessage>): void {
    while (messages.size > MAX_CHAT_CONTEXT_MESSAGES_PER_SESSION) {
        const firstKey = messages.keys().next().value as string | undefined;
        if (!firstKey) {
            break;
        }
        messages.delete(firstKey);
    }
}

function laneKeyOf(message: ByclawChatContextMessage): string {
    return [
        message.turnId ?? "",
        message.laneId ?? "",
        message.agentId ?? "",
        message.agentName ?? "",
        message.sessionKey ?? "",
    ].join("|");
}

function copyChatContextMessage(message: ByclawChatContextMessage): ByclawChatContextMessage {
    return { ...message };
}

export function recordByclawChatContextMessage(params: {
    id?: string;
    role: ByclawChatContextRole;
    sessionId: string;
    text: string;
    append?: boolean;
    sessionKey?: string;
    traceId?: string;
    laneMetadata?: ByaiLaneMetadata;
    agentId?: string;
    agentName?: string;
    createdAt?: number;
}): ByclawChatContextMessage | undefined {
    const sessionId = normalizeAlias(params.sessionId);
    if (!sessionId) {
        return undefined;
    }
    const text = normalizeChatText(params.text);
    if (!text) {
        return undefined;
    }
    const now = Date.now();
    const lane = params.laneMetadata;
    const id = normalizeChatContextId(
        params.id,
        [
            params.role,
            lane?.answerMessageId,
            lane?.queryMessageId,
            lane?.clientRequestId,
            lane?.laneId,
            params.traceId,
            now,
        ].filter(Boolean).join(":"),
    );
    let messages = chatContextBySessionId.get(sessionId);
    if (!messages) {
        messages = new Map();
        chatContextBySessionId.set(sessionId, messages);
    }
    const existing = messages.get(id);
    const nextText = params.append && existing
        ? normalizeChatText(`${existing.text}${text}`)
        : text;
    const message: ByclawChatContextMessage = {
        id,
        role: params.role,
        sessionId,
        sessionKey: normalizeAlias(params.sessionKey) ?? existing?.sessionKey,
        traceId: normalizeAlias(params.traceId) ?? existing?.traceId,
        agentId: normalizeAlias(lane?.agentId ?? params.agentId) ?? existing?.agentId,
        agentName: normalizeAlias(lane?.agentName ?? params.agentName) ?? existing?.agentName,
        laneId: normalizeAlias(lane?.laneId) ?? existing?.laneId,
        turnId: normalizeAlias(lane?.turnId) ?? existing?.turnId,
        clientRequestId: normalizeAlias(lane?.clientRequestId) ?? existing?.clientRequestId,
        queryMessageId: normalizeAlias(lane?.queryMessageId) ?? existing?.queryMessageId,
        answerMessageId: normalizeAlias(lane?.answerMessageId) ?? existing?.answerMessageId,
        text: nextText,
        createdAt: existing?.createdAt ?? params.createdAt ?? now,
        updatedAt: now,
    };
    messages.set(id, message);
    pruneChatContextSession(messages);
    return copyChatContextMessage(message);
}

export function appendByclawAssistantContextDelta(params: {
    request: ActiveSdkRequest;
    id: string;
    text: string;
    agentId?: string;
    agentName?: string;
}): ByclawChatContextMessage | undefined {
    return recordByclawChatContextMessage({
        id: params.id,
        role: "assistant",
        sessionId: params.request.sessionId,
        sessionKey: params.request.sessionKey,
        traceId: params.request.traceId,
        laneMetadata: params.request.laneMetadata,
        agentId: params.agentId,
        agentName: params.agentName,
        text: params.text,
        append: true,
    });
}

export function resolveByclawChatContext(params: {
    sessionId: string;
    limit?: number;
    includeCurrentLaneOnly?: boolean;
    requesterSessionKey?: string;
}): ByclawChatContextSnapshot {
    const sessionId = normalizeAlias(params.sessionId) ?? "";
    const rawLimit = Number.isFinite(params.limit) ? Number(params.limit) : 12;
    const limit = Math.min(Math.max(Math.trunc(rawLimit), 1), 40);
    const allMessages = Array.from(chatContextBySessionId.get(sessionId)?.values() ?? [])
        .filter((message) => {
            if (!params.includeCurrentLaneOnly) {
                return true;
            }
            return Boolean(params.requesterSessionKey) && message.sessionKey === params.requesterSessionKey;
        })
        .sort((a, b) => a.createdAt - b.createdAt || a.updatedAt - b.updatedAt);
    const messages = allMessages.slice(-limit).map(copyChatContextMessage);
    const laneMap = new Map<string, ByclawChatContextLaneSummary>();
    for (const message of allMessages) {
        if (!message.laneId && !message.agentId && !message.agentName) {
            continue;
        }
        const key = laneKeyOf(message);
        const existing = laneMap.get(key);
        laneMap.set(key, {
            laneId: message.laneId,
            turnId: message.turnId,
            agentId: message.agentId,
            agentName: message.agentName,
            sessionKey: message.sessionKey,
            messageCount: (existing?.messageCount ?? 0) + 1,
            lastUpdatedAt: Math.max(existing?.lastUpdatedAt ?? 0, message.updatedAt),
        });
    }
    return {
        sessionId,
        messages,
        lanes: Array.from(laneMap.values()).sort((a, b) => a.lastUpdatedAt - b.lastUpdatedAt),
        totalMessages: allMessages.length,
        truncated: allMessages.length > messages.length,
    };
}

/** @internal test helper */
export function resetByclawChatContextForTest(): void {
    chatContextBySessionId.clear();
}

export function buildSdkEmitMetadata(params: {
    laneMetadata?: ByaiLaneMetadata;
    traceId?: string;
    agentId?: string;
    agentName?: string;
}): Record<string, any> {
    const metadata: Record<string, any> = {};
    const lane = params.laneMetadata;
    setMetadataField(metadata, "laneId", lane?.laneId);
    setMetadataField(metadata, "turnId", lane?.turnId);
    setMetadataField(metadata, "mode", lane?.mode);
    setMetadataField(metadata, "agentId", lane?.agentId ?? params.agentId);
    setMetadataField(metadata, "agentCode", lane?.agentCode);
    setMetadataField(metadata, "agentName", lane?.agentName ?? params.agentName);
    setMetadataField(metadata, "clientRequestId", lane?.clientRequestId);
    setMetadataField(metadata, "queryMessageId", lane?.queryMessageId);
    setMetadataField(metadata, "answerMessageId", lane?.answerMessageId);
    setMetadataField(metadata, "traceId", params.traceId);
    return metadata;
}

export function withSdkEmitMetadata(
    options: EmitOptions | undefined,
    params: {
        laneMetadata?: ByaiLaneMetadata;
        traceId?: string;
        agentId?: string;
        agentName?: string;
    },
): EmitOptions {
    const laneMetadata = buildSdkEmitMetadata(params);
    if (Object.keys(laneMetadata).length === 0) {
        return options ?? {};
    }
    return {
        ...(options ?? {}),
        metadata: {
            ...(options?.metadata ?? {}),
            ...laneMetadata,
        },
    };
}

export function withActiveSdkRequestEmitMetadata(
    request: ActiveSdkRequest,
    options?: EmitOptions,
): EmitOptions {
    return withSdkEmitMetadata(options, {
        laneMetadata: request.laneMetadata,
        traceId: request.traceId,
    });
}

export function buildSdkChunkEvent(
    text: string,
    options?: EmitOptions,
): string | { content: string; metadata: Record<string, any> } {
    return options?.metadata ? { content: text, metadata: options.metadata } : text;
}

export function buildSdkStateEvent(
    state: string,
    options?: EmitOptions,
): string | { state: string; metadata: Record<string, any> } {
    return options?.metadata ? { state, metadata: options.metadata } : state;
}

export function clearActiveSdkRequestRecord(request: ActiveSdkRequest): void {
  activeSdkRequestsByTarget.delete(buildActiveSdkTargetKey(request.accountId, request.to));
  activeSdkRequestsByTraceId.delete(request.traceId);
  channelRequestContextsBySessionKey.delete(request.sessionKey);
  deleteSharedChannelRequestContextBySessionKey(request.sessionKey);
  activeSdkRequestsBySession.delete(request.sessionKey);
  for (const childSessionKey of request.pendingChildSessionKeys) {
    channelRequestContextsBySessionKey.delete(childSessionKey);
    deleteSharedChannelRequestContextBySessionKey(childSessionKey);
    activeSdkRequestsByChild.delete(childSessionKey);
  }
  for (const runId of request.boundRunIds) {
    activeSdkRequestsByRun.delete(runId);
    agentEndResultByRun.delete(runId);
  }
  request.boundRunIds.clear();
  sdkEmitterLastChunks.delete(request.sessionKey);
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

/**
 * 解析一个「能发前端流」的 account：优先用给定 accountId；否则当仅有唯一已注册 emitter 时
 * 用它（单账号部署的常见情形）；都不满足返回 undefined。用于重启后恢复 request——解析不到
 * emitter 的 account 就不该重建 request（否则造出发不出流的孤儿）。
 */
export function resolveEmitterAccountId(accountId?: string): string | undefined {
    const normalized = normalizeAlias(accountId);
    if (normalized && sdkEmitters.has(normalizeAccountId(normalized))) {
        return normalizeAccountId(normalized);
    }
    if (sdkEmitters.size === 1) {
        return [...sdkEmitters.keys()][0];
    }
    return undefined;
}

export function getLastSdkEmitChunk(runId: string) {
    return sdkEmitterLastChunks.get(runId);
}

export async function emitSdkChunkTracked(sessionKey: string, params: {
    emitter: GatewayDataEmitter | undefined;
    sessionId: string;
    traceId?: string;
    text: string;
    options?: EmitOptions;
}): Promise<void> {
    if (!params.emitter) {
        return;
    }
    const request = resolveActiveSdkRequestBySessionKey(sessionKey);
    const options = request
        ? withActiveSdkRequestEmitMetadata(request, params.options)
        : withSdkEmitMetadata(params.options, {
            traceId: params.traceId,
        });
    await params.emitter.emitChunk(
        params.sessionId,
        params.traceId || "",
        buildSdkChunkEvent(params.text, options),
        options,
    );
    recordFirstSdkResponse(sessionKey, { ...params, options });
    sdkEmitterLastChunks.set(sessionKey, {
        traceId: params.traceId || "",
        messageId: options.messageId,
        parentMessageId: options.parentMessageId,
        eventType: options.eventType,
        contentType: options.contentType,
    });
}

function hasVisibleSdkText(text: string): boolean {
    return text.trim().length > 0;
}

function recordFirstSdkResponse(
    sessionKey: string,
    params: {
        traceId?: string;
        text: string;
        options?: EmitOptions;
    },
): void {
    if (!hasVisibleSdkText(params.text)) {
        return;
    }
    const request = resolveActiveSdkRequestBySessionKey(sessionKey);
    if (!request) {
        return;
    }
    const now = Date.now();
    if (request.firstVisibleResponseAt === undefined) {
        request.firstVisibleResponseAt = now;
        emitByaiSdkFirstResponse(
            {
                sessionId: request.sessionId,
                sessionKey: request.sessionKey,
                traceId: request.traceId,
            },
            {
                createdAt: request.createdAt,
                eventType: params.options?.eventType,
                kind: "visible",
                traceId: params.traceId ?? request.traceId,
            },
        );
    }
    if (
        request.firstAnswerDeltaAt === undefined &&
        params.options?.eventType === EventType.ANSWER_DELTA
    ) {
        request.firstAnswerDeltaAt = now;
        emitByaiSdkFirstResponse(
            {
                sessionId: request.sessionId,
                sessionKey: request.sessionKey,
                traceId: request.traceId,
            },
            {
                createdAt: request.createdAt,
                eventType: params.options?.eventType,
                kind: "answer_delta",
                traceId: params.traceId ?? request.traceId,
            },
        );
    }
}

export function upsertChannelRequestContextBySessionKey(params: {
    sessionKey: string;
    accountId: string;
    traceId?: string;
    fields?: Record<string, unknown>;
    createdAt?: number;
}): SharedChannelRequestContext | undefined {
    const context = upsertSharedChannelRequestContextBySessionKey(params);
    if (context) {
        channelRequestContextsBySessionKey.set(context.sessionKey, context);
    }
    return context;
}

export function resolveChannelRequestContextBySessionKey(
    sessionKey: string | undefined,
): SharedChannelRequestContext | undefined {
    const normalizedSessionKey = normalizeAlias(sessionKey);
    if (!normalizedSessionKey) {
        return undefined;
    }
    const context = resolveSharedChannelRequestContextBySessionKey(normalizedSessionKey)
        ?? channelRequestContextsBySessionKey.get(normalizedSessionKey);
    if (context) {
        channelRequestContextsBySessionKey.set(normalizedSessionKey, context);
    }
    return context;
}

export function registerActiveSdkRequest(params: {
    accountId: string;
    sessionKey: string;
    to: string;
    sessionId: string;
    traceId: string;
    createdAt?: number;
    language: Language;
    languageProvided: boolean;
    channelExtension?: Record<string, unknown> | string;
    authConnectorList?: ConnectorAuthorizationMap;
    abortController?: AbortController;
    beyondToken?: string;
    laneMetadata?: ByaiLaneMetadata;
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
        createdAt: params.createdAt ?? Date.now(),
        boundRunIds: new Set<string>(),
        pendingChildSessionKeys: new Set<string>(),
        delegatedWorkToolCallIds: new Set<string>(),
        pendingOutboundCount: 0,
        awaitingFollowup: false,
        deferredForFollowup: false,
        followupRunStarted: false,
        activeRootRunId: undefined,
        pendingDelegatedFollowupRunId: undefined,
        compactionRetryPending: false,
        modelFallbackPending: false,
        rootLifecyclePhase: undefined,
        dispatchSettled: false,
        lastRunOverflowLength: false,
        overflowContinuePending: false,
        overflowContinuationCompactionObserved: false,
        overflowContinueCount: 0,
        hasEmittedContent: false,
        lastReasoningText: "",
        lastReasoningMessageId: "",
        language: params.language,
        languageProvided: params.languageProvided,
        channelExtension: params.channelExtension,
        authConnectorList: params.authConnectorList,
        abortController: params.abortController,
        beyondToken: params.beyondToken,
        laneMetadata: params.laneMetadata,
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
            authConnectorList: request.authConnectorList,
            beyondToken: params.beyondToken,
            laneMetadata: request.laneMetadata,
            ...buildSdkEmitMetadata({
                laneMetadata: request.laneMetadata,
                traceId: request.traceId,
            }),
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
    runId?: string,
): ActiveSdkRequest | undefined {
    if (!sessionKey || !isRootSessionKey(sessionKey)) {
        return undefined;
    }
    const request = resolveActiveSdkRequestBySessionKey(sessionKey);
    if (!request) {
        return undefined;
    }
    const normalizedRunId = normalizeAlias(runId);
    request.activeRootRunId = normalizedRunId;
    if (normalizedRunId && request.pendingDelegatedFollowupRunId === normalizedRunId) {
        request.pendingDelegatedFollowupRunId = undefined;
    }
    request.rootLifecyclePhase = undefined;
    request.compactionRetryPending = false;
    request.modelFallbackPending = false;
    if (request.awaitingFollowup || request.followupRunStarted) {
        request.awaitingFollowup = false;
        request.deferredForFollowup = true;
        request.followupRunStarted = true;
    }
    return request;
}

export function markActiveSdkRootLifecycleFinished(
    sessionKey: string | undefined,
    phase: "end" | "error",
    runId?: string,
): ActiveSdkRequest | undefined {
    if (!sessionKey || !isRootSessionKey(sessionKey)) {
        return undefined;
    }
    const request = resolveActiveSdkRequestBySessionKey(sessionKey);
    if (!request) {
        return undefined;
    }
    const normalizedRunId = normalizeAlias(runId);
    // 同一 session 可以在旧 run 收尾前排入 delegated follow-up。旧 run 的迟到终态不能
    // 清掉新 run 的完成门，也不能覆盖新 run 已经开始后的 lifecycle 状态。
    if (
        normalizedRunId &&
        request.activeRootRunId &&
        request.activeRootRunId !== normalizedRunId
    ) {
        return undefined;
    }
    request.rootLifecyclePhase = phase;
    request.activeRootRunId = undefined;
    if (!request.pendingDelegatedFollowupRunId) {
        request.awaitingFollowup = false;
        request.followupRunStarted = false;
    }
    // 2026.6.1 的 overflow 压缩在同一 run 内静默续跑，压缩后不再发新的 lifecycle start，
    // compactionRetryPending 就没有信号来清；而单 run 只压缩一次（overflowRecoveryAttempted
    // 一次性护栏），压缩之后到来的终态 end/error 必为真终态，此处释放该门安全。不清的话
    // 完成门会被永久挡住，APP_STREAM_RESPONSE 永不发出、request 泄漏。
    request.compactionRetryPending = false;
    return request;
}

/**
 * 标记主 dispatch promise 已 resolve（agent run 已终结）。settle 在 dispatch resolve 之后、
 * 进入完成 poll 之前调用，作为 onAgentEvent 零事件路径（precheck-blocked 等）的权威终结兜底。
 */
export function markActiveSdkDispatchSettled(
    sessionKey: string | undefined,
): ActiveSdkRequest | undefined {
    if (!sessionKey) {
        return undefined;
    }
    const request = resolveActiveSdkRequestBySessionKey(sessionKey);
    if (!request) {
        return undefined;
    }
    request.dispatchSettled = true;
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
    if (pending && request.overflowContinuePending) {
        request.overflowContinuationCompactionObserved = true;
    }
    if (pending) {
        request.awaitingFollowup = false;
        request.followupRunStarted = false;
    }
    return request;
}

/**
 * agent_end hook 判定上一轮为「上下文溢出型 length 截断」后置位的快照标记。under-gate 在
 * dispatch 返回后读取以决定是否自动续跑，读取后即清。不参与完成门判定。
 */
export function markActiveSdkOverflowLength(
    sessionKey: string | undefined,
    overflow: boolean,
    diagnostic?: Omit<ActiveSdkOverflowDiagnostic, "detectedAt">,
): ActiveSdkRequest | undefined {
    if (!sessionKey) {
        return undefined;
    }
    const request = resolveActiveSdkRequestBySessionKey(sessionKey);
    if (!request) {
        return undefined;
    }
    request.lastRunOverflowLength = overflow;
    request.lastRunOverflowDiagnostic = overflow
      ? {
          ...diagnostic,
          detectedAt: Date.now(),
        }
      : undefined;
    return request;
}

/**
 * 阻断完成门，覆盖「检测到溢出型截断 → 自动续跑」的整个窗口：从截断 run 的 lifecycle-end
 * 到续跑 run 的 lifecycle-end。置位时同时清增量计数交给调用方维护。
 */
export function markActiveSdkOverflowContinuePending(
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
    request.overflowContinuePending = pending;
    if (!pending) {
        request.overflowContinuationCompactionObserved = false;
    }
    return request;
}

function isCoreContextOverflowPrecheckError(error: string): boolean {
    return /Context overflow: prompt too large for the model \(precheck\)\.?/i.test(error);
}

function mapAgentEndErrorForSdk(request: ActiveSdkRequest, error: string): string {
    if (isCoreContextOverflowPrecheckError(error)) {
        return buildContextOverflowText(request.language);
    }
    return error;
}

/**
 * 由 model_call_started hook 调用，按 sessionKey 暂存最近一次 model 调用的有效上下文窗口/预算。
 * agent_end 判别 length 截断是否属上下文压力时读取（core 不把它透传进 agent_end 的 ctx）。
 */
export function markActiveSdkContextWindow(
    sessionKey: string | undefined,
    window: number | undefined,
    budget: number | undefined,
): ActiveSdkRequest | undefined {
    if (!sessionKey) {
        return undefined;
    }
    const request = resolveActiveSdkRequestBySessionKey(sessionKey);
    if (!request) {
        return undefined;
    }
    if (typeof window === "number" && window > 0) {
        request.lastContextWindow = window;
    }
    if (typeof budget === "number" && budget > 0) {
        request.lastContextBudget = budget;
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
  // run 已终结的判据，按是否真正启动过 agent run 分两条路，互不误伤：
  // - boundRunIds 非空 ⇒ 启动过 run，onAgentEvent 总线有活动。dispatch promise 只 gate 在
  //   reply payload 投递完、不等总线 drain，可能早于流式结束（已观测 seq25 在 dispatch 后才到）。
  //   所以这条路只认 rootLifecyclePhase——它由 lifecycle terminal 置位，core 保证终态前已 flush
  //   完所有 assistant delta，是“流已 drain”的权威信号。dispatchSettled 不参与，避免截断在途 delta。
  // - boundRunIds 为空 ⇒ run 从未启动（precheck-blocked / before_agent_run 阻断等），onAgentEvent
  //   永远零事件、rootLifecyclePhase 永远 undefined。此时唯一的终结信号是 dispatchSettled。
  const runStarted = request.boundRunIds.size > 0;
  const runFinished = runStarted
    ? Boolean(request.rootLifecyclePhase)
    : request.dispatchSettled;
  return Boolean(
    runFinished &&
      request.pendingChildSessionKeys.size === 0 &&
      // 还有委派工作未回灌结果 ⇒ 任务尚未结束，挂住完成门等待所有委派任务完成。
      request.delegatedWorkToolCallIds.size === 0 &&
      !request.pendingDelegatedFollowupRunId &&
      request.pendingOutboundCount === 0 &&
      !awaitingBlocks &&
      !request.followupRunStarted &&
      !request.compactionRetryPending &&
      !request.overflowContinuePending &&
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
    // 取最近绑定且登记了 end-promise 的 runId 作为终态来源。Set 保留插入序，正常单 run 即首个；
    // 但溢出自动续跑会绑入续跑 runId，真正的终态回答/错误来自最后那个 run，不能用首个截断 run。
    const terminalRunId = [...latest.boundRunIds]
        .reverse()
        .find((runId) => agentEndResultByRun.has(runId));
    if (terminalRunId && agentEndResultByRun.has(terminalRunId)) {
        try {
            const result = await Promise.race([
                agentEndResultByRun.get(terminalRunId)?.promise,
                new Promise<AgentEndResult>((resolve, reject) => setTimeout(() => {
                    reject(new Error("waiting for agent end result timeout"));
                }, 10000)),
            ]);
            if (result?.error) {
                const errorText = mapAgentEndErrorForSdk(latest, result.error);
                await sdkEmitter.emitChunk(
                    latest.sessionId,
                    latest.traceId || "",
                    errorText,
                    {
                        eventType: EventType.ANSWER_DELTA,
                        messageId: generateRandomId(),
                    },
                );
            }
        } catch (error) {
            console.error("Error waiting for agent end result:", error);
        }
    }
    const stateOptions = withActiveSdkRequestEmitMetadata(latest, {
        eventType: EventType.APP_STREAM_RESPONSE,
    });
    await sdkEmitter.emitState(
        latest.sessionId,
        latest.traceId || "",
        buildSdkStateEvent("", stateOptions),
        stateOptions,
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
      ...(resolveChannelRequestContextBySessionKey(request.sessionKey)?.fields ?? {}),
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
  deleteSharedChannelRequestContextBySessionKey(childSessionKey);
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

/**
 * 登记一件委派工作（RemoteAgent 异步任务）到 sessionKey 解析到的 request。sessionKey 为委派
 * tool call 所在会话（resolve 内部同时查 root 与 child 映射），命中即把 toolCallId 加入
 * delegatedWorkToolCallIds，挂住完成门。找不到 request 或 toolCallId 为空则不操作。
 */
export function addActiveSdkDelegatedWork(
  sessionKey: string | undefined,
  toolCallId: string | undefined,
): ActiveSdkRequest | undefined {
  const normalizedToolCallId = normalizeAlias(toolCallId);
  if (!sessionKey || !normalizedToolCallId) {
    return undefined;
  }
  const request = resolveActiveSdkRequestBySessionKey(sessionKey);
  if (!request) {
    return undefined;
  }
  request.delegatedWorkToolCallIds.add(normalizedToolCallId);
  return request;
}

/**
 * 按 requesterSessionKey 定位委派所属 request，未命中且给了 parentSessionKey（requesterSessionKey
 * 为 subagent key 的场景）则回退用 parentSessionKey 再试。两者都用于定位同一条 request。
 */
function locateActiveSdkRequestForDelegated(params: {
  requesterSessionKey?: string;
  parentSessionKey?: string;
}): ActiveSdkRequest | undefined {
  const requesterKey = normalizeAlias(params.requesterSessionKey);
  const parentKey = normalizeAlias(params.parentSessionKey);
  return (
    (requesterKey ? resolveActiveSdkRequestBySessionKey(requesterKey) : undefined) ??
    (parentKey ? resolveActiveSdkRequestBySessionKey(parentKey) : undefined)
  );
}

/**
 * 保证委派结果回灌时有一条可用的 ActiveSdkRequest：先按 requester/parent 定位；命中直接返回。
 * 未命中（大概率 openclaw 重启后内存态丢失）时，仅当能解析到「能发前端流」的 emitter account
 * 才重建一条最小 request 接管前端 SSE 收尾——否则返回 undefined 退化为纯 subagent.run 续跑
 * （orchestration 唤醒链不依赖前端流，不能因缺 emitter 造出发不出流、还会卡完成门的孤儿）。
 * 重建的 request 以 requesterSessionKey 为主键；sessionId 缺省回退用 sessionKey，保证 emitter
 * emitChunk 有一个稳定的 sessionId。
 */
export function ensureActiveSdkRequestForDelegatedFollowup(params: {
  requesterSessionKey: string | undefined;
  parentSessionKey?: string;
  sessionId?: string;
  traceId?: string;
  accountId?: string;
  language?: Language;
  beyondToken?: string;
}): ActiveSdkRequest | undefined {
  const existing = locateActiveSdkRequestForDelegated(params);
  if (existing) {
    return existing;
  }
  const sessionKey = normalizeAlias(params.requesterSessionKey);
  if (!sessionKey) {
    return undefined;
  }
  const emitterAccountId = resolveEmitterAccountId(params.accountId);
  if (!emitterAccountId) {
    return undefined;
  }
  const sessionId = normalizeAlias(params.sessionId) ?? sessionKey;
  const traceId = normalizeAlias(params.traceId) ?? "";
  const { language, languageProvided } = resolveInboundLanguage(params.language);
  const agentId = resolveAgentIdFromSessionKey(sessionKey);
  return registerActiveSdkRequest({
    accountId: emitterAccountId,
    sessionKey,
    to: `${agentId}:${sessionId}`,
    sessionId,
    traceId,
    language,
    languageProvided,
    beyondToken: normalizeAlias(params.beyondToken) ?? undefined,
  });
}

/**
 * follow-up run 投递前置「等待续跑」态：把完成门的持有从 delegatedWorkToolCallIds 平滑转移到
 * awaitingFollowup，覆盖「回灌成功清空委派集合 → follow-up run 的 lifecycle start 尚未经
 * onAgentEvent 入账」这段窗口——否则 settle 轮询会在此刻看到集合已空、又读到上一轮 yield 残留的
 * rootLifecyclePhase="end"，误判完成、提前收尾前端流。start 事件到达时 markActiveSdkRootLifecycleStarted
 * 会把 awaitingFollowup 转成 followupRunStarted（挂到该 run 的 end，无超时），与原生 subagent
 * 唤醒共用同一状态机；follow-up run 若再派委派，其 end 时 delegatedWorkToolCallIds 已非空继续挡门。
 * 必须在 removeActiveSdkDelegatedWork / dispatch 之前调用，保证门的持有不出现空档。定位同 requester→parent 回退。
 */
export function markActiveSdkAwaitingDelegatedFollowup(params: {
  requesterSessionKey: string | undefined;
}): ActiveSdkRequest | undefined {
  const request = locateActiveSdkRequestForDelegated(params);
  if (!request) {
    return undefined;
  }
  request.awaitingFollowup = true;
  request.awaitingFollowupSince = Date.now();
  request.followupRunStarted = false;
  return request;
}

/**
 * 记录 remote follow-up dispatch 返回的 runId。dispatch 只表示 run 已排入 session lane；
 * lifecycle/start 可能要等旧 run 完成后才到，因此这段窗口必须由 runId 级状态持续挡住完成门。
 */
export function markActiveSdkDelegatedFollowupDispatched(params: {
  requesterSessionKey: string | undefined;
  runId: string | undefined;
}): ActiveSdkRequest | undefined {
  const request = locateActiveSdkRequestForDelegated(params);
  const normalizedRunId = normalizeAlias(params.runId);
  if (!request || !normalizedRunId) {
    return request;
  }
  if (request.activeRootRunId === normalizedRunId) {
    request.pendingDelegatedFollowupRunId = undefined;
    request.awaitingFollowup = false;
    request.deferredForFollowup = true;
    request.followupRunStarted = true;
    return request;
  }
  request.pendingDelegatedFollowupRunId = normalizedRunId;
  request.awaitingFollowup = true;
  request.awaitingFollowupSince = Date.now();
  request.followupRunStarted = false;
  return request;
}

/**
 * 委派工作结果回灌成功后消除对应 toolCallId。定位同 locateActiveSdkRequestForDelegated。
 * 返回被消除的 request（若命中），供调用方决定是否触发一次完成检查。
 */
export function removeActiveSdkDelegatedWork(params: {
  requesterSessionKey: string | undefined;
  toolCallId: string | undefined;
}): ActiveSdkRequest | undefined {
  const normalizedToolCallId = normalizeAlias(params.toolCallId);
  if (!normalizedToolCallId) {
    return undefined;
  }
  const request = locateActiveSdkRequestForDelegated(params);
  if (!request) {
    return undefined;
  }
  request.delegatedWorkToolCallIds.delete(normalizedToolCallId);
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
    request.activeRootRunId = undefined;
    request.pendingDelegatedFollowupRunId = undefined;
    request.rootLifecyclePhase = "end";
    request.modelFallbackPending = false;
    return await completeActiveSdkRequest(request);
}

export function registerAgentRunEndPromise(runId: string, result?: AgentEndResult) {
    if (agentEndResultByRun.has(runId)) {
        return;
    }
    if (result) {
        agentEndResultByRun.set(runId, {
            promise: Promise.resolve(result),
            resolve: () => {},
            reject: () => {},
        });
        return;
    }
    let _resolve: (result: AgentEndResult) => void = () => {};
    let _reject: (reason?: unknown) => void = () => {};
    const promise = new Promise<AgentEndResult>((resolve, reject) => {
        _resolve = resolve;
        _reject = reject;
    });
    agentEndResultByRun.set(runId, {
        promise,
        resolve: _resolve,
        reject: _reject,
    });
    return agentEndResultByRun.get(runId);
}

export function getAgentRunEndPromiseResolver(runId: string) {
    if (!agentEndResultByRun.has(runId)) {
        return undefined;
    }
    const { resolve } = agentEndResultByRun.get(runId) || {};
    return resolve;
}
