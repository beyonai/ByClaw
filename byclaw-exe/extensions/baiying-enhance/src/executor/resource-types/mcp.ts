import type { Capability, Dict, ExecutorFailure, ExecutorResponse } from "../types.js";
import { asString, isRecord } from "../types.js";
import type { AuthContext } from "../auth.js";
import { applyEnvAuthOverrides, ensureMcpIdentityHeaders, mergeAuthHeaders } from "../auth.js";
import { makeError } from "../errors.js";
import { extractJsonRpcPayload, postJson } from "../http.js";
import { buildOntologyMcpHeaders, debugMcpSessionHeaders } from "../ontology-headers.js";
import { resolveChildAction } from "../resolve-action.js";
import { validateParameters } from "../schema.js";
import { logBaiyingRequest, type BaiyingEnhanceLogger } from "../debug-channel.js";
import {
  docCallMode,
  docSyncIntervalSec,
  docSyncTimeoutSec,
  resolveLangfuseParentObservationId,
  resolveLangfuseTraceId,
  resolveDocChannelTraceId,
  resolveDocSessionId,
} from "../doc-shared.js";
import { executeViaCallAgent } from "../call-agent.js";
import { runLegacySseJsonRpcSequence } from "../mcp-legacy-sse.js";
import { getCommonGatewayMetadata } from "../doc-shared.js";

const ONTOLOGY_RESOURCE_TYPES = new Set(["SCENE", "VIEW", "OBJECT"]);

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(asString).filter(Boolean)));
  }
  const text = asString(value);
  return text ? [text] : [];
}

function ontologyCallKey(resourceType: string): "call_scene_ids" | "call_view_ids" | "call_object_ids" {
  if (resourceType === "OBJECT") return "call_object_ids";
  if (resourceType === "SCENE") return "call_scene_ids";
  return "call_view_ids";
}

function normalizeOntologyResourceRecord(value: unknown): Dict | null {
  if (!isRecord(value)) return null;
  const type = (
    asString(value.resource_biz_type) ||
    asString(value.resourceBizType) ||
    asString(value.resourceType) ||
    asString(value.resource_type)
  ).toUpperCase();
  if (!ONTOLOGY_RESOURCE_TYPES.has(type)) return null;
  const code =
    asString(value.resourceCode) ||
    asString(value.resource_code) ||
    asString(value.code) ||
    asString(value.resourceId) ||
    asString(value.resource_id);
  if (!code) return null;
  const ontologyBaseCode =
    asString(value.ontologyBaseCode) ||
    asString(value.ontology_base_code);
  return {
    ontology_base_code: ontologyBaseCode,
    resource_code: code,
    resource_biz_type: type,
  };
}

function ontologyResourceKey(item: Dict): string {
  return [
    (asString(item.resource_biz_type) || asString(item.resource_type)).toUpperCase(),
    asString(item.ontology_base_code),
    asString(item.resource_code),
  ].join("\u0000");
}

function addOntologyResource(target: Dict[], value: unknown): void {
  const normalized = normalizeOntologyResourceRecord(value);
  if (!normalized) return;
  if (target.some((item) => ontologyResourceKey(item) === ontologyResourceKey(normalized))) {
    return;
  }
  target.push(normalized);
}

function ontologyResourcesFromContext(resourceContext: unknown): {
  selected: Dict[];
  available: Dict[];
} {
  if (!isRecord(resourceContext)) return { selected: [], available: [] };
  const selected: Dict[] = [];
  const available: Dict[] = [];
  if (Array.isArray(resourceContext.selected_resources)) {
    for (const item of resourceContext.selected_resources) addOntologyResource(selected, item);
  }
  addOntologyResource(selected, resourceContext.selected_resource);
  if (Array.isArray(resourceContext.available_resources)) {
    for (const item of resourceContext.available_resources) addOntologyResource(available, item);
  }
  return { selected, available };
}

function findOntologyResourceByCode(items: Dict[], resourceType: string, code: string): Dict | undefined {
  return items.find(
    (item) =>
      (asString(item.resource_biz_type) || asString(item.resource_type)).toUpperCase() === resourceType &&
      asString(item.resource_code) === code,
  );
}

function summarizeOntologyResources(items: Dict[]): {
  bases: string[];
  groups: Dict[];
} {
  const groupMap = new Map<string, Dict>();
  for (const item of items) {
    const base = asString(item.ontology_base_code);
    if (!base) continue;
    const type = (asString(item.resource_biz_type) || asString(item.resource_type)).toUpperCase();
    const code = asString(item.resource_code);
    if (!code) continue;
    const group = groupMap.get(base) ?? {
      ontology_base_code: base,
      call_scene_ids: [],
      call_view_ids: [],
      call_object_ids: [],
    };
    const key = ontologyCallKey(type);
    const bucket = Array.isArray(group[key]) ? (group[key] as string[]) : [];
    if (!bucket.includes(code)) bucket.push(code);
    group[key] = bucket;
    groupMap.set(base, group);
  }
  return {
    bases: Array.from(groupMap.keys()),
    groups: Array.from(groupMap.values()),
  };
}

/** Mirror of `BaiYingExecutor._execute_mcp`. */
export async function executeMcp(params: {
  capability: Capability;
  action: string;
  parameters: Dict;
  forwardHeaders?: Record<string, string>;
  authContext: AuthContext;
  session?: string;
  timeoutMs?: number;
  logger?: BaiyingEnhanceLogger;
}): Promise<ExecutorResponse> {
  const { capability } = params;
  const resourceType = String(capability.resource_type ?? "").trim().toUpperCase();
  if (resourceType === "OBJECT" || resourceType === "VIEW" || resourceType === "SCENE") {
    return executeOntologyResourceViaCallAgent({
      capability,
      parameters: params.parameters,
      logger: params.logger,
    });
  }

  const mcp = isRecord(capability.mcp) ? (capability.mcp as Dict) : {};
  const serverUrl = asString(mcp.server_url);
  const transferType = normalizeMcpTransferType(
    mcp.transfer_type ?? mcp.transferType ?? mcp.mcpType ?? mcp.mcp_type,
  );
  if (!serverUrl) {
    return makeError("MCP_SERVER_NOT_FOUND", "MCP Server URL not found");
  }

  const resourceId = String(capability.metadata?.resource_id ?? capability.name ?? "");
  const resolved = resolveChildAction({
    parentResourceId: resourceId,
    parentResourceType: String(capability.resource_type ?? "MCP"),
    action: params.action,
    items: Array.isArray(mcp.tools) ? (mcp.tools as unknown[]) : [],
    actionType: "MCP_TOOL",
  });
  if (resolved.error) return resolved.error;
  const toolInfo = resolved.item as Dict;

  const validation = validateParameters({
    actionName: String(toolInfo.name),
    resourceId,
    resourceType: String(capability.resource_type ?? "MCP"),
    parameters: params.parameters,
    rawSchema: toolInfo.input_schema,
  });
  if (validation) return validation;

  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolInfo.name, arguments: params.parameters },
  };

  const { headers: ontologyHeaders, error: ontologyError } = buildOntologyMcpHeaders(capability);
  if (ontologyError) return ontologyError;

  const { headers } = mergeAuthHeaders({
    baseHeaders: {
      Accept:
        transferType === "sse" ? "text/event-stream" : "application/json, text/event-stream",
      "Content-Type": "application/json",
      "User-Agent": "OpenClaw/1.0",
    },
    authContext: params.authContext,
    session: params.session,
    extraHeaders: { ...ontologyHeaders, ...(params.forwardHeaders ?? {}) },
  });
  ensureMcpIdentityHeaders(headers);
  applyEnvAuthOverrides(headers);
  const { request_headers } = getCommonGatewayMetadata(params.parameters);
  if (request_headers) {
    Object.assign(headers, request_headers);
  }

  debugMcpSessionHeaders({
    stage: "mcp_tools_call",
    capability,
    forwardHeaders: params.forwardHeaders,
    ontologyHeaders,
    finalHeaders: headers,
  });

  logBaiyingRequest(params.logger, "mcp.tools_call", {
    resource_id: capability.metadata?.resource_id,
    resource_type: capability.resource_type,
    action: toolInfo.name,
    url: serverUrl,
    payload,
    headers,
    forward_headers: params.forwardHeaders,
    ontology_headers: ontologyHeaders,
  });

  const data = await callMcpJsonRpc({
    transferType,
    serverUrl,
    payload,
    headers,
    timeoutMs: params.timeoutMs ?? 30_000,
  });
  if ("error" in data) {
    const errorDetail = {
      url: serverUrl,
      headers,
      request_params: params.parameters,
      error_code: (data.error as ExecutorFailure).error_code,
      error_message: (data.error as ExecutorFailure).error,
    };
    return makeError(
      (data.error as ExecutorFailure).error_code,
      `MCP request failed: ${(data.error as ExecutorFailure).error}`,
      { errorDetail },
    );
  }
  if (!isRecord(data)) {
    return makeError(
      "MCP_CALL_FAILED",
      "MCP call returned invalid payload",
    );
  }
  if ("error" in data) {
    return makeError("MCP_CALL_FAILED", String(data.error));
  }
  return {
    success: true,
    data: data.result,
    type: "mcp",
    target: {
      resource_id: capability.metadata?.resource_id,
      action: toolInfo.name,
    },
  };
}

function normalizeMcpTransferType(raw: unknown): "sse" | "streamable_http" {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]/g, "_");
  if (normalized === "sse") return "sse";
  if (normalized === "streamablehttp" || normalized === "streamable_http") {
    return "streamable_http";
  }
  return "streamable_http";
}

async function callMcpJsonRpc(params: {
  transferType: "sse" | "streamable_http";
  serverUrl: string;
  payload: Dict;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<Dict | { error: ExecutorFailure }> {
  if (params.transferType === "sse") {
    try {
      const { responses } = await runLegacySseJsonRpcSequence({
        sseUrl: params.serverUrl,
        headers: params.headers,
        timeoutMs: params.timeoutMs,
        requests: [
          {
            payload: {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "openclaw-baiying-executor", version: "1.0" },
              },
            },
            expectResponse: true,
          },
          {
            payload: { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
            expectResponse: false,
          },
          {
            payload: { ...params.payload, id: 2 },
            expectResponse: true,
          },
        ],
      });
      const callPayload = responses.find((item) => String(item.id ?? "") === "2") ?? responses[responses.length - 1];
      if (!isRecord(callPayload)) {
        return { error: makeError("MCP_CALL_FAILED", "MCP legacy SSE call returned invalid payload") };
      }
      return callPayload;
    } catch (err) {
      return {
        error: makeError(
          "MCP_CALL_FAILED",
          `MCP legacy SSE call failed: ${err instanceof Error ? err.message : String(err)}`,
          {
            errorDetail: {
              url: params.serverUrl,
              error_message: err instanceof Error ? err.message : String(err),
            },
          },
        ),
      };
    }
  }

  const result = await postJson({
    url: params.serverUrl,
    payload: params.payload,
    headers: params.headers,
    timeoutMs: params.timeoutMs,
  });
  if ("error" in result) return {
    error: makeError("MCP_CALL_FAILED", `MCP call failed: ${result.error.error}`, {
      errorDetail: {
        url: params.serverUrl,
        error_code: result.error.error_code,
        error_message: result.error.error,
      },
    }),
  };
  const { response, bodyText } = result;
  const data = extractJsonRpcPayload(response, bodyText);
  if (!isRecord(data)) {
    return {
      error: makeError(
        "MCP_CALL_FAILED",
        `MCP call returned invalid payload: HTTP ${response.status}`,
        {
          errorDetail: {
            url: params.serverUrl,
            status: response.status,
            response_body: bodyText.slice(0, 4096),
          },
        },
      ),
    };
  }
  return data;
}

async function executeOntologyResourceViaCallAgent(input: {
  capability: Capability;
  parameters: Dict;
  logger?: BaiyingEnhanceLogger;
}): Promise<ExecutorResponse> {
  const resourceType = String(input.capability.resource_type ?? "").trim().toUpperCase();
  const resourceId = String(input.capability.metadata?.resource_id ?? input.capability.name ?? "");
  const resourceCode =
    asString(input.capability.metadata?.resource_code) ||
    asString(input.capability.mcp?.resource_code) ||
    resourceId;
  const ontologyBaseCode =
    asString(input.capability.metadata?.ontology_base_code) ||
    asString(input.capability.metadata?.ontologyBaseCode);
  if (!resourceCode) {
    return makeError("ONTOLOGY_RESOURCE_CODE_NOT_FOUND", `${resourceType} resource_code not found`);
  }

  const sessionId = resolveDocSessionId(input.parameters, resourceId || resourceCode);
  const channelTraceId = resolveDocChannelTraceId(input.parameters);
  const langfuseParentObservationId = resolveLangfuseParentObservationId(input.parameters);
  const langfuseTraceId = resolveLangfuseTraceId(input.parameters);
  const traceId = channelTraceId || `${sessionId}-${Date.now()}`;
  const targetAgentType =
    asString(input.parameters.target_agent_type) ||
    (process.env.BAIYING_DATA_TARGET_AGENT_TYPE ?? "BYCLAW_DATA").trim() ||
    "BYCLAW_DATA";
  const content =
    asString(input.parameters.query) ||
    asString(input.parameters.question) ||
    asString(input.parameters.content) ||
    asString(input.parameters.message) ||
    "执行数据资源调用";
  const payload = buildOntologyCallAgentPayload(input.parameters);
  const callKey = ontologyCallKey(resourceType);
  const resourceContext = isRecord(input.parameters.resource_context)
    ? (input.parameters.resource_context as Dict)
    : {};
  const contextResources = ontologyResourcesFromContext(resourceContext);
  const ontologyResources: Dict[] = [];
  if (Array.isArray(payload.ontology_resources)) {
    for (const item of payload.ontology_resources) {
      addOntologyResource(ontologyResources, item);
    }
  }
  for (const item of contextResources.selected) {
    addOntologyResource(ontologyResources, item);
  }
  addOntologyResource(ontologyResources, {
    resource_biz_type: resourceType,
    resource_code: resourceCode,
    ...(ontologyBaseCode ? { ontology_base_code: ontologyBaseCode } : {}),
  });
  const allKnownResources = [...contextResources.selected, ...contextResources.available, ...ontologyResources];
  for (const [type, key] of [
    ["SCENE", "call_scene_ids"],
    ["VIEW", "call_view_ids"],
    ["OBJECT", "call_object_ids"],
  ] as const) {
    const existingCodes = normalizeStringList(payload[key]);
    const selectedCodes = ontologyResources
      .filter((item) => (asString(item.resource_biz_type) || asString(item.resource_type)).toUpperCase() === type)
      .map((item) => asString(item.resource_code))
      .filter(Boolean);
    const codes = Array.from(new Set([...existingCodes, ...selectedCodes]));
    if (codes.length > 0) {
      payload[key] = codes;
      for (const code of codes) {
        addOntologyResource(
          ontologyResources,
          findOntologyResourceByCode(allKnownResources, type, code) ?? {
            resource_biz_type: type,
            resource_code: code,
            ...(type === resourceType && ontologyBaseCode ? { ontology_base_code: ontologyBaseCode } : {}),
          },
        );
      }
    }
  }
  if (!Array.isArray(payload[callKey]) || (payload[callKey] as unknown[]).length === 0) {
    payload[callKey] = [resourceCode];
  }
  if (ontologyResources.length > 0) {
    payload.ontology_resources = ontologyResources;
    const summary = summarizeOntologyResources(ontologyResources);
    if (summary.bases.length === 1) {
      payload.ontology_base_code = summary.bases[0];
    } else if (summary.bases.length > 1) {
      payload.ontology_base_codes = summary.bases;
    } else if (ontologyBaseCode) {
      payload.ontology_base_code = ontologyBaseCode;
    }
    if (summary.groups.length > 0) {
      payload.ontology_base_resource_groups = summary.groups;
    }
  } else if (ontologyBaseCode) {
    payload.ontology_base_code = ontologyBaseCode;
  }
  const metadata = getCommonGatewayMetadata(input.parameters);
  if (metadata["channel-trace-id"]) {
    payload["channel-trace-id"] = metadata["channel-trace-id"];
  }
  if (langfuseParentObservationId) {
    payload.langfuseParentObservationId = langfuseParentObservationId;
    metadata.langfuseParentObservationId = langfuseParentObservationId;
  }
  if (langfuseTraceId) {
    payload.langfuseTraceId = langfuseTraceId;
    metadata.langfuseTraceId = langfuseTraceId;
  }
  const toolCallId = input.parameters.tool_call_id as string;

  return executeViaCallAgent({
    capability: input.capability,
    content,
    payload,
    sessionId,
    traceId,
    targetAgentType,
    toolCallId,
    callMode: docCallMode(input.parameters),
    syncTimeoutSec: docSyncTimeoutSec(input.parameters),
    syncIntervalSec: docSyncIntervalSec(input.parameters),
    responseType: `${resourceType.toLowerCase()}_call_agent`,
    target: {
      resource_id: resourceId,
      resource_type: resourceType,
      resource_code: resourceCode,
      ...(ontologyBaseCode ? { ontology_base_code: ontologyBaseCode } : {}),
      target_agent_type: targetAgentType,
      call_scene_ids: normalizeStringList(payload.call_scene_ids),
      call_view_ids: normalizeStringList(payload.call_view_ids),
      call_object_ids: normalizeStringList(payload.call_object_ids),
      ontology_resources: payload.ontology_resources,
      ontology_base_resource_groups: payload.ontology_base_resource_groups,
    },
    metadata,
    langfuseParentObservationId,
    langfuseTraceId,
    logger: input.logger,
    parentMessageId: toolCallId,
  });
}

function buildOntologyCallAgentPayload(parameters: Dict): Dict {
  const nested = isRecord(parameters.parameters)
    ? parameters.parameters
    : isRecord(parameters.arguments)
      ? parameters.arguments
      : {};
  const payload: Dict = { ...nested };
  const excluded = new Set([
    "query",
    "question",
    "content",
    "message",
    "action",
    "resource_context",
    "parameters",
    "arguments",
    "target_agent_type",
    "doc_call_mode",
    "doc_timeout_sec",
    "doc_interval_sec",
  ]);
  for (const [key, value] of Object.entries(parameters)) {
    if (!excluded.has(key) && value !== undefined) {
      payload[key] = value;
    }
  }
  return payload;
}
