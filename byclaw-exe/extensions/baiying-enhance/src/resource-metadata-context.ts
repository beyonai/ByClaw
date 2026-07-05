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
  resources?: BaiyingAssociatedResource[];
  sessionKey?: string;
  /** Gateway/channel session id for MCP X-Session-Id (per-request isolation). */
  channelSessionId?: string;
  /** Gateway/channel trace id passthrough for DOC async routing. */
  channelTraceId?: string;
  /** Langfuse/OTel trace id used to keep downstream callAgent spans in the same trace. */
  langfuseTraceId?: string;
  /** Current Langfuse observation id; forwarded as parent observation for downstream callAgent spans. */
  langfuseParentObservationId?: string;
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

  const serializeResourceItem = (item: BaiyingAssociatedResource): Record<string, unknown> => ({
    resourceId: item.resourceId,
    resourceName: item.resourceName,
    resourceType: item.resourceType,
    ...(item.resourceBizType ? { resourceBizType: item.resourceBizType } : {}),
    ...(item.resourceCode ? { resourceCode: item.resourceCode } : {}),
    ...(item.ontologyBaseCode ? { ontologyBaseCode: item.ontologyBaseCode } : {}),
    ...(item.resourceDesc ? { resourceDesc: item.resourceDesc } : {}),
    ...(item.resourceSourcePkId ? { resourceSourcePkId: item.resourceSourcePkId } : {}),
    ...(item.systemCode ? { systemCode: item.systemCode } : {}),
    ...(item.implType ? { implType: item.implType } : {}),
    ...(item.hostType ? { hostType: item.hostType } : {}),
    ...(item.parentResourceId ? { parentResourceId: item.parentResourceId } : {}),
    ...(item.raw ? item.raw : {}),
  });
  const resource = params.resource
    ? serializeResourceItem(params.resource)
    : null;
  const selectedResources = Array.isArray(params.resources) && params.resources.length > 0
    ? params.resources.map(serializeResourceItem)
    : resource
      ? [resource]
      : [];
  const availableResources = (params.agent.associatedResources ?? []).map(serializeResourceItem);

  const channelSid = nonEmpty(params.channelSessionId);
  const channelTraceId = nonEmpty(params.channelTraceId);
  const langfuseTraceId = nonEmpty(params.langfuseTraceId);
  const langfuseParentObservationId = nonEmpty(params.langfuseParentObservationId);
  const sessionKey = nonEmpty(params.sessionKey);
  const out: Record<string, unknown> = {
    root_agent: rootAgent,
    selected_resource: resource,
    selected_resources: selectedResources,
    available_resources: availableResources,
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
  if (langfuseParentObservationId) {
    out.langfuse_parent_observation_id = langfuseParentObservationId;
    out.langfuseParentObservationId = langfuseParentObservationId;
  }
  if (langfuseTraceId) {
    out.langfuse_trace_id = langfuseTraceId;
    out.langfuseTraceId = langfuseTraceId;
  }
  return out;
}
