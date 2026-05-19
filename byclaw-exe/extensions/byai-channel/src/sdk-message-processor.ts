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
import { buildAgentSessionKey, resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
import type { SdkInboundFile, SdkProcessorDeps } from "./types.js";
import {
  bindActiveSdkRequestRunId,
  registerActiveSdkRequest,
  resolveSdkLocalFilePath,
} from "./session-context.js";
import { ensureSessionReasoningStream, shouldForceReasoningStream } from "./reasoning-stream.js";
import { EventType, SseReasonMessageType } from "@byclaw/by-framework";
import { getAgentNameById } from "./utils.js";
import { buildAgentReadyTitle } from "./i18n.js";

const CHANNEL_ID = "byai-channel" as const;

export function buildBroadcastSessionKey(
  baseSessionKey: string,
  originalAgentId: string,
  targetAgentId: string,
): string {
  const prefix = `agent:${originalAgentId}:`;
  if (baseSessionKey.startsWith(prefix)) {
    return `agent:${targetAgentId}:${baseSessionKey.slice(prefix.length)}`;
  }
  return baseSessionKey;
}

function resolveSdkTargetAgentId(
  routingAgentId: string,
  extraPayload: {
    agent_id?: string;
    agent_code?: string;
  },
): string {
  if (extraPayload.agent_id) {
    return `baiying-agent-${extraPayload.agent_id}`;
  }
  if (extraPayload.agent_code) {
    return extraPayload.agent_code;
  }
  return routingAgentId;
}

function resolveSdkSessionKey(params: {
  routing: {
    sessionKey: string;
    agentId: string;
    channel: string;
    accountId: string;
  };
  targetAgentId: string;
  sessionId: string;
  userId: string;
  perSessionId: boolean;
}): string {
  if (!params.perSessionId) {
    if (params.targetAgentId === params.routing.agentId) {
      return params.routing.sessionKey;
    }
    return buildBroadcastSessionKey(
      params.routing.sessionKey,
      params.routing.agentId,
      params.targetAgentId,
    );
  }

  const peerId = params.sessionId.trim() || params.userId;
  return buildAgentSessionKey({
    agentId: params.targetAgentId,
    channel: params.routing.channel,
    accountId: params.routing.accountId,
    peer: { kind: "direct", id: peerId },
    dmScope: "per-peer",
  });
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
  const { message, account, cfg, log, onReply } = deps;

  // 获取完整的 PluginRuntime
  const rt = getByaiRuntime();

  // 解析路由
  const routePeerId = message.sessionId?.trim() || message.userId;
  const routing = rt.channel.routing.resolveAgentRoute({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: { kind: "direct", id: routePeerId },
  });

  const extraPayload = message.extraPayload as {
    agent_id?: string;
    agent_code?: string;
    agent_name?: string;
  };

  const targetAgentId = resolveSdkTargetAgentId(routing.agentId, extraPayload);
  const sessionKey = resolveSdkSessionKey({
    routing,
    targetAgentId,
    sessionId: message.sessionId,
    userId: message.userId,
    perSessionId:
      account.config.sessionKeyPerSessionId ??
      false,
  });
  const sessionAgentId = resolveAgentIdFromSessionKey(sessionKey);
  let sessionAgentName = sessionAgentId;
  if (extraPayload.agent_id || extraPayload.agent_code) {
    if (extraPayload.agent_name) {
      sessionAgentName = extraPayload.agent_name;
    } else {
      sessionAgentName = getAgentNameById(targetAgentId) || sessionAgentId;
    }
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

  registerActiveSdkRequest({
    accountId: account.accountId,
    sessionKey,
    to: `user:${message.sessionId}`,
    sessionId: message.sessionId,
    traceId: message.traceId,
    language: message.language,
    languageProvided: message.languageProvided,
    channelExtension: message.channelExtension,
    abortController: deps.abortController,
    beyondToken: message.beyondToken,
  });

  const body = rt.channel.reply.formatAgentEnvelope({
    channel: CHANNEL_ID,
    from: `${CHANNEL_ID}:${message.userId}`,
    timestamp: new Date(),
    envelope: rt.channel.reply.resolveEnvelopeFormatOptions(cfg),
    body: message.text,
  });
  const inboundMediaPayload = await resolveSdkInboundMediaPayload({
    cfg,
    accountId: account.accountId,
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
    To: `user:${message.sessionId}`,
    SessionKey: sessionKey,
    AccountId: routing.accountId,
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
    OriginatingTo: `user:${message.sessionId}`,
    /** Explicit gateway session id for tools (e.g. baiying_call); OpenClaw may forward to tool ctx. */
    ChannelSessionId: message.sessionId,
    /** Explicit gateway trace id for tools (e.g. baiying_call doc trace passthrough). */
    ChannelTraceId: message.traceId || "",
    ...inboundMediaPayload,
  };

  let checkInterval: NodeJS.Timeout | null = null;

  try {
    // 创建 dispatcher
    const {
      dispatcher,
      replyOptions,
    } = rt.channel.reply.createReplyDispatcherWithTyping({
      deliver: () => {},
    });

    // finalize 上下文
    const finalizedCtx = rt.channel.reply.finalizeInboundContext(ctxPayload);
    log?.info?.(`[diagnose-sdk] finalized ctx, SessionKey: ${finalizedCtx.SessionKey}`);

    const dispatchResult = await rt.channel.reply.withReplyDispatcher({
      dispatcher,
      run: () =>
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
              log?.info?.(
                `[diagnose-sdk] onAgentRunStart called, runId: ${runId}}`,
              );
              await onReply(buildAgentReadyTitle(message.language, sessionAgentName), "partial", {
                parentMessageId: "-1",
                eventType: EventType.REASONING_LOG_DELTA,
                contentType: SseReasonMessageType.think_title,
              });
            },
            onReasoningStream: () => {},
            onReasoningEnd: () => {},
            onPartialReply: () => {},
          },
        }),
    });
    log?.info?.(
      `[diagnose-sdk] dispatch finished, queuedFinal=${String(dispatchResult.queuedFinal)}, counts=${JSON.stringify(dispatchResult.counts)}`,
    );
  } catch (err) {
    log?.error?.(`[diagnose-sdk] Message dispatch failed: ${String(err)}`);
    throw err;
  } finally {
    // 确保清理定时器
    if (checkInterval) {
      clearInterval(checkInterval);
    }
  }
}
