import type { Capability, Dict, ExecutorResponse } from "../types.js";
import { asString, isRecord } from "../types.js";
import type { AuthContext } from "../auth.js";
import { applyEnvAuthOverrides, hasNonEmptyHeader, mergeAuthHeaders, normalizeCustomHeaders } from "../auth.js";
import { makeError } from "../errors.js";
import { postJson, tryParseJson } from "../http.js";
import { validateParameters } from "../schema.js";
import { logBaiyingRequest, type BaiyingEnhanceLogger } from "../debug-channel.js";
import { getCommonGatewayMetadata } from "../doc-shared.js";
import { applyPrivateEnvPlaceholders, redactPrivateParamValues } from "../../personal-params.js";

/** Mirror of `BaiYingExecutor._execute_tool`. */
export async function executeTool(params: {
  capability: Capability;
  parameters: Dict;
  authContext: AuthContext;
  session?: string;
  timeoutMs?: number;
  logger?: BaiyingEnhanceLogger;
  privateParams?: Record<string, string>;
}): Promise<ExecutorResponse> {
  const { capability } = params;
  const tool = isRecord(capability.tool) ? (capability.tool as Dict) : {};
  const requestParameters = applyPrivateEnvPlaceholders(params.parameters, params.privateParams, params.logger);

  const validation = validateParameters({
    actionName: String(capability.name),
    resourceId: String(capability.metadata?.resource_id ?? ""),
    resourceType: "TOOL",
    parameters: requestParameters,
    rawSchema: tool.input_schema,
  });
  if (validation) return validation;

  const url = applyPrivateEnvPlaceholders(asString(tool.url), params.privateParams, params.logger);
  if (!url) {
    return makeError("TOOL_URL_NOT_FOUND", "Tool URL not found");
  }

  const { headers } = mergeAuthHeaders({
    baseHeaders: { "Content-Type": "application/json", "User-Agent": "OpenClaw/1.0" },
    authContext: params.authContext,
    session: params.session,
  });
  const mergedCustomHeaders = applyPrivateEnvPlaceholders(
    normalizeCustomHeaders(capability.metadata?.default_headers),
    params.privateParams,
    params.logger,
  );
  const toolHeaders = applyPrivateEnvPlaceholders(
    normalizeCustomHeaders(tool.headers),
    params.privateParams,
    params.logger,
  );
  Object.assign(headers, mergedCustomHeaders, toolHeaders);
  applyEnvAuthOverrides(headers);
  const { request_headers } = getCommonGatewayMetadata(requestParameters);
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
    payload: requestParameters,
    headers,
  });

  const result = await postJson({
    url,
    payload: requestParameters,
    headers,
    timeoutMs: params.timeoutMs ?? 30_000,
  });

  if ("error" in result) {
    const errorDetail = redactPrivateParamValues({
      url,
      headers,
      request_params: requestParameters,
      error_code: result.error.error_code,
      error_message: result.error.error,
    }, params.privateParams);
    return makeError(
      result.error.error_code,
      `Tool request failed: ${result.error.error}`,
      { errorDetail },
    );
  }

  const { response, bodyText } = result;

  if (!response.ok) {
    const errorDetail = redactPrivateParamValues({
      url,
      headers,
      request_params: requestParameters,
      status: response.status,
      status_text: response.statusText,
      response_body: bodyText.slice(0, 4096),
    }, params.privateParams);
    if (response.status === 401 || response.status === 403) {
      return makeError("AUTH_EXPIRED", "Authentication expired or invalid, please re-login", { errorDetail });
    }
    return makeError("TOOL_REQUEST_FAILED", `HTTP ${response.status}: ${response.statusText}`, { errorDetail });
  }

  const parsed = tryParseJson(bodyText);
  return {
    success: true,
    data: parsed != null ? parsed : bodyText,
    type: "tool",
    target: { resource_id: capability.metadata?.resource_id },
  };
}
