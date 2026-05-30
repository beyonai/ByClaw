#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";

const DEFAULT_CONTEXT_PATH = "/byaiService";
const DEFAULT_SIGNATURE_SALT = "{#@*A12^c0+}";
const DEFAULT_BACKEND_SERVICE_NAME = "ByaiService";
const SERVICE_DISCOVERY_INSTANCE_PREFIX = "byai_gateway:sd:instances:";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex > -1) {
      args[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }
  return args;
}

function pick(args, key, fallback) {
  return args[key] ?? fallback;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined || item === null || item === "") {
        return false;
      }
      if (Array.isArray(item) && item.length === 0) {
        return false;
      }
      return true;
    }),
  );
}

function normalizeBaseUrl(rawBaseUrl) {
  let baseUrl = rawBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl.endsWith(DEFAULT_CONTEXT_PATH)) {
    baseUrl = `${baseUrl}${DEFAULT_CONTEXT_PATH}`;
  }
  return baseUrl;
}

function composeFallbackBackendBaseUrl() {
  const protocol = process.env.BE_PROTOCOL || "http";
  const host = process.env.BE_HOST || process.env.HOST || "127.0.0.1";
  const port = process.env.BE_SERVER_PORT || "8086";
  const portPart = port ? `:${port}` : "";
  return normalizeBaseUrl(`${protocol}://${host}${portPart}`);
}

function encodeRedisCommand(args) {
  return `*${args.length}\r\n${args.map((arg) => {
    const text = String(arg ?? "");
    return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
  }).join("")}`;
}

function parseResp(buffer, offset = 0) {
  if (offset >= buffer.length) {
    return null;
  }
  const type = buffer[offset];
  const lineEnd = buffer.indexOf("\r\n", offset);
  if (lineEnd === -1) {
    return null;
  }
  const line = buffer.slice(offset + 1, lineEnd).toString("utf8");
  const next = lineEnd + 2;

  if (type === 43) {
    return { value: line, offset: next };
  }
  if (type === 45) {
    throw new Error(line);
  }
  if (type === 58) {
    return { value: Number.parseInt(line, 10), offset: next };
  }
  if (type === 36) {
    const length = Number.parseInt(line, 10);
    if (length === -1) {
      return { value: null, offset: next };
    }
    const end = next + length;
    if (buffer.length < end + 2) {
      return null;
    }
    return { value: buffer.slice(next, end).toString("utf8"), offset: end + 2 };
  }
  if (type === 42) {
    const length = Number.parseInt(line, 10);
    if (length === -1) {
      return { value: null, offset: next };
    }
    const values = [];
    let cursor = next;
    for (let index = 0; index < length; index += 1) {
      const parsed = parseResp(buffer, cursor);
      if (!parsed) {
        return null;
      }
      values.push(parsed.value);
      cursor = parsed.offset;
    }
    return { value: values, offset: cursor };
  }
  throw new Error(`不支持的 Redis 响应类型: ${String.fromCharCode(type)}`);
}

function redisCommand(socket, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis 命令超时: ${args[0]}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const parsed = parseResp(buffer);
        if (!parsed) {
          return;
        }
        cleanup();
        resolve(parsed.value);
      } catch (error) {
        cleanup();
        reject(error);
      }
    }

    socket.on("data", onData);
    socket.once("error", onError);
    socket.write(encodeRedisCommand(args));
  });
}

function connectRedis(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Redis 连接超时: ${host}:${port}`));
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function readRedisHash(key) {
  const host = firstNonEmpty(process.env.REDIS_HOST);
  const port = Number.parseInt(firstNonEmpty(process.env.REDIS_PORT, "6379"), 10);
  const db = Number.parseInt(firstNonEmpty(process.env.REDIS_DATABASE, "0"), 10);
  if (!host || !Number.isFinite(port)) {
    return {};
  }

  const timeoutMs = Math.max(
    500,
    Number.parseInt(firstNonEmpty(process.env.BYCLAW_REDIS_DISCOVERY_TIMEOUT_MS, "3000"), 10),
  );
  const socket = await connectRedis(host, port, timeoutMs);
  try {
    const username = firstNonEmpty(process.env.REDIS_USERNAME);
    const password = firstNonEmpty(process.env.REDIS_PASSWORD);
    if (password) {
      await redisCommand(socket, username ? ["AUTH", username, password] : ["AUTH", password], timeoutMs);
    }
    if (Number.isFinite(db) && db > 0) {
      await redisCommand(socket, ["SELECT", db], timeoutMs);
    }
    const values = await redisCommand(socket, ["HGETALL", key], timeoutMs);
    if (!Array.isArray(values)) {
      return {};
    }
    const result = {};
    for (let index = 0; index < values.length; index += 2) {
      result[String(values[index])] = values[index + 1];
    }
    return result;
  } finally {
    socket.end();
  }
}

function parseServiceInstance(raw) {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    const host = firstNonEmpty(parsed.host);
    const port = Number.parseInt(firstNonEmpty(parsed.port), 10);
    if (!host || !Number.isFinite(port)) {
      return undefined;
    }
    return {
      protocol: firstNonEmpty(parsed.protocol, "http"),
      host,
      port,
      pathPrefix: firstNonEmpty(parsed.path_prefix, parsed.pathPrefix, DEFAULT_CONTEXT_PATH),
      weight: Number.parseFloat(firstNonEmpty(parsed.weight, "1")) || 1,
      id: firstNonEmpty(parsed.id),
    };
  } catch {
    return undefined;
  }
}

function backendInstanceBaseUrl(instance) {
  const pathPrefix = firstNonEmpty(instance.pathPrefix, DEFAULT_CONTEXT_PATH).replace(/^\/+|\/+$/g, "");
  const prefix = pathPrefix ? `/${pathPrefix}` : "";
  return `${instance.protocol}://${instance.host}:${instance.port}${prefix}`.replace(/\/+$/g, "");
}

async function discoverBackendBaseUrl() {
  const serviceName = firstNonEmpty(process.env.BE_DOMAINNAME, DEFAULT_BACKEND_SERVICE_NAME);
  const key = `${SERVICE_DISCOVERY_INSTANCE_PREFIX}${serviceName}`;
  const values = await readRedisHash(key);
  const instances = Object.values(values)
    .map(parseServiceInstance)
    .filter(Boolean)
    .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
  if (!instances.length) {
    return { baseUrl: "", source: "redis", serviceName, redisKey: key };
  }
  return {
    baseUrl: backendInstanceBaseUrl(instances[0]),
    source: "redis",
    serviceName,
    redisKey: key,
    instanceId: instances[0].id,
  };
}

async function resolveBackendBaseUrl() {
  const explicitBaseUrl = firstNonEmpty(process.env.BYCLAW_ECOSYSTEM_API_BASE_URL);
  if (explicitBaseUrl) {
    return { baseUrl: normalizeBaseUrl(explicitBaseUrl), source: "BYCLAW_ECOSYSTEM_API_BASE_URL" };
  }

  try {
    const discovered = await discoverBackendBaseUrl();
    if (discovered.baseUrl) {
      return discovered;
    }
  } catch (error) {
    const fallback = composeFallbackBackendBaseUrl();
    return {
      baseUrl: fallback,
      source: "fallback_after_redis_error",
      discoveryError: error instanceof Error ? error.message : String(error),
    };
  }

  if (process.env.KN_MANAGER_URL) {
    return { baseUrl: normalizeBaseUrl(process.env.KN_MANAGER_URL), source: "KN_MANAGER_URL" };
  }

  return { baseUrl: composeFallbackBackendBaseUrl(), source: "HOST_BE_SERVER_PORT" };
}

async function composeBackendBaseUrl() {
  return (await resolveBackendBaseUrl()).baseUrl;
}

async function endpoint(pathname) {
  const baseUrl = await composeBackendBaseUrl();
  return `${baseUrl}/${pathname.replace(/^\/+/, "")}`;
}

function readStdinText() {
  try {
    if (process.stdin.isTTY) {
      return "";
    }
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseJson(value, label) {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON: ${error.message}`);
  }
}

function readJsonFile(filePath) {
  try {
    const resolvedPath = expandHome(filePath);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch {
    return undefined;
  }
}

function expandHome(filePath) {
  if (!filePath) {
    return "";
  }
  const text = String(filePath);
  if (text === "~") {
    return os.homedir();
  }
  if (text.startsWith("~/")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    const text = String(value).trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function normalizeAuthContext(rawAuth) {
  if (!rawAuth || typeof rawAuth !== "object" || Array.isArray(rawAuth)) {
    return {};
  }

  const nestedCandidates = [
    rawAuth,
    rawAuth.data,
    rawAuth.user,
    rawAuth.userInfo,
    rawAuth.currentUser,
    rawAuth.loginInfo,
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));

  const normalized = { ...rawAuth };
  for (const item of nestedCandidates) {
    normalized.sessionId = firstNonEmpty(
      normalized.sessionId,
      item.sessionId,
      item.session_id,
      item.session,
    );
    normalized.beyondToken = firstNonEmpty(
      normalized.beyondToken,
      item.beyondToken,
      item.beyond_token,
      item["Beyond-Token"],
    );
    normalized.userCode = firstNonEmpty(
      normalized.userCode,
      item.userCode,
      item.user_code,
      item.uc,
    );
    normalized.user_id = firstNonEmpty(
      normalized.user_id,
      item.user_id,
      item.userId,
      item.id,
    );
    if (item.headers && typeof item.headers === "object") {
      normalized.headers = {
        ...(normalized.headers || {}),
        ...item.headers,
      };
    }
  }

  return compactObject(normalized);
}

function mergeAuthContext(current, next) {
  const normalizedNext = normalizeAuthContext(next);
  return compactObject({
    ...current,
    ...normalizedNext,
    headers: {
      ...(current.headers || {}),
      ...(normalizedNext.headers || {}),
    },
  });
}

function pickHeader(headers, name) {
  if (!headers || typeof headers !== "object") {
    return "";
  }
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === expected) {
      return firstNonEmpty(value);
    }
  }
  return "";
}

function candidateAuthFiles() {
  const stateDir = expandHome(
    firstNonEmpty(
      process.env.OPENCLAW_STATE_DIR,
      process.env.OPENCLAW_HOME,
      path.join(os.homedir(), ".openclaw"),
    ),
  );
  const explicitAuthFile = expandHome(process.env.BAIYING_AUTH_FILE);
  const candidates = [
    path.join(os.homedir(), ".openclaw", "workspace", "baiying-session.json"),
    path.join(stateDir, "workspace", "baiying-session.json"),
    path.join(stateDir, "identity", "by_user_info.json"),
    "/by/.openclaw/workspace/baiying-session.json",
    "/by/.openclaw/identity/by_user_info.json",
    explicitAuthFile,
  ]
    .map(expandHome)
    .filter(Boolean);

  return [...new Set(candidates)];
}

function loadAuthContext() {
  let auth = {};
  for (const filePath of candidateAuthFiles()) {
    const loaded = readJsonFile(filePath);
    if (loaded) {
      auth = mergeAuthContext(auth, loaded);
    }
  }
  return auth;
}

function resolveAuthValues(auth) {
  const authHeadersValue = auth.headers && typeof auth.headers === "object" ? auth.headers : {};
  const sessionId = firstNonEmpty(
    process.env.BAIYING_SESSION,
    process.env.SESSION_ID,
    auth.session,
    auth.sessionId,
    auth.session_id,
    pickHeader(authHeadersValue, "x-signature-sessionId"),
    process.env.BYCLAW_SESSION,
    process.env.BYCLAW_ECOSYSTEM_SESSION,
  );
  return {
    sessionId,
    beyondToken: firstNonEmpty(
      process.env.BEYOND_TOKEN,
      auth.beyondToken,
      auth.beyond_token,
      auth["Beyond-Token"],
      pickHeader(authHeadersValue, "Beyond-Token"),
      process.env.BYCLAW_BEYOND_TOKEN,
      process.env.BYCLAW_ECOSYSTEM_BEYOND_TOKEN,
    ),
    userCode: firstNonEmpty(
      process.env.USER_CODE,
      auth.userCode,
      auth.user_code,
      auth.uc,
      process.env.BYCLAW_ECOSYSTEM_USER_CODE,
    ),
    signatureSalt: firstNonEmpty(
      process.env.BYCLAW_ECOSYSTEM_SIGNATURE_SALT,
      process.env.BYCLAW_SIGNATURE_SALT,
      DEFAULT_SIGNATURE_SALT,
    ),
  };
}

function buildSignatureHeaders(userCode, body) {
  if (!userCode) {
    return {};
  }
  const nonce = crypto.randomUUID();
  const timestamp = Date.now().toString();
  const salt = firstNonEmpty(process.env.BYCLAW_ECOSYSTEM_SIGNATURE_SALT, process.env.BYCLAW_SIGNATURE_SALT, DEFAULT_SIGNATURE_SALT);
  const signature = crypto
    .createHash("md5")
    .update(`${userCode}${nonce}${timestamp}${body || ""}${salt}`, "utf8")
    .digest("hex");
  return {
    "x-signature-nonce": nonce,
    "x-signature-timestamp": timestamp,
    "x-signature-value": signature,
  };
}

function appendCookie(headers, cookie) {
  if (!cookie) {
    return;
  }
  const existing = headers.Cookie || headers.cookie;
  if (!existing) {
    headers.Cookie = cookie;
    return;
  }
  headers.Cookie = `${existing}; ${cookie}`;
  delete headers.cookie;
}

function authHeaders(method, signingBody) {
  const auth = loadAuthContext();
  const authValues = resolveAuthValues(auth);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(auth.headers || {}),
  };

  if (process.env.BAIYING_AGENT_AUTH) {
    headers.Authorization = process.env.BAIYING_AGENT_AUTH;
  }
  if (authValues.beyondToken) {
    headers["Beyond-Token"] = authValues.beyondToken;
  }
  if (authValues.userCode) {
    headers["X-User-Id"] = authValues.userCode;
  }
  if (authValues.sessionId) {
    headers["x-signature-sessionId"] = authValues.sessionId;
    headers["X-Session-Id"] = authValues.sessionId;
  }

  const cookies = [];
  if (authValues.sessionId) {
    cookies.push(`SESSION=${authValues.sessionId}`);
    cookies.push(`PORTAL-SESSION=${authValues.sessionId}`);
  }
  if (auth.user_id) {
    cookies.push(`currentUserId=${auth.user_id}`);
  }
  if (cookies.length) {
    appendCookie(headers, cookies.join("; "));
  }

  return {
    ...headers,
    ...buildSignatureHeaders(authValues.userCode, signingBody),
  };
}

function signingBodyFor(method, url, bodyText) {
  if (method === "POST" || method === "PUT") {
    return bodyText || "";
  }
  if (method === "GET") {
    try {
      const parsed = new URL(url);
      return parsed.search ? parsed.search.slice(1) : "";
    } catch {
      return "";
    }
  }
  return "";
}

function authSummary() {
  const values = resolveAuthValues(loadAuthContext());
  return {
    hasSession: Boolean(values.sessionId),
    hasBeyondToken: Boolean(values.beyondToken),
    hasUserCode: Boolean(values.userCode),
    canSign: Boolean(values.userCode),
  };
}

async function requestJson(method, url, payload) {
  const normalizedMethod = method.toUpperCase();
  const bodyText = payload === undefined ? "" : JSON.stringify(payload);
  const signingBody = signingBodyFor(normalizedMethod, url, bodyText);
  const response = await fetch(url, {
    method: normalizedMethod,
    headers: authHeaders(normalizedMethod, signingBody),
    body: bodyText || undefined,
  });
  const text = await response.text();
  let body;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      if (response.ok) {
        throw new Error(`接口响应不是合法 JSON: ${error.message}`);
      }
    }
  }

  if (!response.ok) {
    const message = body?.msg || body?.message || body?.error_description || text || response.statusText || "HTTP error";
    throw new Error(`HTTP ${response.status} ${url}: ${message}`);
  }

  if (body && Object.prototype.hasOwnProperty.call(body, "code")) {
    const okCodes = [0, 200, "0", "200"];
    if (!okCodes.includes(body.code)) {
      throw new Error(body.msg || body.message || `接口返回异常 code=${body.code}`);
    }
    return body.data ?? body;
  }

  return body;
}

function buildPlanPayload(args, stdinJson) {
  return compactObject({
    originalText: pick(args, "text", stdinJson?.originalText || stdinJson?.text),
    text: pick(args, "text", stdinJson?.text || stdinJson?.originalText),
    connectorCode: pick(args, "connector-code", stdinJson?.connectorCode),
    sourceUrl: pick(args, "source-url", stdinJson?.sourceUrl),
    scope: pick(args, "scope", stdinJson?.scope),
    knowledgeBaseId: pick(args, "knowledge-base-id", stdinJson?.knowledgeBaseId),
    knowledgeBaseResourceId: toNumber(
      pick(args, "knowledge-base-resource-id", stdinJson?.knowledgeBaseResourceId),
    ),
    knowledgeBaseName: pick(args, "knowledge-base-name", stdinJson?.knowledgeBaseName),
    catalogId: toNumber(pick(args, "catalog-id", stdinJson?.catalogId)),
    project: pick(args, "project", stdinJson?.project),
    product: pick(args, "product", stdinJson?.product),
    customer: pick(args, "customer", stdinJson?.customer),
    domain: pick(args, "domain", stdinJson?.domain),
    signalTags: splitList(pick(args, "signal-tags", stdinJson?.signalTags)),
    chatSessionId: pick(args, "chat-session-id", stdinJson?.chatSessionId),
    chatQueryMessageId: pick(args, "chat-query-message-id", stdinJson?.chatQueryMessageId),
  });
}

function resolveStartPayload(args, stdinJson) {
  const planJson = parseJson(args["plan-json"], "plan-json");
  const plan = planJson || stdinJson?.plan || stdinJson;
  if (!plan || Object.keys(plan).length === 0) {
    throw new Error("缺少 plan，请通过 --plan-json 或 stdin 传入 plan JSON");
  }
  return { plan };
}

function render(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function printHelp() {
  const backend = await resolveBackendBaseUrl();
  render({
    name: "bykc-ecosystem-collect",
    commands: {
      plan: "生成生态采集计划，调用 /ecosystemCollection/skill/plan",
      start: "按已确认的 plan 启动采集，调用 /ecosystemCollection/skill/start",
      run: "查询运行详情，调用 /ecosystemCollection/runs/detail",
    },
    examples: [
      "node bykc-ecosystem-collect.mjs plan --text \"采集这个知乎链接\" --source-url \"https://www.zhihu.com/question/...\"",
      "node bykc-ecosystem-collect.mjs start --plan-json '{\"connectorCode\":\"web\",\"sourceUrl\":\"https://example.com\"}'",
      "node bykc-ecosystem-collect.mjs run --run-id 10001",
    ],
    env: {
      BE_DOMAINNAME: "ByaiService",
      REDIS_HOST: "Redis 服务发现地址；沙箱内必须可访问",
      REDIS_PORT: "6379",
      REDIS_DATABASE: "0",
      HOST: "127.0.0.1",
      BE_HOST: "可选，优先于 HOST",
      BE_SERVER_PORT: "8086",
      BYCLAW_ECOSYSTEM_API_BASE_URL: "可选，仅本地调试强制指定后端地址；正式链路优先 Redis 服务发现",
      contextPath: DEFAULT_CONTEXT_PATH,
      OPENCLAW_STATE_DIR: "可选，默认 ~/.openclaw；脚本会自动读取 identity/by_user_info.json",
      BAIYING_AUTH_FILE: "可选，本地调试认证文件；默认 ~/.openclaw/workspace/baiying-session.json",
      BAIYING_SESSION: "运行时自动注入当前门户 SESSION",
      BEYOND_TOKEN: "运行时自动注入当前门户 Beyond-Token",
      USER_CODE: "运行时自动注入当前门户用户编码，用于生成 x-signature-*",
      BYCLAW_ECOSYSTEM_SESSION: "仅本地调试兜底，不要写入共用 .env",
      BYCLAW_ECOSYSTEM_USER_CODE: "仅本地调试兜底，不要写入共用 .env",
      BYCLAW_ECOSYSTEM_SIGNATURE_SALT: "可选，默认使用前端同款签名盐",
    },
    backend,
    auth: authSummary(),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";
  const stdinText = readStdinText().trim();
  const stdinJson = parseJson(stdinText, "stdin") || {};

  if (command === "help" || args.help) {
    await printHelp();
    return;
  }

  if (command === "plan") {
    const payload = buildPlanPayload(args, stdinJson);
    if (args["dry-run"]) {
      render({ ok: true, action: "plan", dryRun: true, backend: await resolveBackendBaseUrl(), auth: authSummary(), payload });
      return;
    }
    const plan = await requestJson("POST", await endpoint("/ecosystemCollection/skill/plan"), payload);
    render({
      ok: true,
      action: "plan",
      ready: Boolean(plan?.ready),
      missingActions: plan?.missingActions || [],
      plan,
      card: plan?.card,
      message: plan?.summary || plan?.message || "已生成生态采集计划",
    });
    return;
  }

  if (command === "start") {
    const payload = resolveStartPayload(args, stdinJson);
    if (args["dry-run"]) {
      render({ ok: true, action: "start", dryRun: true, backend: await resolveBackendBaseUrl(), auth: authSummary(), payload });
      return;
    }
    const result = await requestJson("POST", await endpoint("/ecosystemCollection/skill/start"), payload);
    render({
      ok: true,
      action: "start",
      taskId: result?.taskId,
      runId: result?.runId,
      status: result?.status,
      targetName: result?.targetName,
      message: result?.message || "生态采集任务已启动",
      raw: result,
    });
    return;
  }

  if (command === "run") {
    const runId = pick(args, "run-id", stdinJson?.runId);
    if (!runId) {
      throw new Error("缺少 run-id");
    }
    if (args["dry-run"]) {
      render({ ok: true, action: "run", dryRun: true, backend: await resolveBackendBaseUrl(), auth: authSummary(), runId });
      return;
    }
    const url = new URL(await endpoint("/ecosystemCollection/runs/detail"));
    url.searchParams.set("runId", runId);
    const result = await requestJson("GET", url.toString());
    render({
      ok: true,
      action: "run",
      runId,
      status: result?.run?.status || result?.status,
      raw: result,
    });
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

main().catch(async (error) => {
  let backend;
  try {
    backend = await resolveBackendBaseUrl();
  } catch (resolveError) {
    backend = { error: resolveError instanceof Error ? resolveError.message : String(resolveError) };
  }
  render({
    ok: false,
    error: error.message,
    backend,
    auth: authSummary(),
  });
  process.exitCode = 1;
});
