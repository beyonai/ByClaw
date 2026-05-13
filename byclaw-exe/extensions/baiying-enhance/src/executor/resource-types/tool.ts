import type { Capability, Dict, ExecutorResponse } from "../types.js";
import { asString, isRecord } from "../types.js";
import type { AuthContext } from "../auth.js";
import { applyEnvAuthOverrides, hasNonEmptyHeader, mergeAuthHeaders, normalizeCustomHeaders } from "../auth.js";
import { makeError } from "../errors.js";
import { postJson, tryParseJson } from "../http.js";
import { validateParameters } from "../schema.js";
import { logBaiyingRequest, type BaiyingEnhanceLogger } from "../debug-channel.js";
import { getCommonGatewayMetadata } from "../doc-shared.js";

/** Mirror of `BaiYingExecutor._execute_tool`. */
export async function executeTool(params: {
  capability: Capability;
  parameters: Dict;
  authContext: AuthContext;
  session?: string;
  timeoutMs?: number;
  logger?: BaiyingEnhanceLogger;
}): Promise<ExecutorResponse> {
  const { capability } = params;
  const tool = isRecord(capability.tool) ? (capability.tool as Dict) : {};

  const validation = validateParameters({
    actionName: String(capability.name),
    resourceId: String(capability.metadata?.resource_id ?? ""),
    resourceType: "TOOL",
    parameters: params.parameters,
    rawSchema: tool.input_schema,
  });
  if (validation) return validation;

  const url = asString(tool.url);
  if (!url) {
    return makeError("TOOL_URL_NOT_FOUND", "Tool URL not found");
  }

  const { headers } = mergeAuthHeaders({
    baseHeaders: { "Content-Type": "application/json", "User-Agent": "OpenClaw/1.0" },
    authContext: params.authContext,
    session: params.session,
  });
  const mergedCustomHeaders = normalizeCustomHeaders(capability.metadata?.default_headers);
  const toolHeaders = normalizeCustomHeaders(tool.headers);
  Object.assign(headers, mergedCustomHeaders, toolHeaders);
  applyEnvAuthOverrides(headers);
  const { request_headers } = getCommonGatewayMetadata(params.parameters);
  if (request_headers) {
    Object.assign(headers, request_headers);
  }
  if (url.includes("10.10.165.30") && !hasNonEmptyHeader(headers, "authorization")) {
    headers.Authorization =
      "WhaleDI-Agent-4cd294f7ead8adcd1f2f05c8b4ae7252ce453157a39e7620089a1732ced5bbe0";
  }

  logBaiyingRequest(params.logger, "tool.post", {
    resource_id: capability.metadata?.resource_id,
    resource_type: capability.resource_type,
    action: capability.name,
    url,
    payload: params.parameters,
    headers,
  });

  const result = await postJson({
    url,
    payload: params.parameters,
    headers,
    timeoutMs: params.timeoutMs ?? 30_000,
  });
  if ("error" in result) return result.error;
  const parsed = tryParseJson(result.bodyText);
  return {
    success: true,
    data: parsed != null ? parsed : result.bodyText,
    type: "tool",
    target: { resource_id: capability.metadata?.resource_id },
  };
}
