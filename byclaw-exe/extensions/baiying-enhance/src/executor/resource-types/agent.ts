import path from "node:path";
import { homedir } from "node:os";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Capability, Dict, ExecutorResponse } from "../types.js";
import { asString, isRecord } from "../types.js";
import type { AuthContext } from "../auth.js";
import { applyEnvAuthOverrides, mergeAuthHeaders, normalizeCustomHeaders } from "../auth.js";
import { makeError } from "../errors.js";
import { readSseEvents } from "../http.js";
import { logBaiyingRequest, type BaiyingEnhanceLogger } from "../debug-channel.js";
import { getCommonGatewayMetadata } from "../doc-shared.js";

function resolvePersonalAgentDir(): string {
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (stateDir) {
    const resolved = path.resolve(stateDir);
    // State dir is usually `<root>/.openclaw` (e.g. `/by/.openclaw`); personal agent bundles
    // are stored next to it as `<root>/.personal-agents`, not inside `.openclaw`.
    const base =
      path.basename(resolved) === ".openclaw" ? path.dirname(resolved) : resolved;
    return path.join(base, ".personal-agents");
  }
  return path.join(homedir(), ".personal-agents");
}

const personalAgentDir = resolvePersonalAgentDir();
const getPersonalAgentPath = (resourceId: string) => path.join(personalAgentDir, String(resourceId));

type personalAgentHandler = (input: string, sessionId?: string, traceId?: string) => unknown | Promise<unknown>;

async function loadPersonalAgentHandler(resourceId: string): Promise<personalAgentHandler | null> {
  const agentDir = path.resolve(getPersonalAgentPath(resourceId));
  const agentDirStat = await fs.stat(agentDir).catch(() => null);
  if (!agentDirStat?.isDirectory()) {
    return null;
  }

  const agentEntryPath = path.join(agentDir, "dist", "index.mjs");
  const agentEntryStat = await fs.stat(agentEntryPath).catch(() => null);
  if (!agentEntryStat?.isFile()) {
    return null;
  }

  /** Always load the real `dist/index.mjs` via ESM `import()`. `require.resolve` can remap to `index.js` via package.json. */
  const importHref = `${pathToFileURL(agentEntryPath).href}?t=${Date.now()}`;
  let loadedModule: unknown;
  try {
    loadedModule = await import(importHref);
  } catch (e: unknown) {
    console.error(`[ASK_PERSONAL] import failed: ${agentEntryPath}`, e);
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to load personal agent module (expected ESM at dist/index.mjs): ${msg}`);
  }
  if (typeof loadedModule === "function") {
    return loadedModule as personalAgentHandler;
  }
  if (typeof (loadedModule as { default?: unknown })?.default === "function") {
    return (loadedModule as { default: personalAgentHandler }).default;
  }

  return null;
}

/** Mirror of `BaiYingExecutor._execute_agent`. */
export async function executeAgent(params: {
  capability: Capability;
  parameters: Dict;
  authContext: AuthContext;
  session?: string;
  timeoutMs?: number;
  logger?: BaiyingEnhanceLogger;
}): Promise<ExecutorResponse> {
  const { capability, parameters } = params;
  const agent = isRecord(capability.agent) ? (capability.agent as Dict) : {};
  const sseUrl = asString(agent.sse_url);

  const resourceContext = parameters.resource_context as {
    root_agent?: Record<string, unknown>;
    selected_resource?: Record<string, unknown>;
    channel_session_id?: string;
    channel_trace_id?: string;
  };
  const sessionId = parameters.session_id || resourceContext.channel_session_id || "";
  const traceId = parameters.trace_id || resourceContext.channel_trace_id || "";
  const chatContent = String(parameters.query ?? parameters.message ?? "");

  if (capability.metadata?.impl_type === "ASK_PERSONAL") {
    if (capability.metadata.resource_id) {
      let dynamicAgentHandler: personalAgentHandler | null;
      try {
        dynamicAgentHandler = await loadPersonalAgentHandler(capability.metadata.resource_id);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return makeError("ASK_PERSONAL_AGENT_ERROR", errorMessage);
      }
      if (dynamicAgentHandler) {
        console.log(`------[ASK_PERSONAL]------
resource_id=${capability.metadata.resource_id}
resource_name=${capability.name}
path=${path.join(path.resolve(getPersonalAgentPath(capability.metadata.resource_id)), "dist", "index.mjs")}
input=${chatContent}`);

        let content: unknown;
        try {
          const result = await dynamicAgentHandler(chatContent, String(sessionId), String(traceId));
          if (result) {
            content = result;
          } else {
            content = "No data returned";
          }
          console.log(`------[ASK_PERSONAL] result=${result}------ `);
        } catch (error: unknown) {
          console.error(`------[ASK_PERSONAL] error=${error}------ `);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return makeError("ASK_PERSONAL_AGENT_ERROR", errorMessage);
        }

        return {
          success: true,
          data: { content },
          type: "agent",
          target: { resource_id: capability.metadata?.resource_id },
        };
      }
    }
    return makeError("ASK_PERSONAL_AGENT_ERROR", "Personal agent handler not found");
  }

  if (!sseUrl) {
    return makeError("SSE_URL_NOT_FOUND", "SSE URL not found");
  }

  const payload = {
    chatContent,
    sessionId: String(sessionId ?? "openclaw-session"),
    chatId: String(params.parameters.chat_id ?? "openclaw-chat"),
    agentId: String(capability.metadata?.resource_id ?? ""),
    stream: true,
    redList: [],
    blackList: [],
    deepThink: Boolean(params.parameters.deep_think ?? false),
    extParam: isRecord(params.parameters.ext_param) ? params.parameters.ext_param : {},
    language: "zh-CN",
    histories: Array.isArray(params.parameters.histories) ? params.parameters.histories : [],
    versionType: 1,
  };

  const defaultHeaders = normalizeCustomHeaders(capability.metadata?.default_headers);
  const agentHeaders = normalizeCustomHeaders(agent.headers);
  const snapshotHeaderKeys = new Set(
    [...Object.keys(defaultHeaders), ...Object.keys(agentHeaders)].map((k) => k.toLowerCase()),
  );
  /** 快照已带网关鉴权时，不要再合并 `baiying-session` 里的 Cookie / Beyond-Token，否则会出现重复 token 与空 SSE。 */
  const hasSnapshotBearerAuth =
    snapshotHeaderKeys.has("authorization") || snapshotHeaderKeys.has("beyond-token");
  const effectiveAuth = hasSnapshotBearerAuth
    ? { session: "", userId: "", headers: {} as Record<string, string> }
    : params.authContext;

  const { headers } = mergeAuthHeaders({
    baseHeaders: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": "OpenClaw/1.0",
    },
    authContext: effectiveAuth,
    session: params.session,
    ensureSessionCookie: !hasSnapshotBearerAuth,
  });
  Object.assign(headers, defaultHeaders, agentHeaders);
  applyEnvAuthOverrides(headers);
  const { request_headers } = getCommonGatewayMetadata(parameters);
  if (request_headers) {
    Object.assign(headers, request_headers);
  }
  

  logBaiyingRequest(params.logger, "agent.sse.post", {
    resource_id: capability.metadata?.resource_id,
    resource_type: capability.resource_type,
    url: sseUrl,
    payload,
    headers,
  });

  const sseRes = await readSseEvents({
    url: sseUrl,
    payload,
    headers,
    timeoutMs: params.timeoutMs ?? 60_000,
  });
  if ("error" in sseRes) return sseRes.error;

  const contentParts: string[] = [];
  for (const event of sseRes.events) {
    const choices = Array.isArray(event.choices) ? event.choices : [];
    if (choices.length === 0) continue;
    const first = choices[0];
    if (!isRecord(first)) continue;
    const delta = first.delta;
    if (!isRecord(delta)) continue;
    const content = typeof delta.content === "string" ? delta.content : "";
    if (content) contentParts.push(content);
  }

  return {
    success: true,
    data: { content: contentParts.join(""), events: sseRes.events },
    type: "agent",
    target: { resource_id: capability.metadata?.resource_id },
  };
}
