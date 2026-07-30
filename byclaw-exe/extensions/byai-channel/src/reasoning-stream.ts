import crypto from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
import type { ResolvedByaiAccount, ByaiSdkInboundMessage } from "./types.js";
import { getByaiRuntime } from "./runtime.js";

/** 判断当前账号是否需要强制启用思考过程的流式输出。 */
export function shouldForceReasoningStream(params: {
  message: ByaiSdkInboundMessage;
  account: ResolvedByaiAccount;
  sessionKey: string;
  agentId?: string;
  cfg: OpenClawConfig;
}): boolean {
  void params.message;
  void params.sessionKey;
  void params.agentId;
  void params.cfg;
  // 将判断集中在这里，方便后续按消息、Agent 或账号增加更细粒度的业务规则。
  return params.account.config.forceReasoningStream ?? true;
}

/**
 * 确保指定会话启用了 reasoning stream，并为损坏或首次创建的会话补齐 sessionId。
 *
 * 会话存储必须通过 OpenClaw 注入的 Plugin Runtime 访问，并使用原子的
 * patchSessionEntry 更新单条记录。不能直接依赖 config-runtime 的运行时导出；
 * 后者曾导致消息进入 channel 后、实际分发给 Agent 前抛出
 * `updateSessionStore is not a function`。
 */
export async function ensureSessionReasoningStream(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
}): Promise<{ changed: boolean; created: boolean; healed: boolean; sessionId: string }> {
  const runtime = getByaiRuntime();
  const sessionApi = runtime.agent?.session;
  if (!sessionApi?.patchSessionEntry || !sessionApi.resolveStorePath) {
    throw new Error("OpenClaw runtime session patch API is unavailable");
  }
  const effectiveAgentId = resolveAgentIdFromSessionKey(params.sessionKey);
  const storePath = sessionApi.resolveStorePath(params.cfg.session?.store, {
    agentId: effectiveAgentId,
  });
  let changed = false;
  let created = false;
  let healed = false;
  let sessionId = "";
  const fallbackSessionId = crypto.randomUUID();
  await sessionApi.patchSessionEntry({
    storePath,
    sessionKey: params.sessionKey,
    fallbackEntry: {
      sessionId: fallbackSessionId,
      updatedAt: Date.now(),
    },
    update: (existing: Record<string, unknown>) => {
      const isFallbackEntry = existing.sessionId === fallbackSessionId;
      const existingSessionId =
        typeof existing.sessionId === "string" && existing.sessionId.trim()
          ? existing.sessionId.trim()
          : "";
      const nextSessionId = existingSessionId || fallbackSessionId;
      const needsReasoning = existing.reasoningLevel !== "stream";
      const needsSessionId = !existingSessionId;
      sessionId = nextSessionId;
      if (!needsReasoning && !needsSessionId) {
        return null;
      }
      changed = true;
      created = isFallbackEntry;
      healed = !isFallbackEntry && needsSessionId;
      return {
        sessionId: nextSessionId,
        reasoningLevel: "stream",
        chatType:
          typeof existing.chatType === "string" && existing.chatType.trim()
            ? existing.chatType
            : "direct",
        updatedAt: Date.now(),
      };
    },
  });
  return { changed, created, healed, sessionId };
}
