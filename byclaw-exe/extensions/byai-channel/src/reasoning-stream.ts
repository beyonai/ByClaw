import crypto from "node:crypto";
import { updateSessionStore } from "openclaw/plugin-sdk/config-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
import type { ResolvedByaiAccount, ByaiSdkInboundMessage } from "./types.js";
import { getByaiRuntime } from "./runtime.js";

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
  // Leave a single decision point here so future business rules can
  // selectively enable/disable forced reasoning stream.
  return params.account.config.forceReasoningStream ?? true;
}

export async function ensureSessionReasoningStream(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
}): Promise<{ changed: boolean; created: boolean; healed: boolean; sessionId: string }> {
  const runtime = getByaiRuntime();
  const effectiveAgentId = resolveAgentIdFromSessionKey(params.sessionKey);
  const storePath = runtime.channel.session.resolveStorePath(params.cfg.session?.store, {
    agentId: effectiveAgentId,
  });
  let changed = false;
  let created = false;
  let healed = false;
  let sessionId = "";
  await updateSessionStore(storePath, (store) => {
    const existing = store[params.sessionKey] as Record<string, unknown> | undefined;
    const existingSessionId =
      typeof existing?.sessionId === "string" && existing.sessionId.trim()
        ? existing.sessionId.trim()
        : "";
    const nextSessionId = existingSessionId || crypto.randomUUID();
    const needsReasoning = existing?.reasoningLevel !== "stream";
    const needsSessionId = !existingSessionId;
    sessionId = nextSessionId;
    if (!needsReasoning && !needsSessionId) {
      return;
    }
    store[params.sessionKey] = {
      ...(existing ?? {}),
      sessionId: nextSessionId,
      reasoningLevel: "stream",
      chatType:
        typeof existing?.chatType === "string" && existing.chatType.trim()
          ? existing.chatType
          : "direct",
      updatedAt: Date.now(),
    };
    changed = true;
    created = !existing;
    healed = Boolean(existing) && needsSessionId;
  });
  return { changed, created, healed, sessionId };
}
