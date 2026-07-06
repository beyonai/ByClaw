/**
 * SDK 消息处理器
 * 类似于 message-processor.ts，但通过 Redis 输出
 */

import path from "node:path";
import {
  detectMime,
  fetchRemoteMedia,
  resolveChannelMediaMaxBytes,
  saveMediaBuffer,
} from "openclaw/plugin-sdk/media-runtime";
import { getByaiRuntime } from "./runtime.js";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
import type { ByaiLaneMetadata, SdkInboundFile, SdkProcessorDeps } from "./types.js";
import {
  bindActiveSdkRequestRunId,
  clearActiveSdkRequestByTarget,
  registerActiveSdkRequest,
  resolveSdkLocalFilePath,
  withSdkEmitMetadata,
} from "./session-context.js";
import { recordByclawChatContextMessage } from "./chat-context-store.js";
import { ensureSessionReasoningStream, shouldForceReasoningStream } from "./reasoning-stream.js";
import {
  buildPromptInjectionSnapshot,
  setPromptInjectionSnapshot,
} from "./prompt-injection-snapshot.js";
import {
  runSessionDispatchExclusive,
  sessionDispatchQueueDepth,
} from "./session-dispatch-gate.js";
import { waitForSdkSessionDispatchSettled } from "./session-dispatch-settle.js";
import { consumeWorkspaceReloadHint } from "./workspace-reload-hints.js";
import { EventType, SseReasonMessageType } from "@byclaw/by-framework";
import { getAgentNameById } from "./utils.js";
import { buildAgentReadyTitle } from "./i18n.js";
import {
  createByaiSdkDiagnosticTrace,
  emitByaiSdkDispatchCompleted,
  emitByaiSdkDispatchStarted,
  emitByaiSdkMessageReceived,
  runWithByaiSdkDiagnosticTrace,
} from "./diagnostics.js";
import {
  BYAI_CHANNEL_ID,
  buildBroadcastSessionKey,
  resolveByaiSessionKey,
  resolveSdkTargetAgentId,
} from "./session-key.js";
import { waitForManagedBaiyingAgentConfig } from "./managed-agent-config-wait.js";
import {
  appendByaiLaneToSessionKey,
  appendByaiLaneToTarget,
  parseByaiLaneMetadata,
} from "./multi-agent.js";

const CHANNEL_ID = BYAI_CHANNEL_ID;
const MANAGED_BAIYING_AGENT_PREFIX = "baiying-agent-";
export { buildBroadcastSessionKey };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parsePrimaryModelRef(primary: string): { provider: string; model: string } | null {
  const trimmed = primary.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) {
    return null;
  }
  const provider = trimmed.slice(0, slash).trim();
  const model = trimmed.slice(slash + 1).trim();
  return provider && model ? { provider, model } : null;
}

function providerHasModel(provider: unknown, modelId: string): boolean {
  if (!isRecord(provider)) {
    return false;
  }
  const models = provider.models;
  if (Array.isArray(models)) {
    return models.some((model) =>
      typeof model === "string" ? model === modelId : isRecord(model) && model.id === modelId,
    );
  }
  return isRecord(models) && Object.prototype.hasOwnProperty.call(models, modelId);
}

function resolveManagedAgentPrimaryModel(
  cfg: import("openclaw/plugin-sdk").OpenClawConfig,
  agentId: string,
): { provider: string; model: string; primary: string } | null {
  if (!agentId.startsWith(MANAGED_BAIYING_AGENT_PREFIX)) {
    return null;
  }
  const entry = cfg.agents?.list?.find((agent) => agent.id === agentId);
  const rawModel = entry?.model;
  const primary =
    typeof rawModel === "string"
      ? rawModel.trim()
      : isRecord(rawModel) && typeof rawModel.primary === "string"
        ? rawModel.primary.trim()
        : "";
  if (!primary) {
    return null;
  }
  const parsed = parsePrimaryModelRef(primary);
  if (!parsed) {
    return null;
  }
  const provider = cfg.models?.providers?.[parsed.provider];
  if (!providerHasModel(provider, parsed.model)) {
    return null;
  }
  return { ...parsed, primary };
}

async function alignManagedAgentSessionModel(params: {
  rt: ReturnType<typeof getByaiRuntime>;
  cfg: import("openclaw/plugin-sdk").OpenClawConfig;
  sessionAgentId: string;
  sessionKey: string;
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
  };
}): Promise<void> {
  const target = resolveManagedAgentPrimaryModel(params.cfg, params.sessionAgentId);
  if (!target) {
    return;
  }
  const sessionApi = params.rt.agent?.session;
  if (!sessionApi?.patchSessionEntry || !sessionApi.resolveStorePath) {
    params.log?.warn?.(
      `[diagnose-sdk] managed agent session model alignment skipped: runtime session patch API unavailable, agent=${params.sessionAgentId}`,
    );
    return;
  }
  const storePath = sessionApi.resolveStorePath(params.cfg.session?.store, {
    agentId: params.sessionAgentId,
  });
  const now = Date.now();
  await sessionApi.patchSessionEntry({
    storePath,
    sessionKey: params.sessionKey,
    fallbackEntry: {
      sessionId: crypto.randomUUID(),
      updatedAt: now,
    },
    preserveActivity: true,
    update: (entry: Record<string, unknown>) => {
      const patch: Record<string, unknown> = {};
      if (entry.modelProvider !== target.provider) {
        patch.modelProvider = target.provider;
      }
      if (entry.model !== target.model) {
        patch.model = target.model;
      }
      if (entry.providerOverride !== target.provider) {
        patch.providerOverride = target.provider;
      }
      if (entry.modelOverride !== target.model) {
        patch.modelOverride = target.model;
      }
      if (entry.modelOverrideSource !== "auto") {
        patch.modelOverrideSource = "auto";
      }
      if (entry.contextTokens !== undefined) {
        patch.contextTokens = undefined;
      }
      return Object.keys(patch).length > 0 ? patch : null;
    },
  });
  params.log?.info?.(
    `[diagnose-sdk] aligned managed agent session model before dispatch: agent=${params.sessionAgentId}, session=${params.sessionKey}, model=${target.primary}`,
  );
}

async function resolveSdkInboundMediaPayload(params: {
  cfg: import("openclaw/plugin-sdk").OpenClawConfig;
  accountId: string;
  sessionId: string;
  files?: SdkInboundFile[];
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
  };
}): Promise<{
  MediaPath?: string;
  MediaUrl?: string;
  MediaType?: string;
  MediaPaths?: string[];
  MediaUrls?: string[];
  MediaTypes?: string[];
}> {
  const files = Array.isArray(params.files) ? params.files : [];
  if (files.length === 0) {
    return {};
  }

  const mediaPaths: string[] = [];
  const mediaTypes: string[] = [];
  const seenSources = new Set<string>();
  const configuredMaxBytes = resolveChannelMediaMaxBytes({
    cfg: params.cfg,
    resolveChannelLimitMb: ({ cfg, accountId }) =>
      (
        cfg.channels?.[CHANNEL_ID] as
          | { accounts?: Record<string, { mediaMaxMb?: number }>; mediaMaxMb?: number }
          | undefined
      )?.accounts?.[accountId]?.mediaMaxMb ??
      (cfg.channels?.[CHANNEL_ID] as { mediaMaxMb?: number } | undefined)?.mediaMaxMb,
    accountId: params.accountId,
  });
  const effectiveMaxBytes = configuredMaxBytes ?? 20 * 1024 * 1024;

  for (const file of files) {
    const rawPath = (file.filePath ?? "").trim();
    if (!rawPath) {
      continue;
    }

    let remoteUrl: URL | null = null;
    try {
      const candidate = new URL(rawPath);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") {
        remoteUrl = candidate;
      }
    } catch {
      remoteUrl = null;
    }

    if (remoteUrl) {
      const sourceKey = remoteUrl.toString();
      if (seenSources.has(sourceKey)) {
        continue;
      }
      seenSources.add(sourceKey);

      const filePathHint = path.posix.basename(remoteUrl.pathname) || undefined;
      const fetched = await fetchRemoteMedia({
        url: sourceKey,
        filePathHint,
        maxBytes: effectiveMaxBytes,
      });
      const saved = await saveMediaBuffer(
        fetched.buffer,
        fetched.contentType ?? file.contentType ?? file.mimeType,
        "inbound",
        effectiveMaxBytes,
        fetched.fileName ?? filePathHint,
      );
      mediaPaths.push(saved.path);
      mediaTypes.push((saved.contentType ?? "").trim());
      continue;
    }

    const resolvedPath = resolveSdkLocalFilePath(rawPath, params.sessionId);

    if (seenSources.has(resolvedPath)) {
      continue;
    }
    seenSources.add(resolvedPath);

    mediaPaths.push(resolvedPath);
    const detectedMime =
      (await detectMime({
        filePath: resolvedPath,
        headerMime: file.contentType ?? file.mimeType ?? undefined,
      })) ?? "";
    mediaTypes.push(detectedMime.trim());
  }

  if (mediaPaths.length === 0) {
    return {};
  }

  params.log?.info?.(
    `[diagnose-sdk] attached inbound session files: sessionId=${params.sessionId}, count=${mediaPaths.length}, paths=${JSON.stringify(mediaPaths)}`,
  );

  return {
    MediaPath: mediaPaths[0],
    MediaUrl: mediaPaths[0],
    MediaType: mediaTypes[0] || undefined,
    MediaPaths: mediaPaths,
    MediaUrls: mediaPaths,
    MediaTypes: mediaTypes.some((value) => Boolean(value)) ? mediaTypes : undefined,
  };
}

export async function deliverReplyToAgentViaSdk(deps: SdkProcessorDeps): Promise<void> {
  const { message, account, cfg: initialCfg, log } = deps;

  const rt = getByaiRuntime();
  let cfg = initialCfg;
  const routePeerId = message.sessionId?.trim() || message.userId;
  let routing = rt.channel.routing.resolveAgentRoute({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: { kind: "direct", id: routePeerId },
  });

  const laneMetadata = message.laneMetadata ?? parseByaiLaneMetadata(message.extraPayload);
  const rawExtraPayload = message.extraPayload as {
    agent_id?: unknown;
    agent_code?: unknown;
    agent_name?: unknown;
  };
  const extraPayload = {
    ...rawExtraPayload,
    agent_id: rawExtraPayload?.agent_id ?? laneMetadata?.agentId,
    agent_code: rawExtraPayload?.agent_code ?? laneMetadata?.agentCode,
    agent_name: rawExtraPayload?.agent_name ?? laneMetadata?.agentName,
  };

  let targetAgentId = resolveSdkTargetAgentId(routing.agentId, extraPayload);
  cfg = await waitForManagedBaiyingAgentConfig({
    runtime: rt,
    cfg,
    agentId: targetAgentId,
    log,
  });
  routing = rt.channel.routing.resolveAgentRoute({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: { kind: "direct", id: routePeerId },
  });
  targetAgentId = resolveSdkTargetAgentId(routing.agentId, extraPayload);
  const baseSessionKey = resolveByaiSessionKey({
    routing,
    targetAgentId,
    sessionId: message.sessionId,
    userId: message.userId,
    perSessionId: account.config.sessionKeyPerSessionId ?? false,
  });
  const sessionKey = appendByaiLaneToSessionKey(baseSessionKey, laneMetadata);

  const { meta } = await runSessionDispatchExclusive(sessionKey, async () => {
    return await deliverReplyToAgentViaSdkUnderGate({
      ...deps,
      sessionKey,
      routing,
      targetAgentId,
      extraPayload,
      laneMetadata,
    });
  });

  if (meta.queued) {
    log?.info?.(
      `[diagnose-sdk] session dispatch dequeued: sessionKey=${sessionKey}, queueDepthBefore=${meta.queueDepthBefore}, gateWaitMs=${meta.waitMs}`,
    );
  }
}

type DeliverReplyUnderGateDeps = SdkProcessorDeps & {
  sessionKey: string;
  routing: {
    sessionKey: string;
    agentId: string;
    channel: string;
    accountId: string;
  };
  targetAgentId: string;
  extraPayload: {
    agent_id?: unknown;
    agent_code?: unknown;
    agent_name?: unknown;
  };
  laneMetadata?: ByaiLaneMetadata;
};

async function deliverReplyToAgentViaSdkUnderGate(
  deps: DeliverReplyUnderGateDeps,
): Promise<void> {
  const {
    message,
    account,
    cfg,
    log,
    onReply,
    sessionKey,
    routing,
    targetAgentId,
    extraPayload,
    laneMetadata,
  } = deps;

  const rt = getByaiRuntime();
  const diagnosticTrace = createByaiSdkDiagnosticTrace(message.traceId);
  const diagnosticRef = {
    sessionId: message.sessionId,
    sessionKey,
    messageId: message.messageId,
    userId: message.userId,
    traceId: message.traceId,
  };
  const sessionAgentId = resolveAgentIdFromSessionKey(sessionKey);
  let sessionAgentName = sessionAgentId;
  const payloadAgentName = stringValue(extraPayload.agent_name).trim();
  if (payloadAgentName) {
    sessionAgentName = payloadAgentName;
  } else if (extraPayload.agent_id || extraPayload.agent_code) {
    sessionAgentName = getAgentNameById(targetAgentId) || sessionAgentId;
  }

  const reasoningPreviewEnabled = shouldForceReasoningStream({
    message,
    account,
    sessionKey,
    agentId: sessionAgentId,
    cfg,
  });

  if (reasoningPreviewEnabled) {
    const reasoningSession = await ensureSessionReasoningStream({
      cfg,
      sessionKey,
    });
    if (reasoningSession.changed) {
      log?.info?.(
        `[diagnose-sdk] forced session reasoningLevel=stream, session=${sessionKey}, sessionId=${reasoningSession.sessionId}, created=${String(reasoningSession.created)}, healed=${String(reasoningSession.healed)}, agent=${sessionAgentId}`,
      );
    } else {
      log?.info?.(
        `[diagnose-sdk] session reasoningLevel already stream, session=${sessionKey}, sessionId=${reasoningSession.sessionId}, agent=${sessionAgentId}`,
      );
    }
  }

  await alignManagedAgentSessionModel({
    rt,
    cfg,
    sessionAgentId,
    sessionKey,
    log,
  });

  const { accountId } = account;
  const To = appendByaiLaneToTarget(`${sessionAgentId}:${message.sessionId}`, laneMetadata);
  const receivedAt = emitByaiSdkMessageReceived(diagnosticRef, diagnosticTrace);

  const activeRequest = registerActiveSdkRequest({
    accountId,
    sessionKey,
    to: To,
    sessionId: message.sessionId,
    traceId: message.traceId,
    createdAt: receivedAt,
    language: message.language,
    languageProvided: message.languageProvided,
    channelExtension: message.channelExtension,
    abortController: deps.abortController,
    beyondToken: message.beyondToken,
    laneMetadata,
  });
  recordByclawChatContextMessage({
    id: laneMetadata?.queryMessageId ?? message.messageId,
    role: "user",
    sessionId: message.sessionId,
    sessionKey,
    traceId: message.traceId,
    laneMetadata,
    agentId: laneMetadata?.agentId ?? sessionAgentId,
    agentName: laneMetadata?.agentName ?? sessionAgentName,
    text: message.text,
    createdAt: receivedAt,
  });

  const workspaceDir = rt.agent.resolveAgentWorkspaceDir(cfg, sessionAgentId);
  const includeUserMdReloadHint = consumeWorkspaceReloadHint(workspaceDir);
  setPromptInjectionSnapshot(
    sessionKey,
    buildPromptInjectionSnapshot({
      request: activeRequest,
      workspaceDir,
      includeUserMdReloadHint,
    }),
  );

  const body = rt.channel.reply.formatAgentEnvelope({
    channel: CHANNEL_ID,
    from: `${CHANNEL_ID}:${message.userId}`,
    timestamp: new Date(),
    envelope: rt.channel.reply.resolveEnvelopeFormatOptions(cfg),
    body: message.text,
  });
  const inboundMediaPayload = await resolveSdkInboundMediaPayload({
    cfg,
    accountId,
    sessionId: message.sessionId,
    files: message.files,
    log,
  });

  // 构建完整的入站上下文
  const ctxPayload = {
    Body: body,
    RawBody: message.text,
    CommandBody: message.text,
    From: `${CHANNEL_ID}:${message.userId}`,
    To: To,
    SessionKey: sessionKey,
    AccountId: accountId,
    ChatType: "direct",
    SenderName: message.userId,
    SenderId: message.userId,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    /**
     * 不能使用message.messageId作为MessageSid，因为在需要用户交互的场景下，messageId可能会传入和上一次任务一样的messageId
     * 相同的MessageSid，会使openclaw判断为相同的入站消息，导致直接跳过
     */
    // MessageSid: message.messageId,
    MessageSid: crypto.randomUUID(),
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: To,
    /** Explicit gateway session id for tools (e.g. baiying_call); OpenClaw may forward to tool ctx. */
    ChannelSessionId: message.sessionId,
    /** Explicit gateway trace id for tools (e.g. baiying_call doc trace passthrough). */
    ChannelTraceId: message.traceId || "",
    ...inboundMediaPayload,
  };

  let dispatchStartedAt = 0;
  try {
    const { dispatcher, replyOptions } = rt.channel.reply.createReplyDispatcherWithTyping({
      deliver: () => {},
    });

    const finalizedCtx = rt.channel.reply.finalizeInboundContext(ctxPayload);
    log?.info?.(`[diagnose-sdk] finalized ctx, SessionKey: ${finalizedCtx.SessionKey}, To: ${To}`);

    dispatchStartedAt = emitByaiSdkDispatchStarted(diagnosticRef, diagnosticTrace);
    const turnResult = await runWithByaiSdkDiagnosticTrace(diagnosticTrace, () =>
      rt.channel.inbound.runPreparedReply({
        channel: CHANNEL_ID,
        accountId,
        routeSessionKey: sessionKey,
        storePath: rt.channel.session.resolveStorePath(cfg.session?.store, {
          agentId: sessionAgentId,
        }),
        ctxPayload: finalizedCtx,
        recordInboundSession: rt.channel.session.recordInboundSession,
        record: { createIfMissing: true },
        messageId: finalizedCtx.MessageSid,
        runDispatch: () =>
          runWithByaiSdkDiagnosticTrace(diagnosticTrace, () =>
            rt.channel.reply.withReplyDispatcher({
              dispatcher,
              run: () =>
                runWithByaiSdkDiagnosticTrace(diagnosticTrace, () =>
                  rt.channel.reply.dispatchReplyFromConfig({
                    ctx: finalizedCtx,
                    cfg,
                    dispatcher,
                    replyOptions: {
                      ...replyOptions,
                      abortSignal: deps.abortController?.signal,
                      disableBlockStreaming: true,
                      onAgentRunStart: async (runId: string) => {
                        bindActiveSdkRequestRunId(sessionKey, runId);
                        log?.info?.(`[diagnose-sdk] onAgentRunStart called, runId: ${runId}}`);
                        await onReply(
                          buildAgentReadyTitle(message.language, sessionAgentName),
                          withSdkEmitMetadata(
                            {
                              parentMessageId: "-1",
                              eventType: EventType.REASONING_LOG_DELTA,
                              contentType: SseReasonMessageType.think_title,
                            },
                            {
                              laneMetadata,
                              traceId: message.traceId,
                              agentId: laneMetadata?.agentId ?? sessionAgentId,
                              agentName: laneMetadata?.agentName ?? sessionAgentName,
                            },
                          ),
                        );
                      },
                      onReasoningStream: () => {},
                      onReasoningEnd: () => {},
                      onPartialReply: () => {},
                    },
                  }),
                ),
            }),
          ),
      }),
    );
    const dispatchResult = turnResult.dispatchResult;
    emitByaiSdkDispatchCompleted(diagnosticRef, diagnosticTrace, {
      startedAt: dispatchStartedAt,
      outcome: "completed",
    });
    log?.info?.(
      `[diagnose-sdk] dispatch finished, queuedFinal=${String(dispatchResult.queuedFinal)}, counts=${JSON.stringify(dispatchResult.counts)}`,
    );
  } catch (err) {
    if (dispatchStartedAt > 0) {
      emitByaiSdkDispatchCompleted(diagnosticRef, diagnosticTrace, {
        startedAt: dispatchStartedAt,
        outcome: "error",
        error: err,
      });
    }
    log?.error?.(`[diagnose-sdk] Message dispatch failed: ${String(err)}`);
    clearActiveSdkRequestByTarget(accountId, To);
    throw err;
  } finally {
    const settle = await waitForSdkSessionDispatchSettled(sessionKey, {
      abortSignal: deps.abortController?.signal,
    });
    log?.info?.(
      `[diagnose-sdk] session dispatch settled: sessionKey=${sessionKey}, settled=${String(settle.settled)}, timedOut=${String(settle.timedOut)}, waitMs=${settle.waitMs}, rootLifecyclePhase=${settle.rootLifecyclePhase ?? "none"}, queueDepth=${sessionDispatchQueueDepth(sessionKey)}`,
    );
  }
}
