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
import type { SdkInboundFile, SdkProcessorDeps } from "./types.js";
import {
  bindActiveSdkRequestRunId,
  clearActiveSdkRequestByTarget,
  registerActiveSdkRequest,
  resolveSdkLocalFilePath,
  registerAgentRunEndPromise,
  markActiveSdkCompactionRetryPending,
  markActiveSdkOverflowContinuePending,
  resolveActiveSdkRequestBySessionKey,
} from "./session-context.js";
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
import { waitForBaiyingAgentConfig } from "./managed-agent-config-wait.js";
import { EventType, SseReasonMessageType } from "@byclaw/by-framework";
import { getAgentNameById } from "./utils.js";
import {
  buildAgentReadyTitle,
  buildContextOverflowText,
} from "./i18n.js";
import {
  createByaiSdkDiagnosticTrace,
  emitByaiSdkDispatchCompleted,
  emitByaiSdkDispatchStarted,
  emitByaiSdkMessageReceived,
  runWithByaiSdkDiagnosticTrace,
} from "./diagnostics.js";
import {
  formatDispatchError,
  isOpenClawContextOverflowDispatchError,
} from "./dispatch-error.js";
import {
  BYAI_CHANNEL_ID,
  buildBroadcastSessionKey,
  resolveByaiSessionKey,
  resolveSdkTargetAgentId,
} from "./session-key.js";

const CHANNEL_ID = BYAI_CHANNEL_ID;
export { buildBroadcastSessionKey };

/**
 * 上下文溢出型 length 截断后自动续跑的最大次数。core 在续跑的 pre-prompt 会压缩历史，
 * 通常一次足够腾出输出空间；超过仍溢出则认定无法续跑，发终态提示，防死循环。
 */
const MAX_OVERFLOW_AUTO_CONTINUE = 1;

/**
 * 自动续跑时投给 core 的合成指令（system 风格，非裸「继续」二字），触发 core pre-prompt 压缩
 * 并续写上一轮被上下文上限截断的回答。语义自洽、避免被模型当成新任务。
 */
function buildOverflowContinuePrompt(language: string | undefined): string {
  return language === "en_US" || (language ?? "").toLowerCase().startsWith("en")
    ? "Your previous answer was cut off because the conversation reached the context-window limit. The history has now been compacted. Continue and complete that interrupted answer based on the trimmed context."
    : "上一轮回答因对话达到上下文窗口上限而被截断。历史现已整理(压缩)，请基于整理后的上下文继续并完成上一轮未完成的回答。";
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
  const { message, account, cfg, log } = deps;

  const rt = getByaiRuntime();
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
  const sessionKey = resolveByaiSessionKey({
    routing,
    targetAgentId,
    sessionId: message.sessionId,
    userId: message.userId,
    perSessionId: account.config.sessionKeyPerSessionId ?? false,
  });

  const { meta } = await runSessionDispatchExclusive(sessionKey, async () => {
    const dispatchCfg = await waitForBaiyingAgentConfig({
      runtime: rt,
      cfg,
      agentId: targetAgentId,
      log,
    });

    return await deliverReplyToAgentViaSdkUnderGate({
      ...deps,
      cfg: dispatchCfg,
      sessionKey,
      routing,
      targetAgentId,
      extraPayload,
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
    agent_id?: string;
    agent_code?: string;
    agent_name?: string;
  };
};

async function deliverReplyToAgentViaSdkUnderGate(
  deps: DeliverReplyUnderGateDeps,
): Promise<void> {
  const { message, account, cfg, log, onReply, sessionKey, routing, targetAgentId, extraPayload } =
    deps;

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

  const { accountId } = account;
  const To = `${sessionAgentId}:${message.sessionId}`;
  emitByaiSdkMessageReceived(diagnosticRef, diagnosticTrace);

  const activeRequest = registerActiveSdkRequest({
    accountId,
    sessionKey,
    to: To,
    sessionId: message.sessionId,
    traceId: message.traceId,
    language: message.language,
    languageProvided: message.languageProvided,
    channelExtension: message.channelExtension,
    abortController: deps.abortController,
    beyondToken: message.beyondToken,
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

  const inboundMediaPayload = await resolveSdkInboundMediaPayload({
    cfg,
    accountId,
    sessionId: message.sessionId,
    files: message.files,
    log,
  });

  // 一次 dispatchReplyFromConfig 的封装：每次续跑都新建 dispatcher/replyOptions（核心要求每次
  // dispatch 独立的 reply 上下文），但复用同一 sessionKey/To/onReply/abortSignal 闭包，使续跑的
  // agent-events 自动重绑到同一 activeRequest。`bodyText` 为本次投给 core 的提示文本。
  async function runOneDispatch(
    bodyText: string,
    options?: { includeMedia?: boolean },
  ): Promise<void> {
    const includeMedia = options?.includeMedia ?? true;
    const envelopeBody = rt.channel.reply.formatAgentEnvelope({
      channel: CHANNEL_ID,
      from: `${CHANNEL_ID}:${message.userId}`,
      timestamp: new Date(),
      envelope: rt.channel.reply.resolveEnvelopeFormatOptions(cfg),
      body: bodyText,
    });
    const ctxPayload = {
      Body: envelopeBody,
      RawBody: bodyText,
      CommandBody: bodyText,
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
       * 相同的MessageSid，会使openclaw判断为相同的入站消息，导致直接跳过。续跑同理：每次必须新 MessageSid。
       */
      MessageSid: crypto.randomUUID(),
      OriginatingChannel: CHANNEL_ID,
      OriginatingTo: To,
      /** Explicit gateway session id for tools (e.g. baiying_call); OpenClaw may forward to tool ctx. */
      ChannelSessionId: message.sessionId,
      /** Explicit gateway trace id for tools (e.g. baiying_call doc trace passthrough). */
      ChannelTraceId: message.traceId || "",
      // 续跑不重复挂载原始入站媒体（原媒体已在首轮进上下文）。
      ...(includeMedia ? inboundMediaPayload : {}),
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
                          registerAgentRunEndPromise(runId);
                          log?.info?.(`[diagnose-sdk] onAgentRunStart called, runId: ${runId}`);
                          await onReply(buildAgentReadyTitle(message.language, sessionAgentName), {
                            parentMessageId: "-1",
                            eventType: EventType.REASONING_LOG_DELTA,
                            contentType: SseReasonMessageType.think_title,
                          });
                        },
                        onReasoningStream: () => {},
                        onReasoningEnd: () => {},
                        onPartialReply: () => {},
                        onCompactionStart: async () => {
                          markActiveSdkCompactionRetryPending(sessionKey, true);
                          await onReply("", {
                            parentMessageId: "-1",
                            eventType: EventType.ANSWER_DELTA,
                            contentType: "5007",
                          });
                        },
                        onCompactionEnd: async () => {
                          markActiveSdkCompactionRetryPending(sessionKey, false);
                        },
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
      throw err;
    }
  }

  let deferDispatchSettleToAgentEvents = false;
  try {
    await runOneDispatch(message.text);
    await maybeContinueAfterOverflow();
  } catch (err) {
    const errorText = formatDispatchError(err);
    if (isOpenClawContextOverflowDispatchError(err)) {
      deferDispatchSettleToAgentEvents = true;
      log?.warn?.(
        `[diagnose-sdk] Message dispatch reported context overflow; keeping SDK stream open for OpenClaw recovery: ${errorText}`,
      );
    } else {
      log?.error?.(`[diagnose-sdk] Message dispatch failed: ${errorText}`);
      clearActiveSdkRequestByTarget(accountId, To);
      throw err;
    }
  } finally {
    if (deferDispatchSettleToAgentEvents) {
      log?.info?.(
        `[diagnose-sdk] session dispatch settle deferred to OpenClaw recovery events: sessionKey=${sessionKey}, queueDepth=${sessionDispatchQueueDepth(sessionKey)}`,
      );
    } else {
      const settle = await waitForSdkSessionDispatchSettled(sessionKey, {
        abortSignal: deps.abortController?.signal,
      });
      log?.info?.(
        `[diagnose-sdk] session dispatch settled: sessionKey=${sessionKey}, settled=${String(settle.settled)}, timedOut=${String(settle.timedOut)}, waitMs=${settle.waitMs}, rootLifecyclePhase=${settle.rootLifecyclePhase ?? "none"}, queueDepth=${sessionDispatchQueueDepth(sessionKey)}`,
      );
    }
  }

  // 上下文溢出型 length 截断的自动续跑编排：在已持有的 dispatch gate 内、settle 之前同步执行。
  // 截断 run 不交付答案；这里检测到溢出标记后发提示并再 dispatch 一次（core pre-prompt 会压缩、
  // 续写真答案），续跑事件自动重绑同 request。期间用 overflowContinuePending 挡住完成门，确保
  // settle 不会被截断 run 的 lifecycle-end 提前放行而丢答案。
  async function maybeContinueAfterOverflow(): Promise<void> {
    // 完成门 overflowContinuePending 由 agent_end hook 在每次溢出截断时同步置位，本函数
    // 全程持有、绝不在循环中途释放，只在三个真实退出点释放：无新溢出(续跑成功/本就正常)、
    // 达续跑上限、abort。这样从截断 run 到续跑 run 之间不存在完成门被放行的窗口。
    for (;;) {
      const request = resolveActiveSdkRequestBySessionKey(sessionKey);
      if (!request) {
        return;
      }
      if (!request.lastRunOverflowLength) {
        // 没有(新的)溢出截断：续跑成功或本就正常。确保完成门释放（可能被上一轮 hook 置位），
        // 让 settle 正常收尾并 emit 真答案。
        if (request.overflowContinueCount > 0) {
          const runIds = [...request.boundRunIds];
          const finalRunId = runIds[runIds.length - 1] ?? "";
          log?.info?.(
            `context-overflow continuation trigger finished: sessionKey=${sessionKey}, ` +
              `attempts=${request.overflowContinueCount}, finalRunId=${finalRunId}, ` +
              `compactionObserved=${String(request.overflowContinuationCompactionObserved)}`,
          );
        }
        markActiveSdkOverflowContinuePending(sessionKey, false);
        return;
      }
      // 读取即清快照；本轮续跑的 agent_end 会按需重新置位。
      request.lastRunOverflowLength = false;

      if (deps.abortController?.signal.aborted) {
        markActiveSdkOverflowContinuePending(sessionKey, false);
        return;
      }

      if (request.overflowContinueCount >= MAX_OVERFLOW_AUTO_CONTINUE) {
        // 压缩续跑后仍溢出：放弃续跑。先发终态告知（正文，完成门仍持），再释放门让 settle
        // 收尾，避免门先放开导致 APP_STREAM_RESPONSE 抢在终态文案之前发出。
        await onReply(buildContextOverflowText(message.language), {
          parentMessageId: "-1",
          eventType: EventType.ANSWER_DELTA,
        });
        markActiveSdkOverflowContinuePending(sessionKey, false);
        return;
      }

      // 冗余确保完成门持有（hook 已置位）；连续持有、循环内绝不释放。
      markActiveSdkOverflowContinuePending(sessionKey, true);
      request.overflowContinueCount += 1;
      request.overflowContinuationCompactionObserved = false;
      const overflowDiagnostic = request.lastRunOverflowDiagnostic;
      log?.info?.(
        `context-overflow continuation trigger: sessionKey=${sessionKey}, ` +
          `attempt=${request.overflowContinueCount}, ` +
          `trigger=length_context_pressure, ` +
          `stopReason=${overflowDiagnostic?.stopReason ?? "length"}, ` +
          `contextWindow=${overflowDiagnostic?.contextWindow ?? "unknown"}, ` +
          `usage=${JSON.stringify(overflowDiagnostic?.usage ?? {})}`,
      );

      // 续跑只是触发 core continuation：OpenClaw 可能先压缩并把 runtime-only 占位 prompt
      // 写入 transcript（例如 "Continue the OpenClaw runtime event."），不保证这里的文案可见持久化。
      // 不重复挂载入站媒体。若本轮又溢出，agent_end hook 会再次同步置 hook 标记 + 完成门；
      // 若成功，下一轮循环顶部统一释放完成门。
      await runOneDispatch(buildOverflowContinuePrompt(message.language), {
        includeMedia: false,
      });
    }
  }
}
