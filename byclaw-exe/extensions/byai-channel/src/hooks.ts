import { EventType, SseReasonMessageType } from "@byclaw/by-framework";
import { createRedis } from "@byclaw/by-framework";
import { enqueueAfterAgentEvents } from "./agent-event-serial.js";
import {
  emitSdkChunkTracked,
  markActiveSdkOutboundSent,
  markActiveSdkOutboundSending,
  resolveActiveSdkRequestBySessionKey,
  resolveActiveSdkRequestByTarget,
  resolveSdkEmitter,
  getSessionPathBySessionId,
} from "./session-context.js";
import {
  cancelActiveSdkCompletionCheck,
  scheduleActiveSdkCompletionCheck,
} from "./sdk-session-completion.js";
import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";
import type { Language } from "./types.js";
import {
  BYAI_USER_MD_SECTION_END,
  BYAI_USER_MD_SECTION_START,
  buildChannelExtensionPrompt,
  buildLanguagePrompt,
  buildSessionFilesPrompt,
  buildUserMdByaiUserSection,
  buildUserMdReloadPrompt,
  resolveInboundLanguage,
} from "./i18n.js";
import { getByaiRuntime } from "./runtime.js";
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

const pendingWorkspaceReloadHints = new Set<string>();

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
  pendingWorkspaceReloadHints.add(path.resolve(workspaceDir));
  api.logger.info(`byai-channel synced USER.md: ${userMdPath}`);
}

export function registerByaiHooks(api: OpenClawPluginApi): void {
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
    let hintLanguage = resolveInboundLanguage(undefined).language;
    if (ctx.sessionKey) {
      const earlyRequest = resolveActiveSdkRequestBySessionKey(ctx.sessionKey);
      if (earlyRequest?.language) {
        hintLanguage = earlyRequest.language;
      }
    }
    void syncWorkspaceUserMd(api, ctx.workspaceDir, hintLanguage).catch((err) => {
      api.logger.warn(`byai-channel sync USER.md failed: ${String(err)}`);
    });
    const sections: string[] = [];
    const normalizedWorkspace = ctx.workspaceDir ? path.resolve(ctx.workspaceDir) : "";
    if (normalizedWorkspace && pendingWorkspaceReloadHints.has(normalizedWorkspace)) {
      sections.push(buildUserMdReloadPrompt(hintLanguage));
      pendingWorkspaceReloadHints.delete(normalizedWorkspace);
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
    api.logger.info(`before_prompt_build hook emits, sessionId=${ctx.sessionId}, appendSystemContext=${appendSystemContext}`);
    return {
      appendSystemContext,
    };
  });

  /*
  api.on("before_message_write", (event: BeforeMessageWriteEvent, ctx: BeforeMessageWriteContext) => {
    const sessionKey = event?.sessionKey ?? ctx?.sessionKey;
    if (!sessionKey) {
      return;
    }
    const request = resolveActiveSdkRequestBySessionKey(sessionKey);
    if (!request) {
      return;
    }
    void enqueueAfterAgentEvents(
      api,
      `before_message_write emit sessionKey=${sessionKey}`,
      async () => {
        const activeRequest = resolveActiveSdkRequestBySessionKey(sessionKey) ?? request;
        const sdkEmitter = resolveSdkEmitter(activeRequest.accountId);
        if (!sdkEmitter) {
          return;
        }
        const payload = buildBeforeMessageWritePayload(event?.message, {
          sessionKey,
          agentId: event?.agentId ?? ctx?.agentId,
        });
        if (!payload) {
          return;
        }
        await emitSdkChunkTracked({
          emitter: sdkEmitter,
          sessionId: activeRequest.sessionId,
          traceId: activeRequest.traceId,
          text: `写入消息: ${payload.role}`,
          options: {
            messageId: payload.messageId,
            parentMessageId: "-1",
            eventType: EventType.REASONING_LOG_DELTA,
            contentType: SseReasonMessageType.think_title,
          },
        });
        await emitSdkChunkTracked({
          emitter: sdkEmitter,
          sessionId: activeRequest.sessionId,
          traceId: activeRequest.traceId,
          text: payload.text,
          options: {
            messageId: `${payload.messageId}-payload`,
            parentMessageId: payload.messageId,
            eventType: EventType.REASONING_LOG_DELTA,
            contentType: SseReasonMessageType.think_code_result,
          },
        });
      },
    );
  });
  */

  api.on("message_sending", (event: MessageSendingEvent, ctx: MessageHookContext) => {
    if (ctx?.channelId !== "byai-channel") {
      return;
    }
    const request = resolveActiveSdkRequestByTarget(ctx?.accountId ?? "default", event?.to ?? "");
    if (!request) {
      return;
    }
    void enqueueAfterAgentEvents(
      api,
      `message_sending sessionKey=${request.sessionKey}`,
      async () => {
        const activeRequest = markActiveSdkOutboundSending(ctx?.accountId, event?.to);
        if (!activeRequest) {
          return;
        }
        cancelActiveSdkCompletionCheck(activeRequest.sessionKey);
      },
    );
  });

  api.on("message_sent", (event: MessageSendingEvent & { success?: boolean; error?: string }, ctx: MessageHookContext) => {
    if (ctx?.channelId !== "byai-channel") {
      return;
    }
    const request = resolveActiveSdkRequestByTarget(ctx?.accountId ?? "default", event?.to ?? "");
    if (!request) {
      return;
    }
    void enqueueAfterAgentEvents(
      api,
      `message_sent sessionKey=${request.sessionKey}`,
      async () => {
        const activeRequest = markActiveSdkOutboundSent(ctx?.accountId, event?.to);
        if (!activeRequest) {
          return;
        }
        scheduleActiveSdkCompletionCheck(
          api,
          activeRequest.sessionKey,
          `message_sent:${event?.success === false ? "failed" : "ok"}`,
        );
      },
    );
  });
}

function buildBeforeMessageWritePayload(
  message: unknown,
  ctx: {
    sessionKey: string;
    agentId?: string;
  },
): { role: string, text: string; messageId: string } | null {
  const role = typeof (message as { role?: unknown })?.role === "string"
    ? String((message as { role?: string }).role)
    : "unknown";
  const content = extractMessageContent(message);
  if (!content) {
    return null;
  }
  const summary = JSON.stringify(
    {
      role,
      content,
    },
    null,
    2,
  );
  return {
    role,
    text: JSON.stringify(summary, null, 2),
    messageId: `before_message_write:${ctx.sessionKey}:${Date.now()}`,
  };
}

function extractMessageContent(message: unknown): string {
  const rawContent = (message as { content?: unknown })?.content;
  if (typeof rawContent === "string") {
    return rawContent.trim();
  }
  if (!Array.isArray(rawContent)) {
    return "";
  }
  const texts = rawContent
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const candidate = item as { type?: unknown; text?: unknown };
      if (candidate.type !== "text" || typeof candidate.text !== "string") {
        return "";
      }
      return candidate.text.trim();
    })
    .filter(Boolean);
  return texts.join("\n").trim();
}
