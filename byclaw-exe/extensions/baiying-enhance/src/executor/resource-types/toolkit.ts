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

function hasBinaryField(schema: unknown): boolean {
  if (!isRecord(schema) || !isRecord(schema.properties)) return false;
  for (const prop of Object.values(schema.properties)) {
    if (!isRecord(prop)) continue;
    if (asString(prop.format).toLowerCase() === "binary") return true;
  }
  return false;
}

async function buildMultipartPayload(parameters: Dict): Promise<FormData> {
  const form = new FormData();
  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined || value === null) continue;
    if (key === "fileContent") {
      if (typeof value === "string") {
        const bytes = await readFile(value);
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
}): Promise<ExecutorResponse> {
  const { capability } = params;
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
    parameters: params.parameters,
    rawSchema: toolInfo.input_schema,
  });
  if (validation) return validation;

  const url = asString(toolInfo.url);
  if (!url) {
    return makeError("TOOL_URL_NOT_FOUND", "Toolkit tool URL not found");
  }

  const { headers } = mergeAuthHeaders({
    baseHeaders: { "Content-Type": "application/json", "User-Agent": "OpenClaw/1.0" },
    authContext: params.authContext,
    session: params.session,
  });
  const mergedCustomHeaders = normalizeCustomHeaders(capability.metadata?.default_headers);
  const toolHeaders = normalizeCustomHeaders(toolInfo.headers);
  Object.assign(headers, mergedCustomHeaders, toolHeaders);
  applyEnvAuthOverrides(headers);
  const { request_headers } = getCommonGatewayMetadata(params.parameters);
  if (request_headers) {
    Object.assign(headers, request_headers);
  }
  const useMultipart = hasBinaryField(toolInfo.input_schema);

  logBaiyingRequest(params.logger, useMultipart ? "toolkit.post.multipart" : "toolkit.post", {
    resource_id: capability.metadata?.resource_id,
    resource_type: capability.resource_type,
    action: toolInfo.name,
    url,
    payload: params.parameters,
    headers,
  });

  const result = useMultipart
    ? await postMultipartForm({
        url,
        formData: await buildMultipartPayload(params.parameters),
        headers,
        timeoutMs: params.timeoutMs ?? 30_000,
      })
    : await postJson({
        url,
        payload: params.parameters,
        headers,
        timeoutMs: params.timeoutMs ?? 30_000,
      });
  if ("error" in result) return result.error;
  const { bodyText } = result;
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
