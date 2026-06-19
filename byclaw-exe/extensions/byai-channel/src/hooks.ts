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
} from "./session-context.js";
import {
  cancelActiveSdkCompletionCheck,
  scheduleActiveSdkCompletionCheck,
} from "./sdk-session-completion.js";
import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";
import type { Language, PluginHookAgentContext, PluginHookAgentEndEvent } from "./types.js";
import {
  BYAI_USER_MD_SECTION_END,
  BYAI_USER_MD_SECTION_START,
  buildChannelExtensionPrompt,
  buildCompactionNoticeText,
  buildLanguagePrompt,
  buildMaxTokenErrorText,
  buildSessionFilesPrompt,
  buildUserMdByaiUserSection,
  buildUserMdReloadPrompt,
  resolveInboundLanguage,
} from "./i18n.js";
import { getByaiRuntime } from "./runtime.js";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
import { takePromptInjectionSnapshot } from "./prompt-injection-snapshot.js";
import {
  consumeWorkspaceReloadHint,
  markWorkspaceReloadHint,
} from "./workspace-reload-hints.js";
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

  api.on("agent_end", (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => {
    api.logger.info(
      `agent_end hook emits, runId=${ctx.runId}, success=${event.success}, error=${event.error}`,
    );
    const { runId } = ctx;
    if (!runId) {
      return;
    }
    const language = resolveActiveSdkRunBinding(runId)?.request?.language;
    const resolve = getAgentRunEndPromiseResolver(runId);
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
  });
}
