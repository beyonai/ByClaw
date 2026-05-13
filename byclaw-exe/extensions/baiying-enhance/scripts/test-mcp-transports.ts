import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCapability } from "../src/executor/capability-resolver.js";
import { executeMcp } from "../src/executor/resource-types/mcp.js";
import { isRecord } from "../src/executor/types.js";

type Case = {
  resourceId: string;
  expectedTransport: "sse" | "streamable_http";
};

const CASES: Case[] = [
  { resourceId: "10002679", expectedTransport: "sse" },
  { resourceId: "10004199", expectedTransport: "streamable_http" },
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resourcesDir = path.resolve(__dirname, "../resources");

function normalizeTransport(raw: unknown): "sse" | "streamable_http" {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]/g, "_");
  if (normalized === "sse") return "sse";
  if (normalized === "streamablehttp" || normalized === "streamable_http") return "streamable_http";
  return "streamable_http";
}

function buildMinimalArgs(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) return {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const out: Record<string, unknown> = {};
  for (const name of required) {
    const key = String(name);
    const p = isRecord(properties[key]) ? properties[key] : {};
    const t = String(p.type ?? "string");
    if (t === "number" || t === "integer") out[key] = 1;
    else if (t === "boolean") out[key] = true;
    else if (t === "array") out[key] = [];
    else if (t === "object") out[key] = {};
    else out[key] = "test";
  }
  return out;
}

function buildEnvHeaders(accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "Content-Type": "application/json",
    "User-Agent": "mcp-transport-smoke/1.0",
  };
  const auth = String(process.env.BAIYING_AGENT_AUTH ?? "").trim();
  const beyond = String(process.env.BEYOND_TOKEN ?? "").trim();
  if (auth) headers.Authorization = auth;
  if (beyond) headers["Beyond-Token"] = beyond;
  return headers;
}

async function postJsonRpc(url: string, payload: unknown, headers: Record<string, string>): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload ?? {}),
  });
}

function parseEndpointFromSseChunk(chunk: string): string {
  const lines = chunk.split(/\r?\n/);
  let eventName = "";
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (!data) continue;
      if (eventName === "endpoint") return data;
      if (!eventName && (data.startsWith("http://") || data.startsWith("https://") || data.startsWith("/"))) {
        return data;
      }
    }
  }
  return "";
}

async function tryLegacySseHandshake(serverUrl: string): Promise<void> {
  const headers = buildEnvHeaders("text/event-stream");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("sse endpoint wait timeout")), 10_000);
  try {
    const res = await fetch(serverUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.log(`legacy-sse GET failed: HTTP ${res.status}`);
      return;
    }
    if (!res.body) {
      console.log("legacy-sse GET has no response body");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let endpoint = "";
    try {
      while (!endpoint) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by blank lines; inspect progressively.
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          endpoint = parseEndpointFromSseChunk(part);
          if (endpoint) break;
        }
      }
    } finally {
      reader.releaseLock();
      controller.abort();
    }

    if (!endpoint) {
      console.log("legacy-sse endpoint event not found");
      return;
    }
    const endpointUrl = endpoint.startsWith("http://") || endpoint.startsWith("https://")
      ? endpoint
      : new URL(endpoint, serverUrl).toString();
    console.log(`legacy-sse endpoint=${endpointUrl}`);

    const initRes = await postJsonRpc(
      endpointUrl,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mcp-transport-smoke", version: "1.0" },
        },
      },
      headers,
    );
    console.log(`legacy-sse initialize: HTTP ${initRes.status}`);
    const sessionId =
      initRes.headers.get("mcp-session-id") ??
      initRes.headers.get("Mcp-Session-Id") ??
      initRes.headers.get("MCP-Session-Id");
    const nextHeaders = { ...headers };
    if (sessionId) nextHeaders["Mcp-Session-Id"] = sessionId;

    await postJsonRpc(
      endpointUrl,
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      nextHeaders,
    ).catch(() => undefined);

    const listRes = await postJsonRpc(
      endpointUrl,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      nextHeaders,
    );
    const listBody = await listRes.text().catch(() => "");
    console.log(`legacy-sse tools/list: HTTP ${listRes.status}`);
    console.log(`legacy-sse tools/list body preview=${listBody.slice(0, 300) || "<empty>"}`);
  } catch (err) {
    console.log(`legacy-sse handshake failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function runOne(testCase: Case): Promise<void> {
  const start = Date.now();
  console.log(`\n=== MCP ${testCase.resourceId} (${testCase.expectedTransport}) ===`);
  const { capability } = await resolveCapability({
    resourcesDir,
    capabilityId: testCase.resourceId,
    resourceType: "MCP",
    resourceContext: {},
    authContext: { session: "", userId: "", headers: {} },
  });
  if (!capability) {
    console.log("resolveCapability: FAIL (capability is null)");
    return;
  }
  const mcp = isRecord(capability.mcp) ? capability.mcp : {};
  const transport = normalizeTransport(mcp.transfer_type);
  const serverUrl = String(mcp.server_url ?? "");
  console.log(`resolved transfer_type=${String(mcp.transfer_type ?? "")} normalized=${transport}`);
  console.log(`resolved server_url=${serverUrl}`);
  if (transport !== testCase.expectedTransport) {
    console.log(`transport mismatch: expect=${testCase.expectedTransport} got=${transport}`);
  }
  if (transport === "sse") {
    console.log("trying legacy SSE handshake (GET /sse -> endpoint -> POST initialize/tools/list)...");
    await tryLegacySseHandshake(serverUrl);
  }

  const tools = Array.isArray(mcp.tools) ? mcp.tools : [];
  console.log(`tools/list count=${tools.length}`);
  if (tools.length === 0) {
    const liveErr = capability._mcp_live_error;
    console.log(`tools/list empty, live_error=${JSON.stringify(liveErr ?? null)}`);
    console.log(`elapsed=${Date.now() - start}ms`);
    return;
  }
  const tool = isRecord(tools[0]) ? tools[0] : null;
  if (!tool) {
    console.log("first tool invalid shape");
    console.log(`elapsed=${Date.now() - start}ms`);
    return;
  }
  const action = String(tool.name ?? "");
  const args = buildMinimalArgs(tool.input_schema);
  console.log(`tools/call action=${action} args=${JSON.stringify(args)}`);

  const execResult = await executeMcp({
    capability,
    action,
    parameters: args,
    authContext: { session: "", userId: "", headers: {} },
    timeoutMs: 30_000,
  });
  console.log(`tools/call success=${execResult.success}`);
  if (!execResult.success) {
    console.log(`tools/call error_code=${execResult.error_code}`);
    console.log(`tools/call error=${execResult.error}`);
  } else {
    console.log(`tools/call target=${JSON.stringify(execResult.target ?? {})}`);
  }
  console.log(`elapsed=${Date.now() - start}ms`);
}

async function main(): Promise<void> {
  console.log(`resourcesDir=${resourcesDir}`);
  for (const c of CASES) {
    await runOne(c);
  }
}

main().catch((err) => {
  console.error("MCP transport smoke failed:", err);
  process.exit(1);
});
