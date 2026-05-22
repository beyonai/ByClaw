import path from "node:path";
import { homedir } from "node:os";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  createRedis,
  GatewayDataEmitter,
  EventType,
  SseReasonMessageType,
  SseMessageType,
} from "@byclaw/by-framework";
import type { Redis } from "ioredis";
import { GatewayClient } from "openclaw/plugin-sdk/gateway-runtime";
import type { Capability, Dict, ExecutorResponse } from "../types.js";
import { asString, isRecord } from "../types.js";
import type { AuthContext } from "../auth.js";
import { applyEnvAuthOverrides, mergeAuthHeaders, normalizeCustomHeaders } from "../auth.js";
import { makeError } from "../errors.js";
import { readSseEvents } from "../http.js";
import { logBaiyingRequest, type BaiyingEnhanceLogger } from "../debug-channel.js";
import { getCommonGatewayMetadata, readRedisConfig } from "../doc-shared.js";

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

async function getA2ASseUrl(cardUrl: string, headers: Record<string, any> = {}) {
  // A2A 类型的数字员工，这里拿到的sseUrl只是`cardUrl`，需要先查一次真正的url
  const response = await fetch(cardUrl, {
    method: "GET",
    headers,
  });
  try {
    const cardJson = await response.json();
    if (!cardJson) {
      return "";
    }
    let { url } = cardJson;
    const cardUrlObj = new URL(cardUrl);
    const parameters = cardUrlObj.searchParams;
    if (parameters.size) {
      const urlObj = new URL(url);
      // Copy all parameters to the rpc url
      for (const [key, value] of parameters) {
        urlObj.searchParams.set(key, value);
      }
      return urlObj.toString();
    }
    return url;
  } catch (error) {
    return "";
  }
}

async function withGatewayClient<T>(
  opts: ConstructorParameters<typeof GatewayClient>[0],
  fn: (client: GatewayClient) => Promise<T>,
): Promise<T> {
  let client!: GatewayClient;

  await new Promise<void>((resolve, reject) => {
    client = new GatewayClient({
      ...opts,
      onHelloOk: () => resolve(),
      onConnectError: (err: Error) => reject(err),
    });

    client.start();
  });

  let result: T;
  try {
    result = await fn(client);
  } finally {
    await client.stopAndWait();
  }
  return result;
}

async function getHistoryBySessionKey(sessionKey: string) {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!token || !sessionKey) {
    return [];
  }

  try {
    const history = await withGatewayClient({ token }, (client) =>
      client.request("chat.history", { sessionKey, limit: 20 }),
    );
    if (!isRecord(history) || !Array.isArray(history.messages)) {
      return [];
    }
    return history.messages.reduce((acc, cur) => {
      const { role, content } = cur;
      if (role !== "user" && role !== "assistant") {
        return acc;
      }
      const text = content.map((item: { type: string; text: string }) => {
        if (item.type === "text" && item.text?.trim()) {
          return item.text.trim();
        }
        return "";
      }).filter(Boolean).join("\n");
      if (!text) {
        return acc;
      }
      acc.push(`[${role}] said: ${text}`);
      return acc;
    }, []).join("\n");
  } catch (error) {
    console.error("Failed to get gateway history:", error);
    return "";
  }
}

async function buildA2aJsonRpcRequest(chatContent: string, historySessionKey?: string) {
  const parts = [{ kind: "text", text: chatContent ?? "" }];
  if (historySessionKey) {
    const history = await getHistoryBySessionKey(historySessionKey);
    if (history) {
      parts.unshift({ kind: "text", text: history });
    }
  }
  return {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "message/stream",
    params: {
      message: {
        messageId: crypto.randomUUID(),
        role: "user",
        parts,
        contextId: crypto.randomUUID(),
        kind: "message",
      },
    },
  };
}

function extractTextFromA2aParts(parts: unknown): string {
  if (!Array.isArray(parts) || parts.length === 0) return "";
  let out = "";
  for (const part of parts) {
    if (!isRecord(part)) continue;
    const kind = typeof part.kind === "string" ? part.kind.toLowerCase() : "";
    if (kind === "text") {
      const t = typeof part.text === "string" ? part.text : "";
      out += t;
    }
  }
  return out;
}

type A2aChunk = { chunk: Dict; isAnswer: boolean; text: string };

/** Mirrors Java A2aRouteService.convertA2aResponseToInternalLine. Returns null when nothing should be forwarded. */
function convertA2aResponseToOpenAiChunk(rpc: unknown): A2aChunk | null {
  if (!isRecord(rpc)) return null;
  const result = isRecord(rpc.result) ? rpc.result : null;
  if (!result) return null;

  let kind = typeof result.kind === "string" ? result.kind.toLowerCase() : "";
  if (!kind) {
    if ("artifact" in result) kind = "artifact-update";
    else if ("history" in result) kind = "task";
    else if (isRecord(result.status) && "state" in result.status) kind = "status-update";
    else if ("parts" in result && "role" in result) kind = "message";
  }

  let text = "";
  let contentType: string = SseMessageType.text;
  let isAnswer = true;

  if (kind === "task") {
    const status = isRecord(result.status) ? result.status : null;
    const message = status && isRecord(status.message) ? status.message : null;
    text = message ? extractTextFromA2aParts(message.parts) : "";
    contentType = SseReasonMessageType.think_sub_title;
    isAnswer = false;
  } else if (kind === "message") {
    text = extractTextFromA2aParts(result.parts);
  } else if (kind === "status-update") {
    const status = isRecord(result.status) ? result.status : null;
    const state = status && typeof status.state === "string" ? status.state : "";
    const message = status && isRecord(status.message) ? status.message : null;
    text = message ? extractTextFromA2aParts(message.parts) : "";
    contentType = state.toLowerCase() === "auth_required" ? "4003" : "1002";
  } else if (kind === "artifact-update") {
    const artifact = isRecord(result.artifact) ? result.artifact : null;
    text = artifact ? extractTextFromA2aParts(artifact.parts) : "";
  } else {
    return null;
  }

  return {
    chunk: {
      choices: [{ index: 0, delta: { role: "assistant", content: text } }],
      contentType,
    },
    isAnswer,
    text,
  };
}

/** OpenAI-style fallback, mirrors Java A2aRouteService.convertOpenAiChunkToInternalLine. */
function convertOpenAiChunkToA2aChunk(rpc: unknown): A2aChunk | null {
  if (!isRecord(rpc)) return null;
  const choices = Array.isArray(rpc.choices) ? rpc.choices : null;
  if (!choices || choices.length === 0) return null;
  let text = "";
  let hasContent = false;
  for (const c of choices) {
    if (!isRecord(c)) continue;
    const delta = isRecord(c.delta) ? c.delta : null;
    if (delta && typeof delta.content === "string") {
      hasContent = true;
      text += delta.content;
    }
  }
  if (!hasContent) return null;
  const chunk: Dict = { ...rpc };
  if (typeof chunk.contentType !== "string") chunk.contentType = "1002";
  return { chunk, isAnswer: true, text };
}

function extractA2aRpcError(rpc: unknown): string | null {
  if (!isRecord(rpc)) return null;
  const err = rpc.error;
  if (!isRecord(err)) return null;
  return typeof err.message === "string" ? err.message : "A2A agent error";
}

/** Mirror of `BaiYingExecutor._execute_agent`. */
export async function executeAgent(params: {
  capability: Capability;
  parameters: Dict;
  authContext: AuthContext;
  session?: string;
  timeoutMs?: number;
  logger?: BaiyingEnhanceLogger;
  signal?: AbortSignal;
}): Promise<ExecutorResponse> {
  const { capability, parameters } = params;
  const agent = isRecord(capability.agent) ? (capability.agent as Dict) : {};
  let sseUrl = asString(agent.sse_url);

  const resourceContext = parameters.resource_context as {
    root_agent?: Record<string, unknown>;
    selected_resource?: Record<string, unknown>;
    channel_session_id?: string;
    channel_trace_id?: string;
    session_key: string;
    parent_session_key?: string;
  };
  const sessionId = String(parameters.session_id || resourceContext.channel_session_id || "");
  const traceId = String(parameters.trace_id || resourceContext.channel_trace_id || "");
  const chatContent = String(parameters.query ?? parameters.message ?? "");
  const sessionKey = resourceContext.session_key;
  const parentSessionKey = String(resourceContext.parent_session_key ?? "");

  const isSubagent = !!parameters.is_subagent;

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
          const result = await dynamicAgentHandler(chatContent, sessionId, traceId);
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

  if (agent.integration_type === "PAGE" && agent.agent_home_url) {
    const { language } = getCommonGatewayMetadata(parameters);
    const normalizeAgentId = (resourceId: string) => {
      if (!resourceId) return "";
      let agentId = resourceId;
      if (resourceId.startsWith("baiying_")) {
        agentId = resourceId.replace("baiying_", "");
      }
      if (agentId.startsWith("baiying-agent-")) {
        agentId = agentId.replace("baiying-agent-", "");
      }
      return agentId;
    };

    let responseText = "";
    if (language === "en_US") {
      responseText = `PAUSED_AWAITING_USER_PAGE_ACTION

A page-side workflow has been handed off to the user and is now waiting for them
to complete a manual UI action (filling a form, selecting an option, or clicking
a confirm button) before any data can be returned. This is a paused state —
the call did NOT fail, and no work product has been produced yet.

How you should respond depends on your role:

—— (A) If you are a subagent (you were spawned via sessions_spawn) ——

This is NOT a failure. Do NOT retry baiying_call. Do NOT report an error to your
parent agent. Do NOT fabricate, summarize, or guess at any data — nothing has
been returned yet.

Your only job now is to hand this paused state back to your parent agent in a
clear, short message. Reply with one or two sentences (no preamble, no tool
calls) that make all of the following explicit to the parent:

  - the page-side workflow is now waiting for the USER to finish an action on
    the page (filling a form, selecting an option, or clicking confirm);
  - this is a "paused / awaiting user" state, NOT a failure, NOT a timeout,
    and NOT a cancellation — the parent agent must not interpret it as an
    error;
  - the parent agent should ALSO wait — when the user finishes the page
    action, the real result will arrive automatically as a follow-up message;
  - in the meantime, the parent agent must NOT retry baiying_call, must NOT
    escalate, must NOT claim the task is done, and must NOT make up any
    results.
  - when the real result arrives, the parent agent must handle it first. If the task is done, then NOT call sessions_spawn to spawn this agent again.

Then end your turn. Take no further action.

—— (B) If you are the main / orchestrator agent (no parent above you,
       OR you are receiving this as a subagent completion event) ——

You MUST NOT:
  - claim the report / task / query is "ready", "done", "generated",
    "completed", or any synonym — none of those are true;
  - claim the task failed, was canceled, or hit an error — also untrue;
  - invent, summarize, or guess at any data, numbers, or report contents —
    nothing has been returned to summarize.

You MUST:
  - tell the user, in your own natural voice, that the page-side workflow
    needs them to finish an action on the page (form / selection / confirm),
    and that the result will come back automatically once they're done;
  - then stop your turn and wait. The next real signal will be the user
    reporting that they completed the page action.`;
    } else {
      responseText = `PAUSED_AWAITING_USER_PAGE_ACTION

刚才已经把后续工作交给了页面端，现在正在等用户在页面上手动完成一个操作（填写表单、选择选项、或者点击确认按钮）才能继续。

注意：这次工具调用本身是成功的，但任务并没有完成、也没有任何数据产出。这是「已暂停-等待用户」状态，不是失败，也不要重试 baiying_call。

你应该如何回复，取决于你当前的角色：

—— (A) 如果你是子 agent（你是被 sessions_spawn 派出来的）——

这不是失败。不要重试 baiying_call。不要向上层 agent 报错。不要编造、总结或猜测任何数据——目前还没有任何数据返回。

你现在唯一要做的事，是用一段简短清楚的话，把当前这个「已暂停」状态交回给上层 agent。回复一两句话就够（不要前言、不要再调用任何工具），但必须把下面这几点对上层 agent 讲清楚：

  - 页面端流程现在正在等「用户」在页面上完成一个操作（填表 / 选择 / 点击确认）；
  - 这是「已暂停-等待用户」状态，不是失败、不是超时、也不是被取消——
    上层 agent 不能把它当作错误来处理；
  - 上层 agent 也应该一起等——等用户在页面上完成操作后，真正的结果
    会作为后续消息自动到达；
  - 在此期间，上层 agent 不要重试 baiying_call、不要升级处理、不要谎称
    任务已完成，更不要编造任何结果。
  - 当真正的结果到达后，上层 agent 应优先处理结果。如果任务已完成，不要再次调用 sessions_spawn 来派生当前 agent。

写完之后就结束本轮，不要再做其它事情。

—— (B) 如果你是主 agent / 调度 agent
       （你头上没有更上层的 agent，或者你是作为「子任务完成事件」收到这段内容的）——

你绝对不能：
  - 说报表/任务/查询「已生成」「已完成」「已就绪」「搞定了」之类的话——这些都不是事实；
  - 说任务失败、被取消、或出错了——这同样不是事实；
  - 编造、猜测、总结任何数据、数字、报表内容——目前没有任何数据返回，没有可以总结的东西。

你必须：
  - 用你自己自然的口吻告诉用户：页面端流程需要他到页面上完成一个操作
    （填表 / 选择 / 确认），完成之后结果会自动回来；
  - 然后结束本轮对话，等待用户。下一个真正的信号会是用户回来告诉你
    他已经在页面上完成了操作。`;
}

    const agentId = normalizeAgentId(capability.metadata.resource_id);
    return {
      success: true,
      content: [{
        type: "text",
        text: responseText,
      }],
      details: {
        text: responseText,
        /**
         * 先缓存起来，等主agent启动->thinking->开始输出内容前，再emit chunk
         * 处理逻辑都在 `byai-channel/src/agent-event.ts`
         */
        toBeEmittedChunk: {
          data: {
            sessionId,
            traceId,
            agentId,
            isSubagent,
            agentDescription: capability.description,
            args: {
              ...(params.parameters.parameters ?? {}),
              input: chatContent,
            }
          },
          options: {
            contentType: SseReasonMessageType.agent_card,
            parentMessageId: "-1",
            eventType: EventType.ANSWER_DELTA,
          }
        }
      },
    };
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

  const byFrameworkEmitter = generateByFrameworkEmitter();
  const sendByFrameworkStreamData = createSerializedByFrameworkStreamSender(
    byFrameworkEmitter,
    {
      id: crypto.randomUUID(),
      sessionId,
      traceId,
      parentMessageId: parameters.tool_call_id as string,
    },
  );

  if (agent.integration_type === "A2A") {
    const cardUrl = sseUrl;
    /** 从 A2A 卡片 URL 获取真正的 SSE URL */
    const rpcUrl = await getA2ASseUrl(cardUrl, headers);
    if (!rpcUrl) {
      return makeError("SSE_URL_NOT_FOUND", `Cannot fetch sse url from A2A url: ${cardUrl}`);
    }

    const jsonRpcPayload = await buildA2aJsonRpcRequest(chatContent, isSubagent ? parentSessionKey : sessionKey);

    logBaiyingRequest(params.logger, "agent.sse.post", {
      resource_id: capability.metadata?.resource_id,
      resource_type: capability.resource_type,
      url: rpcUrl,
      payload: jsonRpcPayload,
      headers,
    });

    const answerParts: string[] = [];
    let capturedError: string | null = null;

    const a2aRes = await readSseEvents({
      url: rpcUrl,
      payload: jsonRpcPayload,
      headers,
      timeoutMs: params.timeoutMs,
      onEventStream: (raw) => {
        const errMsg = extractA2aRpcError(raw);
        if (errMsg) {
          capturedError = errMsg;
          return;
        }
        const out = convertA2aResponseToOpenAiChunk(raw) ?? convertOpenAiChunkToA2aChunk(raw);
        if (!out) return;
        sendByFrameworkStreamData.enqueue(out.chunk);
        if (out.isAnswer && out.text) answerParts.push(out.text);
      },
    });
    if ("error" in a2aRes) return a2aRes.error;

    await sendByFrameworkStreamData.awaitAll();

    if (capturedError) {
      return makeError("A2A_AGENT_ERROR", capturedError);
    }

    return {
      success: true,
      content: { type: "text", text: answerParts.join("") },
      type: "agent",
      target: { resource_id: capability.metadata?.resource_id },
    };
  }

  logBaiyingRequest(params.logger, "agent.sse.post", {
    resource_id: capability.metadata?.resource_id,
    resource_type: capability.resource_type,
    url: sseUrl,
    payload,
    headers,
  });

  const contentParts: string[] = [];
  const sseRes = await readSseEvents({
    url: sseUrl,
    payload,
    headers,
    timeoutMs: params.timeoutMs,
    onEventStream: (data) => {
      const content = extractTextContentFromEventData(data);
      if (content) contentParts.push(content);
      sendByFrameworkStreamData.enqueue(data);
    },
  });
  if ("error" in sseRes) return sseRes.error;

  await sendByFrameworkStreamData.awaitAll();

  return {
    success: true,
    content: {
      type: "text",
      text: contentParts.join(""),
    },
    type: "agent",
    target: { resource_id: capability.metadata?.resource_id },
  };
}

function extractTextContentFromEventData(data: Dict) {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  if (choices.length === 0) return "";
  const first = choices[0];
  if (!isRecord(first)) return "";
  const delta = first.delta;
  if (!isRecord(delta)) return "";
  const content = typeof delta.content === "string" ? delta.content : "";
  return content;
}

function createRedisInst() {
  const config = readRedisConfig();
  return createRedis({
    host: config.host,
    port: config.port,
    db: config.db,
    username: config.username,
    password: config.password,
  }) as Redis;
}

function generateByFrameworkEmitter() {
  const redis = createRedisInst();
  const userCode = process.env.USER_CODE ?? "";
  const sourceAgentType = `BYCLAW_EXE_${userCode}`;
  return new GatewayDataEmitter(redis, {
    sourceAgentType,
  });
}

function createSerializedByFrameworkStreamSender(emitter: GatewayDataEmitter, params: {
  id: string;
  sessionId: string;
  traceId: string;
  parentMessageId?: string;
}) {
  let previousEmit = Promise.resolve();

  return {
    enqueue(data: Dict) {
      const currentEmit = (async () => {
        await previousEmit;
        await sendSseStreamDataViaByFramework(data, emitter, params);
      })();
      previousEmit = currentEmit.catch((error: unknown) => {
        console.error("[ASK_AGENT] send by-framework stream data failed", error);
      });
    },
    async awaitAll() {
      await previousEmit;
    },
  };
}

async function sendSseStreamDataViaByFramework(data: Dict, emitter: GatewayDataEmitter, params: {
  id: string;
  sessionId: string;
  traceId: string;
  parentMessageId?: string;
}) {
  await emitter.emitEvent({
    sessionId: params.sessionId,
    traceId: params.traceId,
    data: {
      contentType: SseMessageType.text,
      ...data,
      id: params.id,
      created: Math.floor(Date.now() / 1000),
      model: "",
      object: "",
      orderId: null,
      parentOrderId: params.parentMessageId,
    },
    eventType: EventType.REASONING_LOG_DELTA,
  });
}
