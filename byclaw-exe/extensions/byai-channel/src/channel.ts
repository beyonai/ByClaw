import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import { EventType } from "@byclaw/by-framework";
import { ByaiChannelConfigSchema } from "./config-schema.js";
import { listByaiAccountIds, resolveByaiAccount, resolveDefaultByaiAccountId } from "./config.js";
import type { ResolvedByaiAccount, ByaiProbe } from "./types.js";
import { sendReplyCallback } from "./webhook-handler.js";
import { ByaiSdkApp } from "./sdk-app.js";
import {
  emitSdkChunkTracked,
  resolveActiveSdkRequestByTarget,
  resolveSdkEmitter,
  resolveWebhookContext,
} from "./session-context.js";

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
    await emitSdkChunkTracked({
      emitter: sdkEmitter,
      sessionId: request.sessionId,
      traceId: request.traceId,
      text: params.text,
      options: {},
    });
  }
  await sdkEmitter.emitState(
    request.sessionId,
    request.traceId || "",
    "",
    {
      eventType: EventType.APP_STREAM_RESPONSE,
    },
  );
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

    sendText: async ({ to, text, accountId, replyToId }) => {
      if (await emitWebhookText({ to, text, replyToId })) {
        return {
          channel: CHANNEL_ID,
          messageId: replyToId ?? `byai-${Date.now()}`,
          ok: true,
        };
      }

      // SDK 场景下不直接依赖 outbound.sendText 收尾，原因见 agent-event.ts handleLifecycleEvent 注释。
      // console.log(`outbound sendText`, text)
      // await emitSdkText({ accountId, to, text });

      return {
        channel: CHANNEL_ID,
        messageId: replyToId ?? `byai-${Date.now()}`,
        ok: true,
      };
    },

    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
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
        sdkApp = new ByaiSdkApp({
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
