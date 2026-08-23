import { createRedis, EventType, SseReasonMessageType } from "@byclaw/by-framework";
import { enqueueAfterAgentEvents } from "./agent-event-serial.js";
import {
    emitSdkChunkTracked,
    markActiveSdkOutboundSent,
    markActiveSdkOutboundSending,
    resolveActiveSdkRequestBySessionKey,
    resolveActiveSdkRequestByTarget,
    resolveActiveSdkRunBinding,
    resolveSdkEmitter,
    getAgentRunEndPromiseResolver,
    recordActiveSdkRootAgentEnd,
} from "./session-context.js";
import {
    cancelActiveSdkCompletionCheck,
    scheduleActiveSdkCompletionCheck,
} from "./sdk-session-completion.js";
import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";
import { normalizeUsage } from "openclaw/plugin-sdk/agent-harness-runtime";
import type { Language, PluginHookAgentContext, PluginHookAgentEndEvent } from "./types.js";
import {
    BYAI_USER_MD_SECTION_END,
    BYAI_USER_MD_SECTION_START,
    buildChannelExtensionPrompt,
    buildCompactionNoticeText,
    buildLanguagePrompt,
    buildMaxTokenErrorText,
    buildSessionFilesPrompt,
    buildSkillInstallPrompt,
    buildUserMdByaiUserSection,
    buildUserMdReloadPrompt,
    resolveInboundLanguage,
} from "./i18n.js";
import { reportNativeChildRunTerminal } from "./native-child-run.js";
import { getByaiRuntime } from "./runtime.js";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
import { takePromptInjectionSnapshot } from "./prompt-injection-snapshot.js";
import {
    consumeWorkspaceReloadHint,
    markWorkspaceReloadHint,
} from "./workspace-reload-hints.js";
import {
    resolveByaiAgentIdFromSessionKey,
    resolveByaiSessionIdFromSessionKey,
} from "../../shared/src/session-key.js";
import { resolveByaiSessionStatus } from "./session-status-route.js";
import { createRedisInstance } from "./utils.js";
import path from "node:path";
import fs from "node:fs/promises";

type BeforeMessageWriteEvent = {
    message?: unknown;
    sessionKey?: string;
    agentId?: string;
};

type BeforeMessageWriteContext = {
    sessionKey?: string;
    agentId?: string;
};

type BeforePromptBuildResult = {
    prependSystemContext?: string;
    appendSystemContext?: string;
};

type MessageSendingEvent = {
    to?: string;
    content?: string;
};

type MessageHookContext = {
    channelId?: string;
    accountId?: string;
    conversationId?: string;
};

type CompactionHookEvent = {
    messageCount?: number;
    compactedCount?: number;
    tokenCount?: number;
    sessionFile?: string;
};

// Raw provider usage payload. Key names vary across providers, so we run it
// through openclaw's normalizeUsage instead of reading fields directly. Only
// the buckets normalizeUsage understands are typed here; it tolerates the rest.
type LlmOutputUsage = {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
    inputTokens?: number;
    outputTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cached_tokens?: number;
    total_tokens?: number;
    totalTokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    input_tokens_details?: { cached_tokens?: number };
};

type LlmOutputHookEvent = {
    runId?: string;
    sessionKey?: string;
    provider?: string;
    model?: string;
    contextTokenBudget?: number;
    contextWindowReferenceTokens?: number;
    // Run-accumulated usage across the whole tool loop. NOT a context size: a
    // multi-tool turn re-reads the context as cacheRead on every model call, so
    // summing these buckets multiplies one context by the call count.
    usage?: LlmOutputUsage;
    // The single most recent assistant message. Its usage reflects one model
    // call, which is what openclaw uses for the "context used" snapshot
    // (see embedded-agent-runner/run.ts: "current context usage, not
    // accumulated tool-loop usage").
    lastAssistant?: { usage?: LlmOutputUsage };
};

type LlmOutputHookContext = PluginHookAgentContext & {
    contextTokenBudget?: number;
    contextWindowReferenceTokens?: number;
};

type RedisInfo = {
    username?: string;
    password?: string;
    host: string;
    port: number;
    db: number;
};

type ByaiUserInfo = {
    userId: string;
    userCode: string;
    userName: string;
    sourceSystem?: string;
};

const compactionHookNoticeKeys = new Set<string>();

function shouldEmitCompactionHookNotice(key: string): boolean {
    if (compactionHookNoticeKeys.has(key)) {
        return false;
    }
    compactionHookNoticeKeys.add(key);
    setTimeout(() => {
        compactionHookNoticeKeys.delete(key);
    }, 10 * 60 * 1000).unref?.();
    return true;
}

async function emitCompactionHookNotice(
    api: OpenClawPluginApi,
    phase: "start" | "end",
    event: CompactionHookEvent,
    ctx: PluginHookAgentContext,
): Promise<void> {
    const sessionKey = ctx.sessionKey?.trim();
    if (!sessionKey) {
        return;
    }
    const request = resolveActiveSdkRequestBySessionKey(sessionKey);
    if (!request) {
        return;
    }
    const key = [
        request.sessionKey,
        ctx.runId ?? "",
        phase,
        event.sessionFile ?? "",
    ].join(":");
    if (!shouldEmitCompactionHookNotice(key)) {
        return;
    }
    await emitSdkChunkTracked(request.sessionKey, {
        emitter: resolveSdkEmitter(request.accountId),
        sessionId: request.sessionId,
        traceId: request.traceId,
        text: buildCompactionNoticeText(request.language, {
            phase,
            completed: phase === "end",
            willRetry: false,
        }),
        options: {
            messageId: `${ctx.runId || request.sessionKey}:compaction:${phase}:hook`,
            parentMessageId: "-1",
            eventType: EventType.REASONING_LOG_DELTA,
            contentType: SseReasonMessageType.think_status_title,
            objectType: "compaction",
            status: phase === "start" ? "_START_" : "_DONE_",
            metadata: {
                isCompactionNotice: true,
                compactionPhase: phase,
                source: "compaction_hook",
            },
        },
    });
    api.logger.info(
        `[byai-channel] emitted compaction ${phase} notice from hook: sessionKey=${request.sessionKey}`,
    );
}

function resolveSessionStatusRedisKey(sessionId: string) {
    return `byai:session:${sessionId}:status`;
}

// Writes the post-compaction context size using the token count the compaction
// hook already carries (`event.tokenCount` = tokensAfter). We must NOT read the
// session store here: after_compaction fires inside the runner, before
// agentCommand persists the new totalTokens, so the store still holds the
// pre-compaction value. The context budget (denominator) is stable across a
// run, so we reuse it from the latest llm_output record already in redis.
async function refreshCompactionSessionStatusRedis(
    sessionKey: string | undefined,
    tokensAfter: number | undefined,
): Promise<void> {
    const normalizedSessionKey = sessionKey?.trim();
    if (!normalizedSessionKey) {
        return;
    }
    const usedTokens = normalizeNonNegativeNumber(tokensAfter);
    if (usedTokens === undefined) {
        return;
    }
    const sessionId = resolveByaiSessionIdFromSessionKey(normalizedSessionKey);
    if (!sessionId) {
        return;
    }
    const redis = createRedisInstance();
    if (!redis) {
        return;
    }
    const agentId = resolveByaiAgentIdFromSessionKey(normalizedSessionKey);
    const statusKey = resolveSessionStatusRedisKey(sessionId);
    let contextTokens: number | null = null;
    let modelProvider: string | null = null;
    let model: string | null = null;
    try {
        const existingRaw = await redis.hget(statusKey, agentId);
        if (existingRaw) {
            const existing = JSON.parse(existingRaw) as Record<string, unknown>;
            contextTokens = normalizeNonNegativeNumber(existing.contextTokens) ?? null;
            modelProvider = typeof existing.modelProvider === "string" ? existing.modelProvider : null;
            model = typeof existing.model === "string" ? existing.model : null;
        }
    } catch {
        // Missing/garbled prior record just means we cannot compute percent yet;
        // the next llm_output call will repopulate the budget.
    }
    const percent =
        contextTokens !== null && contextTokens > 0
            ? Math.min(Math.round((usedTokens / contextTokens) * 100), 100)
            : null;
    redis.hset(statusKey, agentId, JSON.stringify({
        ok: true,
        exists: true,
        sessionKey: normalizedSessionKey,
        agentId,
        sessionId,
        fresh: true,
        realtime: true,
        source: "after_compaction",
        usedTokens,
        contextTokens,
        percent,
        modelProvider,
        model,
    }));
}

function normalizeNonNegativeNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : undefined;
}

type NormalizedLlmUsage = {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
};

// Prompt/context size for one model call: uncached input + cache reads + cache
// writes. Matches openclaw's derivePromptTokens so the percentage lines up with
// the Web UI's context-used meter. Output tokens are intentionally excluded.
function resolveLlmOutputUsedTokens(usage: NormalizedLlmUsage | undefined): number | undefined {
    if (!usage) {
        return undefined;
    }
    const input = normalizeNonNegativeNumber(usage.input);
    const cacheRead = normalizeNonNegativeNumber(usage.cacheRead);
    const cacheWrite = normalizeNonNegativeNumber(usage.cacheWrite);
    if (input === undefined && cacheRead === undefined && cacheWrite === undefined) {
        return undefined;
    }
    return (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
}

async function refreshRealtimeSessionStatusRedis(
    event: LlmOutputHookEvent,
    ctx: LlmOutputHookContext,
): Promise<void> {
    const sessionKey = (ctx.sessionKey ?? event.sessionKey)?.trim();
    if (!sessionKey) {
        return;
    }
    const sessionId = resolveByaiSessionIdFromSessionKey(sessionKey);
    if (!sessionId) {
        return;
    }
    // Use the last single model call, not the run-accumulated event.usage, so the
    // reported context size matches the Web UI (which snapshots the latest call's
    // prompt tokens). normalizeUsage also reconciles provider key-name and
    // OpenAI-style "cached tokens included in prompt" differences.
    const lastCallUsage = normalizeUsage(event.lastAssistant?.usage) ?? normalizeUsage(event.usage);
    const usedTokens = resolveLlmOutputUsedTokens(lastCallUsage);
    if (usedTokens === undefined) {
        return;
    }
    const contextTokens =
        normalizeNonNegativeNumber(event.contextTokenBudget) ??
        normalizeNonNegativeNumber(ctx.contextTokenBudget) ??
        normalizeNonNegativeNumber(event.contextWindowReferenceTokens) ??
        normalizeNonNegativeNumber(ctx.contextWindowReferenceTokens) ??
        null;
    const percent =
        contextTokens !== null && contextTokens > 0
            ? Math.min(Math.round((usedTokens / contextTokens) * 100), 100)
            : null;
    const redis = createRedisInstance();
    if (!redis) {
        return;
    }
    const agentId = resolveByaiAgentIdFromSessionKey(sessionKey);
    redis.hset(resolveSessionStatusRedisKey(sessionId), agentId, JSON.stringify({
        ok: true,
        exists: true,
        sessionKey,
        agentId,
        sessionId,
        fresh: true,
        realtime: true,
        source: "llm_output",
        runId: event.runId ?? ctx.runId,
        usedTokens,
        contextTokens,
        percent,
        modelProvider: event.provider ?? null,
        model: event.model ?? null,
        inputTokens: normalizeNonNegativeNumber(lastCallUsage?.input) ?? null,
        cacheRead: normalizeNonNegativeNumber(lastCallUsage?.cacheRead) ?? null,
        cacheWrite: normalizeNonNegativeNumber(lastCallUsage?.cacheWrite) ?? null,
        outputTokens: normalizeNonNegativeNumber(lastCallUsage?.output) ?? null,
    }));
}

// Baseline context-used snapshot at turn start. before_dispatch fires once per
// inbound dispatch, before any token is spent this turn. Reading the session
// store here is safe and intentional: it still holds the *previous* turn's
// persisted totalTokens, which is exactly the context size this turn starts
// from. The first llm_output of the turn then overwrites this with live data.
async function refreshRunStartSessionStatusRedis(sessionKey: string | undefined): Promise<void> {
    const normalizedSessionKey = sessionKey?.trim();
    if (!normalizedSessionKey) {
        return;
    }
    const sessionId = resolveByaiSessionIdFromSessionKey(normalizedSessionKey);
    if (!sessionId) {
        return;
    }
    try {
        const status = await resolveByaiSessionStatus(normalizedSessionKey);
        const agentId = status.agentId as string;
        const redis = createRedisInstance();
        if (!redis) {
            return;
        }
        redis.hset(resolveSessionStatusRedisKey(sessionId), agentId, JSON.stringify({
            ...status,
            sessionId,
            source: "before_dispatch",
        }));
    } catch (err) {
        console.warn(
            `[byai-channel] run-start session status refresh failed: sessionKey=${normalizedSessionKey}, error=${String(err)}`,
        );
    }
}

function getRedisInfo(): RedisInfo | null {
    const {
        REDIS_USERNAME,
        REDIS_PASSWORD,
        REDIS_HOST,
        REDIS_PORT,
        REDIS_DATABASE,
    } = process.env;
    if (!REDIS_HOST || !REDIS_PORT) {
        return null;
    }
    return {
        username: REDIS_USERNAME,
        password: REDIS_PASSWORD,
        host: REDIS_HOST,
        port: parseInt(REDIS_PORT, 10),
        db: parseInt(REDIS_DATABASE || "0", 10),
    };
}

async function getCurrentUserCode(): Promise<string | null> {
    const runtime = getByaiRuntime();
    const stateDir = runtime.state.resolveStateDir();
    const identityFile = path.join(stateDir, "identity", "by_user_info.json");
    try {
        const content = await fs.readFile(identityFile, "utf8");
        const identity = JSON.parse(content) as { userCode?: unknown };
        if (typeof identity.userCode !== "string" || !identity.userCode.trim()) {
            return null;
        }
        return identity.userCode.trim();
    } catch {
        return null;
    }
}

function mergeUserSection(original: string, section: string): string {
    const start = original.indexOf(BYAI_USER_MD_SECTION_START);
    const end = original.indexOf(BYAI_USER_MD_SECTION_END);
    if (start >= 0 && end >= 0 && end > start) {
        const tail = end + BYAI_USER_MD_SECTION_END.length;
        const replaced = `${original.slice(0, start).trimEnd()}\n\n${section}\n${original.slice(tail).trimStart()}`;
        return replaced.trimEnd() + "\n";
    }
    const merged = original.trimEnd()
        ? `${original.trimEnd()}\n\n${section}\n`
        : `${section}\n`;
    return merged;
}

async function readByaiUserInfoFromRedis(): Promise<ByaiUserInfo | null> {
    const userCode = await getCurrentUserCode();
    if (!userCode) {
        return null;
    }

    const redisInfo = getRedisInfo();
    if (!redisInfo) {
        return null;
    }

    const redis = createRedis(redisInfo);
    try {
        const userIdRaw = await redis.get(`SHARE_BFM_USER_CODE_${userCode}`);
        const userId = userIdRaw?.trim();
        if (!userId) {
            return null;
        }
        const rawUser = await redis.get(`SHARE_BFM_USER_${userId}`);
        if (!rawUser) {
            return null;
        }
        const parsed = JSON.parse(rawUser) as Record<string, unknown>;
        delete parsed.pwd;

        const userName = typeof parsed.userName === "string" ? parsed.userName.trim() : "";
        const parsedUserCode = typeof parsed.userCode === "string" ? parsed.userCode.trim() : userCode;
        const parsedUserId = parsed.userId != null ? String(parsed.userId).trim() : userId;
        if (!userName || !parsedUserCode || !parsedUserId) {
            return null;
        }

        return {
            userName,
            userCode: parsedUserCode,
            userId: parsedUserId,
            sourceSystem: typeof parsed.sourceSystem === "string" ? parsed.sourceSystem : undefined,
        };
    } finally {
        await redis.quit().catch(() => undefined);
    }
}

async function syncWorkspaceUserMd(
    api: OpenClawPluginApi,
    workspaceDir?: string,
    language?: Language,
): Promise<void> {
    if (!workspaceDir) {
        return;
    }
    const user = await readByaiUserInfoFromRedis();
    if (!user) {
        return;
    }
    const userMdPath = path.join(workspaceDir, "USER.md");
    let current = "";
    try {
        current = await fs.readFile(userMdPath, "utf8");
    } catch {
        current = "";
    }
    const lang = language ?? resolveInboundLanguage(undefined).language;
    const section = buildUserMdByaiUserSection(user, lang);
    const next = mergeUserSection(current, section);
    if (next === current) {
        return;
    }
    await fs.writeFile(userMdPath, next, "utf8");
    markWorkspaceReloadHint(workspaceDir);
    api.logger.info(`byai-channel synced USER.md: ${userMdPath}`);
}

export function registerByaiHooks(api: OpenClawPluginApi): void {
    api.on("before_compaction", (event: CompactionHookEvent, ctx: PluginHookAgentContext) => {
        if (event?.messageCount !== -1) {
            return;
        }
        setImmediate(() => {
            void enqueueAfterAgentEvents(
                `before_compaction sessionKey=${ctx.sessionKey ?? ""}`,
                async () => {
                    await emitCompactionHookNotice(api, "start", event, ctx);
                },
            ).catch((err) => {
                api.logger.error(`[byai-channel] before_compaction enqueue failed: ${String(err)}`);
            });
        });
    });

    api.on("after_compaction", (event: CompactionHookEvent, ctx: PluginHookAgentContext) => {
        if (event?.compactedCount !== -1) {
            return;
        }
        // Use the post-compaction token count from the event; the session store is
        // not yet updated at this point (see refreshCompactionSessionStatusRedis).
        void refreshCompactionSessionStatusRedis(ctx.sessionKey, event.tokenCount).catch((err) => {
            api.logger.warn(`[byai-channel] after_compaction session status refresh failed: ${String(err)}`);
        });
        setImmediate(() => {
            void enqueueAfterAgentEvents(
                `after_compaction sessionKey=${ctx.sessionKey ?? ""}`,
                async () => {
                    await emitCompactionHookNotice(api, "end", event, ctx);
                },
            ).catch((err) => {
                api.logger.error(`[byai-channel] after_compaction enqueue failed: ${String(err)}`);
            });
        });
    });

    // USER.md sync runs once per inbound dispatch, not on every before_prompt_build
    // iteration (tool rounds re-enter before_prompt_build while the embedded session
    // lock may be released for model I/O — see attempt.session-lock.ts).
    api.on("before_dispatch", async (event, ctx) => {
        if (ctx.channelId !== "byai-channel") {
            return;
        }
        const sessionKey = event.sessionKey?.trim() || ctx.sessionKey?.trim();
        if (!sessionKey) {
            return;
        }
        // Baseline context-used snapshot for the turn. before_dispatch fires once
        // per inbound dispatch, before any token is spent, so the session store
        // still holds the previous turn's totalTokens — exactly the context size
        // this turn starts from. The first llm_output then overwrites it with live
        // data. Done before the request/agent guards below so it is not skipped.
        void refreshRunStartSessionStatusRedis(sessionKey).catch((err) => {
            api.logger.warn(
                `[byai-channel] before_dispatch session status refresh failed: ${String(err)}`,
            );
        });
        const request = resolveActiveSdkRequestBySessionKey(sessionKey);
        if (!request) {
            return;
        }
        const agentId = resolveAgentIdFromSessionKey(sessionKey);
        if (!agentId) {
            return;
        }
        const rt = getByaiRuntime();
        const cfg = rt.config.current?.() ?? rt.config.loadConfig();
        const workspaceDir = rt.agent.resolveAgentWorkspaceDir(cfg, agentId);
        const hintLanguage = request.language ?? resolveInboundLanguage(undefined).language;
        try {
            await syncWorkspaceUserMd(api, workspaceDir, hintLanguage);
        } catch (err) {
            api.logger.warn(`byai-channel sync USER.md failed: ${String(err)}`);
        }
    });

    api.on("before_prompt_build", (event: {
        prompt: string;
    }, ctx: {
        runId?: string;
        agentId?: string;
        sessionKey?: string;
        sessionId?: string;
        workspaceDir?: string;
        modelProviderId?: string;
        modelId?: string;
        messageProvider?: string;
        trigger?: string;
        channelId?: string;
    }): BeforePromptBuildResult => {
        const snapshot = takePromptInjectionSnapshot(ctx.sessionKey);
        if (snapshot?.appendSystemContext) {
            api.logger.info(
                `before_prompt_build hook emits (snapshot), sessionId=${ctx.sessionId}, appendSystemContext=${snapshot.appendSystemContext}`,
            );
            return {
                appendSystemContext: snapshot.appendSystemContext,
            };
        }

        let hintLanguage = resolveInboundLanguage(undefined).language;
        if (ctx.sessionKey) {
            const earlyRequest = resolveActiveSdkRequestBySessionKey(ctx.sessionKey);
            if (earlyRequest?.language) {
                hintLanguage = earlyRequest.language;
            }
        }
        const sections: string[] = [];
        const normalizedWorkspace = ctx.workspaceDir ? path.resolve(ctx.workspaceDir) : "";
        if (consumeWorkspaceReloadHint(normalizedWorkspace)) {
            sections.push(buildUserMdReloadPrompt(hintLanguage));
        }
        if (ctx.sessionKey) {
            const request = resolveActiveSdkRequestBySessionKey(ctx.sessionKey);
            if (request?.sessionId) {
                sections.push(buildSessionFilesPrompt(request.sessionId, request.language));
            }
            if (request) {
                sections.push(buildSkillInstallPrompt(normalizedWorkspace, request.language));
            }
            if (request?.languageProvided) {
                sections.push(buildLanguagePrompt(request.language));
            }
            const channelExtPrompt = buildChannelExtensionPrompt(
                request?.channelExtension,
                request?.language,
            );
            if (channelExtPrompt) {
                sections.push(channelExtPrompt);
            }
        }
        const appendSystemContext = sections.join("\n\n");
        api.logger.info(
            `before_prompt_build hook emits, sessionId=${ctx.sessionId}, appendSystemContext=${appendSystemContext}`,
        );
        return {
            appendSystemContext,
        };
    });

    api.on("message_sending", (event: MessageSendingEvent, ctx: MessageHookContext) => {
        if (ctx?.channelId !== "byai-channel") {
            return;
        }
        const request = resolveActiveSdkRequestByTarget(ctx?.accountId ?? "default", event?.to ?? "");
        if (!request) {
            return;
        }
        const accountId = ctx?.accountId;
        const to = event?.to ?? "";
        setImmediate(() => {
            void enqueueAfterAgentEvents(
                `message_sending sessionKey=${request.sessionKey}`,
                async () => {
                    const activeRequest = markActiveSdkOutboundSending(accountId, to);
                    if (!activeRequest) {
                        return;
                    }
                    cancelActiveSdkCompletionCheck(activeRequest.sessionKey);
                },
            ).catch((err) => {
                api.logger.error(`[byai-channel] message_sending enqueue failed: ${String(err)}`);
            });
        });
    });

    api.on("message_sent", (event: MessageSendingEvent & { success?: boolean; error?: string }, ctx: MessageHookContext) => {
        if (ctx?.channelId !== "byai-channel") {
            return;
        }
        const request = resolveActiveSdkRequestByTarget(ctx?.accountId ?? "default", event?.to ?? "");
        if (!request) {
            return;
        }
        const accountId = ctx?.accountId;
        const to = event?.to ?? "";
        const success = event?.success;
        setImmediate(() => {
            void enqueueAfterAgentEvents(
                `message_sent sessionKey=${request.sessionKey}`,
                async () => {
                    const activeRequest = markActiveSdkOutboundSent(accountId, to);
                    if (!activeRequest) {
                        return;
                    }
                    scheduleActiveSdkCompletionCheck(
                        api,
                        activeRequest.sessionKey,
                        `message_sent:${success === false ? "failed" : "ok"}`,
                    );
                },
            ).catch((err) => {
                api.logger.error(`[byai-channel] message_sent enqueue failed: ${String(err)}`);
            });
        });
    });

    api.on("llm_output", (event: LlmOutputHookEvent, ctx: LlmOutputHookContext) => {
        void refreshRealtimeSessionStatusRedis(event, ctx).catch((err) => {
            api.logger.warn(`[byai-channel] llm_output session status refresh failed: ${String(err)}`);
        });
    });

    api.on("agent_end", (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => {
        api.logger.info(
            `agent_end hook emits, runId=${ctx.runId}, success=${event.success}, error=${event.error}`,
        );
        const { runId } = ctx;
        if (!runId) {
            return;
        }
        const runBinding = resolveActiveSdkRunBinding(runId);
        const language = runBinding?.request?.language;
        let resolve = getAgentRunEndPromiseResolver(runId);
        let _success = event.success;
        let _error = event.error;
        // stopReason=length 等部分情况下，虽然 event.success = true。但是业务上可以认为失败了。
        if (_success && Array.isArray(event.messages) && event.messages.length) {
            const lastAssistant = event.messages
                .slice()
                .toReversed()
                .find((message) => {
                    if (message && typeof message === "object" && "role" in message) {
                        return message.role === "assistant";
                    }
                    return false;
                });
            if (lastAssistant) {
                const {
                    stopReason,
                    errorMessage,
                } = lastAssistant as {
                    stopReason?: string;
                    errorMessage?: string;
                }
                if (errorMessage) {
                    _success = false;
                    _error = errorMessage;
                } else if (stopReason === "length") {
                    _success = false;
                    _error = buildMaxTokenErrorText(language);
                } else if (stopReason === "aborted") {
                    // 兜底。正常来说 stopReason=aborted 时，error=true, 且有 errorMessage
                    _success = false;
                    _error = "The request was interrupted (timed out or cancelled voluntarily) and the reply could not be completed. Please try again.";
                }
            }
        }
        if (resolve) {
            resolve({
                success: _success,
                error: _error,
            });
        }
        recordActiveSdkRootAgentEnd({
            runId,
            success: _success,
            messages: event.messages,
        });
        // agent_end 对 native child run 也会触发，且在 announce 投递之前，是与 child lifecycle
        // 互备的早期终态事实。台账按 runId 去重，root run 的 runId 不在台账里，登记会自然落空。
        reportNativeChildRunTerminal(api, {
            childRunId: runId,
            childSessionKey: ctx.sessionKey,
            source: "agent_end",
        });
        // Intentionally no session-status write here: agent_end fires inside the
        // runner before agentCommand persists this turn's totalTokens, so reading
        // the store would publish a stale (previous-turn) value and could clobber
        // the fresh figure already written by llm_output / after_compaction.
    });
}
