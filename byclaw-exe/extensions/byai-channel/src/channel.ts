import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
} from "openclaw/plugin-sdk/core";
import type { ChannelOutboundContext } from "openclaw/plugin-sdk/channel-contract";
import { ByaiChannelConfigSchema } from "./config-schema.js";
import { listByaiAccountIds, resolveByaiAccount, resolveDefaultByaiAccountId } from "./config.js";
import type { ResolvedByaiAccount, ByaiProbe } from "./types.js";
import { sendReplyCallback } from "./webhook-handler.js";
import type { ByaiSdkApp } from "./sdk-app.js";
import {
  buildSdkStateEvent,
  emitSdkChunkTracked,
  resolveActiveSdkRequestByTarget,
  resolveSdkEmitter,
  resolveWebhookContext,
  withActiveSdkRequestEmitMetadata,
} from "./session-context.js";
import {
  deliveredAnswerTextCovers,
  recordPushedAnswerText,
} from "./answer-text-ledger.js";
import { parseAgentIdFromTo, parseSessionIdFromTo } from "./outbound-dedup.js";
import { EventType } from "@byclaw/by-framework";
import { emitOutOfBandSdkEvent, generateRandomId } from "./utils.js";

const CHANNEL_ID = "byai-channel" as const;

const meta = {
  id: CHANNEL_ID,
  label: "ByAI Channel",
  selectionLabel: "ByAI Channel (HTTP + Stream)",
  docsPath: "/channels/byai-channel",
  docsLabel: "byai-channel",
  blurb: "HTTP webhook channel with configurable streaming output for web integration.",
  aliases: ["byai"],
} as const;

async function emitSdkText(params: {
  accountId: string;
  to: string;
  text: string;
}): Promise<void> {
  const request = resolveActiveSdkRequestByTarget(params.accountId, params.to);
  const sdkEmitter = resolveSdkEmitter(params.accountId);
  if (!request || !sdkEmitter) {
    throw new Error(`No active SDK message context for: ${params.to}`);
  }

  console.log(
    `[byai-channel] outbound sdk emit: accountId=${params.accountId || "default"} to=${params.to} sessionId=${request.sessionId} traceId=${request.traceId || ""} textLength=${params.text.length}`,
  );
  if (params.text) {
    await emitSdkChunkTracked(request.sessionKey, {
      emitter: sdkEmitter,
      sessionId: request.sessionId,
      traceId: request.traceId,
      text: params.text,
    });
  }
  const stateOptions = withActiveSdkRequestEmitMetadata(request, {
    eventType: EventType.APP_STREAM_RESPONSE,
  });
  await sdkEmitter.emitState(
    request.sessionId,
    request.traceId || "",
    buildSdkStateEvent("", stateOptions),
    stateOptions,
  );
}

// out-of-band 出站：没有 active SDK request 的 deliver（如 infra 注入），从 to 反解
// sessionId 后作为独立一条 emit。区别于 emitSdkText：不依赖 ActiveSdkRequest，
async function emitOutOfBandSdkText(params: {
  to: string;
  text: string;
}): Promise<boolean> {
  const sessionId = parseSessionIdFromTo(params.to);
  const agentId = parseAgentIdFromTo(params.to);
  if (!sessionId || !params.text) {
    return false;
  }
  console.log(
    `[byai-channel] outbound out-of-band emit: to=${params.to} sessionId=${sessionId} text=${params.text.length > 40 ? `${params.text.slice(0, 20)}...${params.text.slice(-20)}` : params.text}`,
  );
  await emitOutOfBandSdkEvent({
    sessionId,
    data: {
      choices: [
        {
          index: 0,
          finish_reason: "",
          delta: {
            content: params.text,
          }
        }
      ]
    },
    eventType: EventType.ANSWER_DELTA,
    params: {
      metadata: agentId ? { agentId: agentId.replace(/^baiying-agent-/, "") } : undefined,
    },
  });
  return true;
}

async function emitWebhookText(params: {
  to: string;
  text: string;
  replyToId?: string;
}): Promise<boolean> {
  const webhookContext = resolveWebhookContext(params.to);
  if (!webhookContext) {
    return false;
  }

  console.log(
    `[byai-channel] outbound webhook emit: to=${params.to} sessionId=${webhookContext.sessionId} requestId=${webhookContext.requestId} textLength=${params.text.length}`,
  );
  const success = await sendReplyCallback(
    webhookContext.callbackUrl,
    webhookContext.requestId,
    webhookContext.sessionId,
    params.text,
    { messageId: params.replyToId ?? undefined },
  );

  if (!success) {
    throw new Error(`Failed to send reply callback for: ${params.to}`);
  }

  return true;
}

export const byaiChannelPlugin: ChannelPlugin<ResolvedByaiAccount, ByaiProbe> = {
  id: CHANNEL_ID,
  meta: { ...meta, aliases: [...meta.aliases] },

  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
  },

  reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },

  configSchema: buildChannelConfigSchema(ByaiChannelConfigSchema),

  config: {
    listAccountIds: (cfg) => listByaiAccountIds(cfg),

    resolveAccount: (cfg, accountId) => resolveByaiAccount({ cfg, accountId }),

    defaultAccountId: (cfg) => resolveDefaultByaiAccountId(cfg),

    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: CHANNEL_ID,
        accountId,
        enabled,
        allowTopLevel: true,
      }),

    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: CHANNEL_ID,
        accountId,
        clearBaseFields: [
          "webhookPath",
          "streamEnabled",
          "forceReasoningStream",
          "sessionKeyPerSessionId",
          "dmPolicy",
          "allowFrom",
          "defaultTo",
        ],
      }),

    isConfigured: (account) => account.configured,

    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      dmPolicy: account.config.dmPolicy,
    }),

    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveByaiAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) => String(entry)),

    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((entry) => String(entry).trim()).filter(Boolean),

    resolveDefaultTo: ({ cfg, accountId }) =>
      resolveByaiAccount({ cfg, accountId }).config.defaultTo?.trim() || undefined,
  },

  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const channelCfg = cfg.channels?.[CHANNEL_ID] as
        | { accounts?: Record<string, unknown> }
        | undefined;
      const useAccountPath = Boolean(channelCfg?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.${CHANNEL_ID}.accounts.${resolvedAccountId}.`
        : `channels.${CHANNEL_ID}.`;

      return {
        policy: account.config.dmPolicy ?? "open",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint(CHANNEL_ID),
        normalizeEntry: (raw: string) => raw.trim().toLowerCase(),
      };
    },
  },

  messaging: {
    normalizeTarget: (raw: string) => {
      const trimmed = raw?.trim();
      if (!trimmed) return undefined;
      return trimmed.replace(/^byai[-_]?channel:/i, "").trim();
    },
    targetResolver: {
      looksLikeId: (raw: string) => {
        const trimmed = raw?.trim();
        if (!trimmed) return false;
        // 接受任何非空字符串作为 user ID
        return trimmed.length > 0;
      },
      hint: "<userId>",
    },
  },

  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId }) => {
      const account = resolveByaiAccount({ cfg, accountId });
      const allowFrom = account.config.allowFrom ?? [];
      return allowFrom
        .filter((id) => id !== "*")
        .map((id) => ({
          kind: "user" as const,
          id: String(id),
          name: String(id),
        }));
    },
    listGroups: async () => [],
  },

  outbound: {
    deliveryMode: "direct",
    chunker: null,
    chunkerMode: "text",
    textChunkLimit: 10000,

    sendText: async (ctx: ChannelOutboundContext) => {
      const sessionId = parseSessionIdFromTo(ctx.to);
      console.log("=======================sendText==========================");
      console.log({
        sessionId,
        to: ctx.to,
        accountId: ctx.accountId,
        replyToId: ctx.replyToId,
        text: ctx.text && ctx.text.length > 40 ? `${ctx.text.slice(0, 20)}...${ctx.text.slice(-20)}` : ctx.text,
      });

      const { to, accountId, replyToId } = ctx;
      const text = ctx.text ?? "";
      const okResult = {
        channel: CHANNEL_ID,
        messageId: replyToId ?? `byai-${Date.now()}`,
        ok: true,
      };
      // 抑制时不能伪造 messageId：core 会据此写 transcript 投递镜像并记为已送达。用
      // 与 extensions/slack/src/send.ts 一致的 "suppressed" 哨兵——它保留 identity（避免
      // core 把本次 deliver 判成 adapter_returned_no_identity 的模糊态），同时被平台 id
      // 统计跳过（src/infra/outbound/deliver-results.ts），不会冒充真实平台消息。
      const suppressedResult = {
        channel: CHANNEL_ID,
        messageId: "suppressed",
        ok: true,
      };
      if (await emitWebhookText({ to, text, replyToId })) {
        return okResult;
      }

      const resolvedAccountId = accountId ?? "";
      const request = resolveActiveSdkRequestByTarget(resolvedAccountId, to);

      // out-of-band：无 active request（infra 注入等）。整段作为独立一条 emit。
      // cron/heartbeat 在源头不走 deliver，不会到达这里。
      if (!request) {
        console.log("[byai-channel] ready to emit out-of-band text, sessionId: ", sessionId);
        await emitOutOfBandSdkText({ to, text });
        return okResult;
      }
      // in-band：sendText 送来的既可能是已由 assistant 流推过的文本回声（重复，须抑制），
      // 也可能是没有对应流式输出的全新可见内容——message 工具 action=send，以及 parent 只回
      // NO_REPLY 时 core 直投的 subagent 原文。判据是账本而非来源：已推给过前端的才算重复，
      // 其余一律投递，宁可多发也不丢内容。
      if (deliveredAnswerTextCovers(request.sessionKey, text)) {
        return suppressedResult;
      }
      const sdkEmitter = resolveSdkEmitter(resolvedAccountId);
      if (!sdkEmitter) {
        return suppressedResult;
      }
      const emitted = await emitSdkChunkTracked(request.sessionKey, {
        emitter: sdkEmitter,
        sessionId: request.sessionId,
        traceId: request.traceId,
        text,
        options: {
          eventType: EventType.ANSWER_DELTA,
          parentMessageId: request.parentMessageId,
          messageId: generateRandomId(),
        },
      });
      if (emitted) {
        // 自成一组记账：本条没有对应的流式输出，只有记下来，core 因重试或另一路 deliver 再送
        // 同一份文本时才会被判成重复。
        recordPushedAnswerText(request.sessionKey, text);
      }
      return okResult;
    },

    sendMedia: async (ctx: ChannelOutboundContext) => {
      console.log("=======================sendMedia==========================");
      console.log(ctx.text);
      const { to, text, mediaUrl, accountId } = ctx;
      const combined = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
      const handled = await emitWebhookText({
        to,
        text: combined,
      });
      if (!handled) {
        await emitSdkText({ accountId, to, text: combined });
      }
      return {
        channel: CHANNEL_ID,
        messageId: `byai-${Date.now()}`,
        ok: true,
      };
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      lastStopAt: null,
      lastError: null,
    },

    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastInboundAt: snapshot.lastInboundAt ?? null,
      lastOutboundAt: snapshot.lastOutboundAt ?? null,
      lastError: snapshot.lastError ?? null,
      webhookPath: "/webhook/byai-channel",
    }),

    probeAccount: async () => ({
      ok: true,
      listening: true,
    }),

    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const { account, cfg, log, abortSignal } = ctx;

      // 启动任务列表
      const startupTasks: Array<Promise<void>> = [];

      // ============ SDK 模式（Gateway SDK TS，通过 SDK App 抽象） ============
      let stopSdk: (() => Promise<void>) | null = null;
      let sdkApp: ByaiSdkApp | null = null;
      log?.info?.(`[${account.accountId}] ${CHANNEL_ID} SDK mode enabled, starting...`);

      try {
        const { ByaiSdkApp: SdkApp } = await import("./sdk-app.js");
        sdkApp = new SdkApp({
          account,
          cfg,
          log,
        });

        const sdkStartPromise = sdkApp
          .start()
          .then(() => {
            log?.info?.(
              `[${account.accountId}] ${CHANNEL_ID} SDK app started successfully (gateway_sdk_ts)`,
            );
          })
          .catch((err) => {
            log?.error?.(
              `[${account.accountId}] ${CHANNEL_ID} SDK app failed to start: ${String(err)}`,
            );
          });

        startupTasks.push(sdkStartPromise);

        stopSdk = async () => {
          if (sdkApp) {
            await sdkApp.stop();
            sdkApp = null;
          }
        };
      } catch (err) {
        log?.error?.(
          `[${account.accountId}] ${CHANNEL_ID} Failed to initialize SDK (gateway_sdk_ts): ${String(err)}`,
        );
      }

      // 组合停止函数
      const stop = () => {
        // 停止 SDK
        if (stopSdk) {
          stopSdk();
          stopSdk = null;
        }
      };

      // 如果 abortSignal 被触发，自动停止
      if (abortSignal) {
        abortSignal.addEventListener("abort", stop, { once: true });
      }

      // 等待所有启动任务完成
      if (startupTasks.length > 0) {
        await Promise.all(startupTasks);
      }

      // 关键：返回一个永远不解析的 Promise，直到 abortSignal 被触发
      if (abortSignal) {
        await new Promise<void>((resolve) => {
          abortSignal!.addEventListener("abort", () => resolve(), { once: true });
        });
      } else {
        await new Promise(() => {});
      }

      return { stop };
    },
  },
};
