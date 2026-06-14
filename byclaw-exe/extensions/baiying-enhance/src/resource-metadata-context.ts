import type { AdaptedManagedAgent } from "./agent-adapter.js";
import type { BaiyingAssociatedResource } from "./types.js";

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function compactText(value: unknown, maxLen = 140): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  if (compact.length <= maxLen) {
    return compact;
  }
  return `${compact.slice(0, maxLen - 1)}...`;
}

export function buildExecutorResourceContext(params: {
  agent: AdaptedManagedAgent;
  resource?: BaiyingAssociatedResource;
  sessionKey?: string;
  /** Gateway/channel session id for MCP X-Session-Id (per-request isolation). */
  channelSessionId?: string;
  /** Gateway/channel trace id passthrough for DOC async routing. */
  channelTraceId?: string;
  language?: string;
  beyondToken?: string;
  parentSessionKey?: string;
}): Record<string, unknown> {
  const rootAgent: Record<string, unknown> = {
    resourceId: params.agent.sourceKey,
    resourceName: params.agent.listEntry.name ?? params.agent.agentId,
    resourceDesc: params.agent.resourceDesc ?? params.agent.agentId,
  };
  if (params.agent.integrationType) {
    rootAgent.integrationType = params.agent.integrationType;
  }
  if (params.agent.agentSseUrl) {
    rootAgent.agentSseUrl = params.agent.agentSseUrl;
  }
  if (params.agent.agentHomeUrl) {
    rootAgent.agentHomeUrl = params.agent.agentHomeUrl;
  }

  const resource = params.resource
    ? {
        resourceId: params.resource.resourceId,
        resourceName: params.resource.resourceName,
        resourceType: params.resource.resourceType,
        ...(params.resource.resourceBizType
          ? { resourceBizType: params.resource.resourceBizType }
          : {}),
        ...(params.resource.resourceCode ? { resourceCode: params.resource.resourceCode } : {}),
        ...(params.resource.resourceDesc ? { resourceDesc: params.resource.resourceDesc } : {}),
        ...(params.resource.resourceSourcePkId
          ? { resourceSourcePkId: params.resource.resourceSourcePkId }
          : {}),
        ...(params.resource.systemCode ? { systemCode: params.resource.systemCode } : {}),
        ...(params.resource.implType ? { implType: params.resource.implType } : {}),
        ...(params.resource.hostType ? { hostType: params.resource.hostType } : {}),
        ...(params.resource.parentResourceId
          ? { parentResourceId: params.resource.parentResourceId }
          : {}),
        ...(params.resource.raw ? params.resource.raw : {}),
      }
    : null;

  const channelSid = nonEmpty(params.channelSessionId);
  const channelTraceId = nonEmpty(params.channelTraceId);
  const sessionKey = nonEmpty(params.sessionKey);
  const out: Record<string, unknown> = {
    root_agent: rootAgent,
    selected_resource: resource,
    session_key: sessionKey,
    requester_session_key: sessionKey,
    parent_session_key: params.parentSessionKey,
    language: params.language,
    beyondToken: params.beyondToken,
  };
  if (channelSid || channelTraceId) {
    if (channelSid) {
      out.channel_session_id = channelSid;
    }
    if (channelTraceId) {
      out.channel_trace_id = channelTraceId;
    }
    const openclawHeaders: Record<string, string> = {};
    if (channelSid) {
      openclawHeaders["X-Session-Id"] = channelSid;
    }
    if (channelTraceId) {
      openclawHeaders["channel-trace-id"] = channelTraceId;
    }
    out.openclaw_mcp_headers = openclawHeaders;
  }
  return out;
}
