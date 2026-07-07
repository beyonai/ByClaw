#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const requireFromScript = createRequire(import.meta.url);

const ACP = {
  jsonrpc: "2.0",
  protocolVersion: 1,
  methods: {
    initialize: "initialize",
    authenticate: "authenticate",
    sessionNew: "session/new",
    sessionLoad: "session/load",
    sessionPrompt: "session/prompt",
    sessionCancel: "session/cancel",
    sessionSetMode: "session/set_mode",
    sessionSetConfigOption: "session/set_config_option",
  },
  stopReasons: {
    endTurn: "end_turn",
    cancelled: "cancelled",
  },
  contentTypes: {
    text: "text",
    resource: "resource",
    resourceLink: "resource_link",
  },
  errorCodes: {
    parseError: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    internalError: -32603,
  },
};

const ENV = {
  frameworkEntry: "BYCLAW_REMOTE_CLAUDE_FRAMEWORK_ENTRY",
  targetAgentType: "BYCLAW_REMOTE_CLAUDE_TARGET_AGENT_TYPE",
  targetAgentTypePrefix: "BYCLAW_REMOTE_CLAUDE_TARGET_AGENT_TYPE_PREFIX",
  userCode: "BYCLAW_REMOTE_CLAUDE_USER_CODE",
  userName: "BYCLAW_REMOTE_CLAUDE_USER_NAME",
  sourceAgentType: "BYCLAW_REMOTE_CLAUDE_SOURCE_AGENT_TYPE",
  sessionIdPrefix: "BYCLAW_REMOTE_CLAUDE_SESSION_ID_PREFIX",
  language: "BYCLAW_REMOTE_CLAUDE_LANGUAGE",
  debug: "BYCLAW_REMOTE_CLAUDE_DEBUG",
  redisHost: "REDIS_HOST",
  redisPort: "REDIS_PORT",
  redisUsername: "REDIS_USERNAME",
  redisPassword: "REDIS_PASSWORD",
  redisDatabase: "REDIS_DATABASE",
  fallbackUserCode: "USER_CODE",
};

const BRIDGE = {
  source: "openclaw",
  adapterId: "byclaw-acp-adapter",
  messageIdPrefix: "msg-",
  repoByaiChannelDir: "byai-channel",
  repoByclawExeDir: "byclaw-exe",
  repoExtensionsDir: "extensions",
};

const DEFAULTS = {
  targetAgentTypePrefix: "BYCLAW_CODE_",
  sourceAgentType: "openclaw-acp-bridge",
  sessionIdPrefix: "byclaw-acp",
  language: "zh-CN",
  redisPort: 6379,
  redisDatabase: 0,
  redisHost: "127.0.0.1",
};

const BY_FRAMEWORK_RELATIVE_PATH = [
  "node_modules",
  "@byclaw",
  "by-framework",
  "dist",
  "index.js",
];

const sessions = new Map();

function readNonEmptyEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function debug(message, details) {
  if (readNonEmptyEnv(ENV.debug) !== "1") {
    return;
  }
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  process.stderr.write(`[byclaw-remote-claude-acp] ${message}${suffix}\n`);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function writeJsonRpc(payload) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: ACP.jsonrpc, ...payload })}\n`);
}

function sendResult(id, result) {
  if (id === undefined || id === null) {
    return;
  }
  writeJsonRpc({ id, result });
}

function sendError(id, code, message, data) {
  writeJsonRpc({
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function makeSessionId() {
  return `${DEFAULTS.sessionIdPrefix}-${randomHex(8)}`;
}

function normalizeSessionId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function candidateFrameworkEntries() {
  const explicit = readNonEmptyEnv(ENV.frameworkEntry);
  const candidates = [];
  if (explicit) {
    candidates.push(explicit);
  }
  try {
    candidates.push(requireFromScript.resolve("@byclaw/by-framework"));
  } catch {
    // Optional: adapter installs do not always have their own node_modules.
  }
  candidates.push(
    path.join(scriptDir, "..", ...BY_FRAMEWORK_RELATIVE_PATH),
    path.join(scriptDir, "..", "..", BRIDGE.repoByaiChannelDir, ...BY_FRAMEWORK_RELATIVE_PATH),
    path.join(
      process.cwd(),
      BRIDGE.repoByclawExeDir,
      BRIDGE.repoExtensionsDir,
      BRIDGE.repoByaiChannelDir,
      ...BY_FRAMEWORK_RELATIVE_PATH,
    ),
  );
  return [...new Set(candidates.map((item) => path.resolve(item)))];
}

async function importFramework() {
  for (const entry of candidateFrameworkEntries()) {
    if (!fs.existsSync(entry)) {
      continue;
    }
    debug("using by-framework entry", { entry });
    return import(pathToFileURL(entry).href);
  }
  throw new Error(
    [
      "@byclaw/by-framework was not found for the remote Claude bridge.",
      `Set ${ENV.frameworkEntry} to an installed @byclaw/by-framework/dist/index.js path.`,
    ].join(" "),
  );
}

function readRedisInfo() {
  return {
    host: readNonEmptyEnv(ENV.redisHost) || DEFAULTS.redisHost,
    port: readInteger(readNonEmptyEnv(ENV.redisPort), DEFAULTS.redisPort),
    username: readNonEmptyEnv(ENV.redisUsername) || undefined,
    password: readNonEmptyEnv(ENV.redisPassword) || undefined,
    db: readInteger(readNonEmptyEnv(ENV.redisDatabase), DEFAULTS.redisDatabase),
  };
}

function readInteger(raw, fallback) {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveUserCode() {
  return readNonEmptyEnv(ENV.userCode) || readNonEmptyEnv(ENV.fallbackUserCode);
}

function resolveTargetAgentType(userCode) {
  const explicit = readNonEmptyEnv(ENV.targetAgentType);
  if (explicit) {
    return explicit;
  }
  const prefix = readNonEmptyEnv(ENV.targetAgentTypePrefix) || DEFAULTS.targetAgentTypePrefix;
  return `${prefix}${userCode}`;
}

function resolveRemoteSessionId(acpSessionId, promptText, meta) {
  const metaSessionId =
    isRecord(meta) &&
    (typeof meta.byaiChannelSessionId === "string"
      ? meta.byaiChannelSessionId
      : typeof meta.byai_channel_session_id === "string"
        ? meta.byai_channel_session_id
        : typeof meta.sessionId === "string"
          ? meta.sessionId
          : "");
  const fromPrompt =
    promptText.match(/byaiChannelSessionId:\s*`?([^\s`]+)/i)?.[1] ||
    promptText.match(/"byaiChannelSessionId"\s*:\s*"([^"]+)"/i)?.[1] ||
    promptText.match(/\/by\/\.sessions\/([^\s`"')]+)/i)?.[1] ||
    "";
  const candidate = normalizeSessionId(metaSessionId || fromPrompt);
  if (candidate) {
    return candidate;
  }
  const prefix = readNonEmptyEnv(ENV.sessionIdPrefix) || DEFAULTS.sessionIdPrefix;
  return normalizeSessionId(`${prefix}-${acpSessionId}`);
}

function extractPromptText(prompt) {
  if (!Array.isArray(prompt)) {
    return typeof prompt === "string" ? prompt : safeJsonStringify(prompt);
  }
  return prompt
    .map((block) => {
      if (!isRecord(block)) {
        return String(block ?? "");
      }
      if (block.type === ACP.contentTypes.text && typeof block.text === "string") {
        return block.text;
      }
      if (block.type === ACP.contentTypes.resourceLink && typeof block.uri === "string") {
        return `Resource: ${block.uri}`;
      }
      if (block.type === ACP.contentTypes.resource && isRecord(block.resource)) {
        const resource = block.resource;
        if (typeof resource.text === "string") {
          return resource.text;
        }
        if (typeof resource.uri === "string") {
          return `Resource: ${resource.uri}`;
        }
      }
      return safeJsonStringify(block);
    })
    .filter((item) => item.trim())
    .join("\n\n");
}

function buildExtraPayload(params) {
  return {
    ext_params: {
      clientId: params.messageId,
      files: [],
      acp: {
        source: BRIDGE.source,
        bridge: BRIDGE.adapterId,
        acpSessionId: params.acpSessionId,
        remoteSessionId: params.remoteSessionId,
      },
    },
    resource_list: [],
    attachments: [],
  };
}

async function dispatchPrompt(params) {
  const framework = await importFramework();
  const { createRedis, GatewayClient, WorkerRegistry } = framework;
  if (!createRedis || !GatewayClient || !WorkerRegistry) {
    throw new Error("@byclaw/by-framework export shape is incompatible with the bridge");
  }

  const userCode = resolveUserCode();
  if (!userCode) {
    throw new Error(`${ENV.userCode} or ${ENV.fallbackUserCode} is required`);
  }

  const redis = createRedis(readRedisInfo());
  const registry = new WorkerRegistry(redis);
  const client = new GatewayClient(registry, redis);
  const targetAgentType = resolveTargetAgentType(userCode);
  const messageId = params.messageId || `${BRIDGE.messageIdPrefix}${randomHex(4)}`;
  const traceId = randomHex(16);

  try {
    debug("dispatching remote prompt", {
      targetAgentType,
      acpSessionId: params.acpSessionId,
      remoteSessionId: params.remoteSessionId,
    });
    const ack = await client.sendMessage({
      targetAgentType,
      sessionId: params.remoteSessionId,
      messageId,
      traceId,
      userCode,
      userName: readNonEmptyEnv(ENV.userName),
      sourceAgentType: readNonEmptyEnv(ENV.sourceAgentType) || DEFAULTS.sourceAgentType,
      content: params.promptText,
      extraPayload: buildExtraPayload({
        messageId,
        acpSessionId: params.acpSessionId,
        remoteSessionId: params.remoteSessionId,
      }),
      metadata: {
        language: readNonEmptyEnv(ENV.language) || DEFAULTS.language,
        user_code: userCode,
        acp_bridge: BRIDGE.adapterId,
        acp_session_id: params.acpSessionId,
        remote_session_id: params.remoteSessionId,
      },
      requireOnlineWorker: true,
    });
    if (!ack?.success) {
      throw new Error(ack?.error || `remote worker ${targetAgentType} did not acknowledge the task`);
    }
    return {
      stopReason: ACP.stopReasons.endTurn,
      messageId: ack.message_id || messageId,
      traceId: ack.trace_id || traceId,
      targetAgentType,
    };
  } finally {
    if (typeof redis.quit === "function") {
      await redis.quit();
    }
  }
}

async function handleInitialize(id) {
  sendResult(id, {
    protocolVersion: ACP.protocolVersion,
    agentCapabilities: {
      loadSession: false,
    },
    authMethods: [],
  });
}

async function handleNewSession(id) {
  const sessionId = makeSessionId();
  sessions.set(sessionId, {
    abortController: undefined,
    remoteSessionId: "",
  });
  sendResult(id, { sessionId });
}

async function handlePrompt(id, params) {
  if (!isRecord(params) || typeof params.sessionId !== "string") {
    throw new Error("session/prompt requires params.sessionId");
  }
  let session = sessions.get(params.sessionId);
  if (!session) {
    session = { abortController: undefined, remoteSessionId: "" };
    sessions.set(params.sessionId, session);
  }
  session.abortController?.abort();
  const abortController = new AbortController();
  session.abortController = abortController;
  const promptText = extractPromptText(params.prompt);
  const remoteSessionId = resolveRemoteSessionId(params.sessionId, promptText, params._meta);
  session.remoteSessionId = remoteSessionId;
  try {
    const result = await dispatchPrompt({
      acpSessionId: params.sessionId,
      remoteSessionId,
      messageId: typeof params.messageId === "string" ? params.messageId : undefined,
      promptText,
      signal: abortController.signal,
    });
    sendResult(id, {
      stopReason: result.stopReason,
      ...(typeof params.messageId === "string" ? { userMessageId: params.messageId } : {}),
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      sendResult(id, { stopReason: ACP.stopReasons.cancelled });
      return;
    }
    throw error;
  } finally {
    if (session.abortController === abortController) {
      session.abortController = undefined;
    }
  }
}

async function handleCancel(id, params) {
  if (isRecord(params) && typeof params.sessionId === "string") {
    sessions.get(params.sessionId)?.abortController?.abort();
  }
  sendResult(id, {});
}

async function handleMessage(message) {
  const id = message?.id;
  try {
    if (!isRecord(message) || message.jsonrpc !== ACP.jsonrpc || typeof message.method !== "string") {
      throw Object.assign(new Error("Invalid JSON-RPC request"), {
        code: ACP.errorCodes.invalidRequest,
      });
    }
    switch (message.method) {
      case ACP.methods.initialize:
        await handleInitialize(id);
        break;
      case ACP.methods.authenticate:
      case ACP.methods.sessionSetMode:
      case ACP.methods.sessionSetConfigOption:
        sendResult(id, {});
        break;
      case ACP.methods.sessionNew:
        await handleNewSession(id);
        break;
      case ACP.methods.sessionLoad:
        throw Object.assign(new Error("session/load is not supported by this bridge"), {
          code: ACP.errorCodes.methodNotFound,
        });
      case ACP.methods.sessionPrompt:
        await handlePrompt(id, message.params);
        break;
      case ACP.methods.sessionCancel:
        await handleCancel(id, message.params);
        break;
      default:
        throw Object.assign(new Error(`Method not found: ${message.method}`), {
          code: ACP.errorCodes.methodNotFound,
        });
    }
  } catch (error) {
    const code = Number.isInteger(error?.code) ? error.code : ACP.errorCodes.internalError;
    const messageText = error instanceof Error ? error.message : String(error);
    sendError(id, code, messageText);
  }
}

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
});

input.on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    sendError(
      null,
      ACP.errorCodes.parseError,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  void handleMessage(message);
});

for (const signalName of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signalName, () => {
    for (const session of sessions.values()) {
      session.abortController?.abort();
    }
    process.exit(0);
  });
}
