import { buildAgentSessionKey, resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";

export const BYAI_CHANNEL_ID = "byai-channel" as const;

export type ByaiResolvedRouting = {
  sessionKey: string;
  agentId: string;
  channel: string;
  accountId: string;
};

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

export function normalizeByaiAgentId(rawAgentId: string): string {
  const trimmed = rawAgentId.trim();
  if (/^\d+$/.test(trimmed)) {
    return `baiying-agent-${trimmed}`;
  }
  return trimmed;
}

export function resolveSdkTargetAgentId(
  routingAgentId: string,
  extraPayload: {
    agent_id?: string;
    agent_code?: string;
  },
): string {
  if (extraPayload.agent_id) {
    return normalizeByaiAgentId(extraPayload.agent_id);
  }
  if (extraPayload.agent_code) {
    return extraPayload.agent_code;
  }
  return routingAgentId;
}

export function resolveByaiSessionKey(params: {
  routing: ByaiResolvedRouting;
  targetAgentId: string;
  sessionId: string;
  userId?: string;
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

  const peerId = params.sessionId.trim() || params.userId?.trim() || params.sessionId;
  return buildAgentSessionKey({
    agentId: params.targetAgentId,
    channel: params.routing.channel,
    accountId: params.routing.accountId,
    peer: { kind: "direct", id: peerId },
    dmScope: "per-peer",
  });
}

export function resolveByaiSessionIdFromSessionKey(sessionKey: string | undefined | null): string {
  const raw = sessionKey?.trim() ?? "";
  const rest = raw.startsWith("agent:")
    ? raw.split(":").slice(2).join(":")
    : raw;
  if (!rest || rest === "main") {
    return "";
  }
  const parts = rest.split(":").filter(Boolean);
  const directIndex = parts.lastIndexOf("direct");
  if (directIndex >= 0) {
    return parts.slice(directIndex + 1).join(":").trim();
  }
  return rest.trim();
}

export function resolveByaiAgentIdFromSessionKey(sessionKey: string | undefined | null): string {
  const raw = sessionKey?.trim() ?? "";
  const agentId = resolveAgentIdFromSessionKey(raw);
  return agentId.replace("baiying-agent-", "");
}
