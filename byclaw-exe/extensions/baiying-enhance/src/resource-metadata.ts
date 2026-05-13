import type { AdaptedManagedAgent } from "./agent-adapter.js";
import {
  runBaiyingExecutor as runInProcessExecutor,
  type DocDeltaCallback,
} from "./executor/index.js";
import type { BaiyingEnhanceLogger } from "./executor/debug-channel.js";
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
}): Record<string, unknown> {
  const rootAgent: Record<string, unknown> = {
    resourceId: params.agent.sourceKey,
    resourceName: params.agent.listEntry.name ?? params.agent.agentId,
  };
  if (params.agent.integrationType) {
    rootAgent.integrationType = params.agent.integrationType;
  }
  if (params.agent.agentSseUrl) {
    rootAgent.agentSseUrl = params.agent.agentSseUrl;
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

/**
 * Runs the in-process TypeScript port of `skills/baiying/executor.py`.
 *
 * The original `executor.py` CLI is no longer spawned as a subprocess; instead
 * the logic lives under `src/executor/` split into one file per resource type.
 *
 * `executorPath` is retained as the plugin's public entry point identifier
 * for backwards compatibility: it is interpreted as the path to the
 * `skills/baiying/resources` directory (or the path to the legacy
 * `executor.py`, whose sibling `resources/` directory is used automatically).
 */
export async function runBaiyingExecutor(params: {
  executorPath: string;
  resourceId: string;
  resourceType: string;
  payload: Record<string, unknown>;
  metadataOnly?: boolean;
  /** Streaming hook propagated to DOC sync calls (ignored elsewhere). */
  onDelta?: DocDeltaCallback;
  /** Cancellation signal; forwarded to DOC polling. */
  signal?: AbortSignal;
  /** Host logger; forwarded so request logs appear in OpenClaw logs. */
  logger?: BaiyingEnhanceLogger;
}): Promise<unknown> {
  const resourcesDir = resolveResourcesDir(params.executorPath);
  return await runInProcessExecutor({
    resourcesDir,
    resourceId: params.resourceId,
    resourceType: params.resourceType,
    payload: (params.payload ?? {}) as Record<string, unknown>,
    metadataOnly: params.metadataOnly,
    onDelta: params.onDelta,
    signal: params.signal,
    logger: params.logger,
  });
}

/**
 * Accepts either the `skills/baiying/resources` directory directly, or the
 * legacy path to `skills/baiying/executor.py` (in which case the sibling
 * `resources/` directory is used).
 */
function resolveResourcesDir(input: string): string {
  if (!input) return input;
  if (input.toLowerCase().endsWith(".py")) {
    const lastSlash = Math.max(input.lastIndexOf("/"), input.lastIndexOf("\\"));
    const dir = lastSlash >= 0 ? input.slice(0, lastSlash) : ".";
    return `${dir}/resources`;
  }
  return input;
}
