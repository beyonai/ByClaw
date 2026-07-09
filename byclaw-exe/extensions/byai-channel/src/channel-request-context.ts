const DEFAULT_ACCOUNT_KEY = "default";
const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_REQUEST_CONTEXT_STORE__";

export interface SharedChannelRequestContext {
    traceId: string;
    sessionKey: string;
    accountId: string;
    createdAt: number;
    fields: Record<string, unknown>;
}

interface ChannelRequestContextStore {
    channelRequestContextsBySessionKey: Map<string, SharedChannelRequestContext>;
}

function getChannelRequestContextStore(): ChannelRequestContextStore {
    const globalStore = globalThis as typeof globalThis & {
        [STORE_KEY]?: ChannelRequestContextStore;
    };
    if (!globalStore[STORE_KEY]) {
        globalStore[STORE_KEY] = {
            channelRequestContextsBySessionKey: new Map(),
        };
    }
    return globalStore[STORE_KEY];
}

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
    const store = getChannelRequestContextStore().channelRequestContextsBySessionKey;
    const existing = store.get(normalizedSessionKey);
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
    store.set(normalizedSessionKey, context);
    return context;
}

export function resolveChannelRequestContextBySessionKey(
    sessionKey: string | undefined,
): SharedChannelRequestContext | undefined {
    const normalizedSessionKey = normalizeAlias(sessionKey);
    if (!normalizedSessionKey) {
        return undefined;
    }
    return getChannelRequestContextStore().channelRequestContextsBySessionKey.get(normalizedSessionKey);
}

export function deleteChannelRequestContextBySessionKey(sessionKey: string | undefined): void {
    const normalizedSessionKey = normalizeAlias(sessionKey);
    if (!normalizedSessionKey) {
        return;
    }
    getChannelRequestContextStore().channelRequestContextsBySessionKey.delete(normalizedSessionKey);
}
