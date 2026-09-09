import type { Capability, Dict, ExecutorResponse } from "../types.js";
import { asString, isRecord } from "../types.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AuthContext } from "../auth.js";
import { applyEnvAuthOverrides, mergeAuthHeaders, normalizeCustomHeaders } from "../auth.js";
import { makeError } from "../errors.js";
import { postJson, postMultipartForm, tryParseJson } from "../http.js";
import { resolveChildAction } from "../resolve-action.js";
import { validateParameters } from "../schema.js";
import { logBaiyingRequest, type BaiyingEnhanceLogger } from "../debug-channel.js";
import { getCommonGatewayMetadata } from "../doc-shared.js";
import { applyPrivateEnvPlaceholders, redactPrivateParamValues } from "../../personal-params.js";

function hasBinaryField(schema: unknown): boolean {
  if (!isRecord(schema) || !isRecord(schema.properties)) return false;
  for (const prop of Object.values(schema.properties)) {
    if (!isRecord(prop)) continue;
    if (asString(prop.format).toLowerCase() === "binary") return true;
  }
  return false;
}

async function buildMultipartPayload(parameters: Dict, signal?: AbortSignal): Promise<FormData> {
  const form = new FormData();
  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined || value === null) continue;
    if (key === "fileContent") {
      if (typeof value === "string") {
        const bytes = await readFile(value, { signal });
        form.append(key, new Blob([bytes]), path.basename(value));
        continue;
      }
      if (value instanceof Uint8Array) {
        form.append(key, new Blob([value]), "upload.bin");
        continue;
      }
    }
    if (typeof value === "string") {
      form.append(key, value);
      continue;
    }
    form.append(key, JSON.stringify(value));
  }
  return form;
}

/** Mirror of `BaiYingExecutor._execute_toolkit`. */
export async function executeToolkit(params: {
  capability: Capability;
  action: string;
  parameters: Dict;
  authContext: AuthContext;
  session?: string;
  timeoutMs?: number;
  logger?: BaiyingEnhanceLogger;
  privateParams?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<ExecutorResponse> {
  const { capability } = params;
  const requestParameters = applyPrivateEnvPlaceholders(params.parameters, params.privateParams, params.logger);
  const resourceId = String(capability.metadata?.resource_id ?? capability.name ?? "");
  const resolved = resolveChildAction({
    parentResourceId: resourceId,
    parentResourceType: String(capability.resource_type ?? "TOOLKIT"),
    action: params.action,
    items: capability.tools ?? [],
    actionType: "TOOLKIT_TOOL",
  });
  if (resolved.error) return resolved.error;
  const toolInfo = resolved.item as Dict;

  const validation = validateParameters({
    actionName: String(toolInfo.name),
    resourceId,
    resourceType: "TOOLKIT",
    parameters: requestParameters,
    rawSchema: toolInfo.input_schema,
  });
  if (validation) return validation;

  const url = applyPrivateEnvPlaceholders(asString(toolInfo.url), params.privateParams, params.logger);
  if (!url) {
    return makeError("TOOL_URL_NOT_FOUND", "Toolkit tool URL not found");
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
    normalizeCustomHeaders(toolInfo.headers),
    params.privateParams,
    params.logger,
  );
  Object.assign(headers, mergedCustomHeaders, toolHeaders);
  applyEnvAuthOverrides(headers);
  const { request_headers } = getCommonGatewayMetadata(requestParameters);
  if (request_headers) {
    Object.assign(headers, request_headers);
  }
  const useMultipart = hasBinaryField(toolInfo.input_schema);

  logBaiyingRequest(params.logger, useMultipart ? "toolkit.post.multipart" : "toolkit.post", {
    resource_id: capability.metadata?.resource_id,
    resource_type: capability.resource_type,
    action: toolInfo.name,
    url,
    payload: requestParameters,
    headers,
  });

  const result = useMultipart
    ? await postMultipartForm({
        url,
        formData: await buildMultipartPayload(requestParameters, params.signal),
        headers,
        timeoutMs: params.timeoutMs ?? 30_000,
        signal: params.signal,
      })
    : await postJson({
        url,
        payload: requestParameters,
        headers,
        timeoutMs: params.timeoutMs ?? 30_000,
        signal: params.signal,
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
      `Toolkit request failed: ${result.error.error}`,
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
      return makeError(
        "AUTH_EXPIRED",
        "Authentication expired or invalid, please re-login",
        { errorDetail },
      );
    }
    return makeError(
      "TOOLKIT_REQUEST_FAILED",
      `HTTP ${response.status}: ${response.statusText}`,
      { errorDetail },
    );
  }

  const parsed = tryParseJson(bodyText);
  const data = parsed != null ? parsed : bodyText;
  return {
    success: true,
    data,
    type: "toolkit",
    target: {
      resource_id: capability.metadata?.resource_id,
      action: toolInfo.name,
    },
  };
}
