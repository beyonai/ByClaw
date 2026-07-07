import type { ByaiLaneMetadata } from "./types.js";

const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_CHAT_CONTEXT_STORE__";
const MAX_CHAT_CONTEXT_MESSAGES_PER_SESSION = 80;
const MAX_CHAT_CONTEXT_TEXT_CHARS = 12000;

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

interface ChatContextActiveRequest {
    sessionId: string;
    sessionKey: string;
    traceId?: string;
    laneMetadata?: ByaiLaneMetadata;
}

interface ByclawChatContextStore {
    chatContextBySessionId: Map<string, Map<string, ByclawChatContextMessage>>;
}

function getByclawChatContextStore(): ByclawChatContextStore {
    const globalStore = globalThis as typeof globalThis & {
        [STORE_KEY]?: ByclawChatContextStore;
    };
    if (!globalStore[STORE_KEY]) {
        globalStore[STORE_KEY] = {
            chatContextBySessionId: new Map(),
        };
    }
    return globalStore[STORE_KEY];
}

function normalizeAlias(value: string | undefined | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
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
    const sessionKey = normalizeAlias(message.sessionKey);
    if (sessionKey) {
        return `sessionKey:${sessionKey}`;
    }
    return [
        message.turnId ?? "",
        message.laneId ?? "",
        message.agentId ?? "",
        message.agentName ?? "",
    ].join("|");
}

function copyChatContextMessage(message: ByclawChatContextMessage): ByclawChatContextMessage {
    return { ...message };
}

function normalizeFilterValues(values: string[] | undefined): Set<string> | undefined {
    const normalized = (values ?? [])
        .map((value) => normalizeAlias(value)?.toLowerCase())
        .filter((value): value is string => Boolean(value));
    return normalized.length ? new Set(normalized) : undefined;
}

function filterMatches(value: string | undefined, filters: Set<string> | undefined, partial = false): boolean {
    if (!filters) {
        return false;
    }
    const normalized = normalizeAlias(value)?.toLowerCase();
    if (!normalized) {
        return false;
    }
    if (filters.has(normalized)) {
        return true;
    }
    return partial && Array.from(filters).some((filter) => normalized.includes(filter) || filter.includes(normalized));
}

function messageMatchesFilters(
    message: ByclawChatContextMessage,
    filters: {
        agentIds?: Set<string>;
        agentNames?: Set<string>;
        laneIds?: Set<string>;
    },
): boolean {
    const hasFilters = Boolean(filters.agentIds || filters.agentNames || filters.laneIds);
    if (!hasFilters) {
        return true;
    }
    return (
        filterMatches(message.agentId, filters.agentIds) ||
        filterMatches(message.agentName, filters.agentNames, true) ||
        filterMatches(message.laneId, filters.laneIds)
    );
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
    const store = getByclawChatContextStore().chatContextBySessionId;
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
    let messages = store.get(sessionId);
    if (!messages) {
        messages = new Map();
        store.set(sessionId, messages);
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
    request: ChatContextActiveRequest;
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
    agentIds?: string[];
    agentNames?: string[];
    laneIds?: string[];
}): ByclawChatContextSnapshot {
    const sessionId = normalizeAlias(params.sessionId) ?? "";
    const rawLimit = typeof params.limit === "number" && Number.isFinite(params.limit)
        ? params.limit
        : 12;
    const limit = Math.min(Math.max(Math.trunc(rawLimit), 1), 40);
    const filters = {
        agentIds: normalizeFilterValues(params.agentIds),
        agentNames: normalizeFilterValues(params.agentNames),
        laneIds: normalizeFilterValues(params.laneIds),
    };
    const allMessages = Array.from(
        getByclawChatContextStore().chatContextBySessionId.get(sessionId)?.values() ?? [],
    )
        .filter((message) => {
            if (params.includeCurrentLaneOnly) {
                return Boolean(params.requesterSessionKey) && message.sessionKey === params.requesterSessionKey;
            }
            return messageMatchesFilters(message, filters);
        })
        .sort((a, b) => a.createdAt - b.createdAt || a.updatedAt - b.updatedAt);
    const messages = allMessages.slice(-limit).map(copyChatContextMessage);
    const laneMap = new Map<string, ByclawChatContextLaneSummary>();
    for (const message of allMessages) {
        if (!message.sessionKey && !message.laneId && !message.agentId && !message.agentName) {
            continue;
        }
        const key = laneKeyOf(message);
        const existing = laneMap.get(key);
        laneMap.set(key, {
            laneId: message.laneId ?? existing?.laneId,
            turnId: message.turnId ?? existing?.turnId,
            agentId: message.agentId ?? existing?.agentId,
            agentName: message.agentName ?? existing?.agentName,
            sessionKey: message.sessionKey ?? existing?.sessionKey,
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
    getByclawChatContextStore().chatContextBySessionId.clear();
}
