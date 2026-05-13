import type { Capability, Dict, ExecutorFailure } from "./types.js";
import { asRecord, isRecord, nonEmptyString } from "./types.js";
import {
  applyEnvAuthOverrides,
  ensureMcpIdentityHeaders,
  mergeAuthHeaders,
  type AuthContext,
} from "./auth.js";
import { makeError } from "./errors.js";
import { extractJsonRpcPayload } from "./http.js";
import { buildOntologyMcpHeaders, debugMcpSessionHeaders } from "./ontology-headers.js";
import { runLegacySseJsonRpcSequence } from "./mcp-legacy-sse.js";

type FetchLike = typeof fetch;

async function postMcpJson(params: {
  url: string;
  payload: unknown;
  headers: Record<string, string>;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): Promise<{ response: Response; bodyText: string } | { error: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const fetchFn = params.fetchImpl ?? fetch;
    const response = await fetchFn(params.url, {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify(params.payload ?? {}),
      signal: controller.signal,
    });
    const bodyText = await response.text().catch(() => "");
    return { response, bodyText };
  } catch (err) {
    return { error: err };
  } finally {
    clearTimeout(timer);
  }
}

/** Mirror of `_list_mcp_tools_live`. */
export async function listMcpToolsLive(params: {
  capability: Capability;
  authContext: AuthContext;
  session?: string;
  forwardHeaders?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): Promise<{ tools: Dict[] | null; error: ExecutorFailure | null }> {
  const mcp = isRecord(params.capability.mcp) ? (params.capability.mcp as Dict) : {};
  const serverUrl = nonEmptyString(mcp.server_url);
  const transferType = normalizeMcpTransferType(
    mcp.transfer_type ?? mcp.transferType ?? mcp.mcpType ?? mcp.mcp_type,
  );
  if (!serverUrl) {
    return { tools: null, error: makeError("MCP_SERVER_NOT_FOUND", "MCP Server URL not found") };
  }

  const { headers: ontologyHeaders, error: ontologyError } = buildOntologyMcpHeaders(params.capability);
  if (ontologyError) {
    return { tools: null, error: ontologyError };
  }

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
  debugMcpSessionHeaders({
    stage: "mcp_discovery_initialize",
    capability: params.capability,
    forwardHeaders: params.forwardHeaders,
    ontologyHeaders,
    finalHeaders: headers,
  });

  const timeoutMs = params.timeoutMs ?? 20_000;

  if (transferType === "sse") {
    try {
      const { responses } = await runLegacySseJsonRpcSequence({
        sseUrl: serverUrl,
        headers,
        timeoutMs,
        fetchImpl: params.fetchImpl,
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
            payload: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
            expectResponse: true,
          },
        ],
      });
      const listPayload = responses.find((item) => String(item.id ?? "") === "2") ?? responses[responses.length - 1];
      if (!isRecord(listPayload)) {
        return {
          tools: null,
          error: makeError("MCP_DISCOVERY_FAILED", "MCP tools/list returned invalid payload (legacy SSE)"),
        };
      }
      if ("error" in listPayload) {
        return {
          tools: null,
          error: makeError("MCP_DISCOVERY_FAILED", String(listPayload.error)),
        };
      }
      const result = asRecord(listPayload.result);
      const toolsRaw = Array.isArray(result?.tools) ? (result!.tools as unknown[]) : [];
      const normalized: Dict[] = [];
      for (const tool of toolsRaw) {
        if (!isRecord(tool)) continue;
        normalized.push({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema ?? tool.input_schema ?? tool.schema,
          output_schema: tool.outputSchema ?? tool.output_schema,
        });
      }
      return { tools: normalized, error: null };
    } catch (err) {
      return {
        tools: null,
        error: makeError(
          "MCP_DISCOVERY_FAILED",
          `MCP legacy SSE discovery failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    }
  }

  const initRes = await callMcpJsonRpc({
    transferType,
    url: serverUrl,
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
    headers,
    timeoutMs,
    fetchImpl: params.fetchImpl,
  });
  if ("error" in initRes) {
    return {
      tools: null,
      error: makeError(
        "MCP_DISCOVERY_FAILED",
        `MCP initialize failed: ${initRes.error instanceof Error ? initRes.error.message : String(initRes.error)}`,
      ),
    };
  }
  const { response: initResponse } = initRes;
  if (initResponse.status === 401 || initResponse.status === 403) {
    return {
      tools: null,
      error: makeError(
        "MCP_DISCOVERY_UNAUTHORIZED",
        `MCP initialize unauthorized: HTTP ${initResponse.status}`,
      ),
    };
  }
  if (initResponse.status !== 200 && initResponse.status !== 202) {
    return {
      tools: null,
      error: makeError(
        "MCP_DISCOVERY_FAILED",
        `MCP initialize failed: HTTP ${initResponse.status}`,
      ),
    };
  }

  const sessionId =
    initResponse.headers.get("mcp-session-id") ??
    initResponse.headers.get("Mcp-Session-Id") ??
    initResponse.headers.get("MCP-Session-Id");
  const sessionHeaders: Record<string, string> = {};
  if (sessionId) sessionHeaders["Mcp-Session-Id"] = sessionId;

  const notificationHeaders = mergeAuthHeaders({
    baseHeaders: headers,
    authContext: params.authContext,
    session: params.session,
    extraHeaders: sessionHeaders,
  }).headers;
  applyEnvAuthOverrides(notificationHeaders);

  // notifications/initialized - fire and forget
  void callMcpJsonRpc({
    transferType,
    url: serverUrl,
    payload: { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    headers: notificationHeaders,
    timeoutMs,
    fetchImpl: params.fetchImpl,
  }).catch(() => undefined);

  const listRes = await callMcpJsonRpc({
    transferType,
    url: serverUrl,
    payload: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    headers: notificationHeaders,
    timeoutMs,
    fetchImpl: params.fetchImpl,
  });
  if ("error" in listRes) {
    return {
      tools: null,
      error: makeError(
        "MCP_DISCOVERY_FAILED",
        `MCP tools/list failed: ${listRes.error instanceof Error ? listRes.error.message : String(listRes.error)}`,
      ),
    };
  }
  const { response: listResponse } = listRes;
  if (listResponse.status === 401 || listResponse.status === 403) {
    return {
      tools: null,
      error: makeError(
        "MCP_DISCOVERY_UNAUTHORIZED",
        `MCP tools/list unauthorized: HTTP ${listResponse.status}`,
      ),
    };
  }

  const payload = listRes.payload;
  if (!isRecord(payload)) {
    return {
      tools: null,
      error: makeError(
        "MCP_DISCOVERY_FAILED",
        `MCP tools/list returned invalid payload: HTTP ${listResponse.status}`,
      ),
    };
  }
  if ("error" in payload) {
    return {
      tools: null,
      error: makeError("MCP_DISCOVERY_FAILED", String(payload.error)),
    };
  }

  const result = asRecord(payload.result);
  const toolsRaw = Array.isArray(result?.tools) ? (result!.tools as unknown[]) : [];
  const normalized: Dict[] = [];
  for (const tool of toolsRaw) {
    if (!isRecord(tool)) continue;
    normalized.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema ?? tool.input_schema ?? tool.schema,
      output_schema: tool.outputSchema ?? tool.output_schema,
    });
  }
  return { tools: normalized, error: null };
}

function normalizeMcpTransferType(raw: unknown): "sse" | "streamable_http" {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]/g, "_");
  if (normalized === "sse") return "sse";
  if (normalized === "streamablehttp" || normalized === "streamable_http") return "streamable_http";
  return "streamable_http";
}

async function callMcpJsonRpc(params: {
  transferType: "sse" | "streamable_http";
  url: string;
  payload: unknown;
  headers: Record<string, string>;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): Promise<{ response: Response; payload: Dict | null } | { error: unknown }> {
  if (params.transferType === "sse") {
    const streamRes = await postMcpSse({
      url: params.url,
      payload: params.payload,
      headers: params.headers,
      timeoutMs: params.timeoutMs,
      fetchImpl: params.fetchImpl,
    });
    if ("error" in streamRes) return streamRes;
    return {
      response: streamRes.response,
      payload: streamRes.events.find((event) => "jsonrpc" in event || "result" in event || "error" in event) ?? null,
    };
  }

  const jsonRes = await postMcpJson({
    url: params.url,
    payload: params.payload,
    headers: params.headers,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
  });
  if ("error" in jsonRes) return jsonRes;
  return {
    response: jsonRes.response,
    payload: extractJsonRpcPayload(jsonRes.response, jsonRes.bodyText),
  };
}

async function postMcpSse(params: {
  url: string;
  payload: unknown;
  headers: Record<string, string>;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): Promise<{ response: Response; events: Dict[] } | { error: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const fetchFn = params.fetchImpl ?? fetch;
    const response = await fetchFn(params.url, {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify(params.payload ?? {}),
      signal: controller.signal,
    });
    const events: Dict[] = [];
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    if (!response.body) {
      return { response, events };
    }
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = -1;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (isRecord(parsed)) events.push(parsed);
          } catch {
            // ignore malformed line
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return { response, events };
  } catch (err) {
    return { error: err };
  } finally {
    clearTimeout(timer);
  }
}

/** Mirror of `_refresh_mcp_capability`. Mutates and returns the capability in-place. */
export async function refreshMcpCapability(params: {
  capability: Capability;
  authContext: AuthContext;
  session?: string;
  forwardHeaders?: Record<string, string>;
  fetchImpl?: FetchLike;
}): Promise<Capability> {
  if (!isRecord(params.capability.mcp)) {
    return params.capability;
  }
  const { tools, error } = await listMcpToolsLive({
    capability: params.capability,
    authContext: params.authContext,
    session: params.session,
    forwardHeaders: params.forwardHeaders,
    fetchImpl: params.fetchImpl,
  });
  if (tools && tools.length > 0) {
    const mcp = params.capability.mcp as NonNullable<Capability["mcp"]>;
    mcp.tools = tools as Capability["mcp"]["tools"];
    params.capability._mcp_live_error = null;
    params.capability._discovery_source = `${params.capability._discovery_source ?? "unknown"}+mcp_live`;
    return params.capability;
  }
  params.capability._mcp_live_error = error ?? undefined;
  return params.capability;
}
