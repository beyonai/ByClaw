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
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const eqIndex = token.indexOf("=");
    const key = eqIndex > -1 ? token.slice(2, eqIndex) : token.slice(2);
    const value = eqIndex > -1 ? token.slice(eqIndex + 1) : argv[index + 1];
    const finalValue = value === undefined || value.startsWith("--") ? true : value;
    if (eqIndex === -1 && finalValue !== true) {
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      args[key] = Array.isArray(args[key]) ? [...args[key], finalValue] : [args[key], finalValue];
    } else {
      args[key] = finalValue;
    }
  }
  return args;
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

function pick(args, key, fallback) {
  return args[key] ?? fallback;
}

function firstPresent(args, keys) {
  for (const key of keys) {
    if (args[key] !== undefined && args[key] !== true) {
      return args[key];
    }
  }
  return undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
      if (item && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length === 0) {
        return false;
      }
      return true;
    }),
  );
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

function readTextFile(filePath) {
  return fs.readFileSync(expandHome(filePath), "utf8");
}

function readJsonFile(filePath) {
  return JSON.parse(readTextFile(filePath));
}

function readJsonFileIfExists(filePath) {
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
  if (!value || value === true) {
    return undefined;
  }
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON: ${error.message}`);
  }
}

function parseMaybeJsonText(text) {
  if (!text || !text.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function looksLikeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function normalizeBaseUrl(rawBaseUrl) {
  let baseUrl = rawBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl.endsWith(DEFAULT_CONTEXT_PATH)) {
    baseUrl = `${baseUrl}${DEFAULT_CONTEXT_PATH}`;
  }
  return baseUrl;
}

function composeHostBackendBaseUrl() {
  const protocol = process.env.BE_PROTOCOL || "http";
  const host = firstNonEmpty(process.env.HOST, "127.0.0.1");
  if (/^https?:\/\//i.test(host)) {
    return normalizeBaseUrl(host);
  }
  const port = process.env.BE_SERVER_PORT || "8086";
  const hasPort = /:\d+$/.test(host);
  const portPart = port && !hasPort ? `:${port}` : "";
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
  const timeoutMs = Math.max(500, Number.parseInt(firstNonEmpty(process.env.BYCLAW_REDIS_DISCOVERY_TIMEOUT_MS, "3000"), 10));
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
    .sort((left, right) => right.weight - left.weight || firstNonEmpty(left.id).localeCompare(firstNonEmpty(right.id)));
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
  try {
    const discovered = await discoverBackendBaseUrl();
    if (discovered.baseUrl) {
      return discovered;
    }
  } catch (error) {
    return {
      baseUrl: composeHostBackendBaseUrl(),
      source: "fallback_after_redis_error",
      discoveryError: error instanceof Error ? error.message : String(error),
    };
  }
  if (process.env.KN_MANAGER_URL) {
    return { baseUrl: normalizeBaseUrl(process.env.KN_MANAGER_URL), source: "KN_MANAGER_URL" };
  }
  return { baseUrl: composeHostBackendBaseUrl(), source: "HOST" };
}

async function endpoint(pathname) {
  const backend = await resolveBackendBaseUrl();
  return `${backend.baseUrl}/${pathname.replace(/^\/+/, "")}`;
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
    normalized.sessionId = firstNonEmpty(normalized.sessionId, item.sessionId, item.session_id, item.session);
    normalized.beyondToken = firstNonEmpty(normalized.beyondToken, item.beyondToken, item.beyond_token, item["Beyond-Token"], item["beyond-token"]);
    normalized.userCode = firstNonEmpty(normalized.userCode, item.userCode, item.user_code, item.uc);
    normalized.user_id = firstNonEmpty(normalized.user_id, item.user_id, item.userId, item.id);
    if (item.headers && typeof item.headers === "object") {
      normalized.headers = { ...(normalized.headers || {}), ...item.headers };
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
  const stateDir = expandHome(firstNonEmpty(process.env.OPENCLAW_STATE_DIR, process.env.OPENCLAW_HOME, path.join(os.homedir(), ".openclaw")));
  const explicitAuthFile = expandHome(process.env.BAIYING_AUTH_FILE);
  return [...new Set([
    path.join(os.homedir(), ".openclaw", "workspace", "baiying-session.json"),
    path.join(stateDir, "workspace", "baiying-session.json"),
    path.join(stateDir, "identity", "by_user_info.json"),
    "/by/.openclaw/workspace/baiying-session.json",
    "/by/.openclaw/identity/by_user_info.json",
    explicitAuthFile,
  ].map(expandHome).filter(Boolean))];
}

function loadAuthContext() {
  let auth = {};
  for (const filePath of candidateAuthFiles()) {
    const loaded = readJsonFileIfExists(filePath);
    if (loaded) {
      auth = mergeAuthContext(auth, loaded);
    }
  }
  return auth;
}

function resolveAuthValues(auth) {
  const headers = auth.headers && typeof auth.headers === "object" ? auth.headers : {};
  const sessionId = firstNonEmpty(
    process.env.BAIYING_SESSION,
    process.env.SESSION_ID,
    auth.session,
    auth.sessionId,
    auth.session_id,
    pickHeader(headers, "x-signature-sessionId"),
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
      auth["beyond-token"],
      pickHeader(headers, "beyond-token"),
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
  headers.Cookie = existing ? `${existing}; ${cookie}` : cookie;
  delete headers.cookie;
}

function deleteHeader(headers, name) {
  const expected = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === expected) {
      delete headers[key];
    }
  }
}

function authHeaders(bodyText, contentType = "application/json") {
  const auth = loadAuthContext();
  const values = resolveAuthValues(auth);
  const headers = {
    Accept: "application/json",
    ...(auth.headers || {}),
  };
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  if (process.env.BAIYING_AGENT_AUTH) {
    headers.Authorization = process.env.BAIYING_AGENT_AUTH;
  }
  if (values.beyondToken) {
    deleteHeader(headers, "beyond-token");
    headers["beyond-token"] = values.beyondToken;
  }
  if (values.userCode) {
    headers["X-User-Id"] = values.userCode;
  }
  if (values.sessionId) {
    headers["x-signature-sessionId"] = values.sessionId;
    headers["X-Session-Id"] = values.sessionId;
  }
  const cookies = [];
  if (values.sessionId) {
    cookies.push(`SESSION=${values.sessionId}`);
    cookies.push(`PORTAL-SESSION=${values.sessionId}`);
  }
  if (auth.user_id) {
    cookies.push(`currentUserId=${auth.user_id}`);
  }
  if (cookies.length) {
    appendCookie(headers, cookies.join("; "));
  }
  return { ...headers, ...buildSignatureHeaders(values.userCode, bodyText) };
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
  const response = await fetch(url, {
    method: normalizedMethod,
    headers: authHeaders(bodyText),
    body: bodyText || undefined,
  });
  return parseJsonResponse(response, url);
}

async function requestMultipart(url, formData) {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders("", null),
    body: formData,
  });
  return parseJsonResponse(response, url);
}

async function parseJsonResponse(response, url) {
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

function asArray(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function sanitizeFileName(value, fallback) {
  const raw = firstNonEmpty(value, fallback, "bycli-output");
  const safe = raw
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "bycli-output";
  return safe.toLowerCase().endsWith(".md") ? safe : `${safe}.md`;
}

function sanitizeResourceFileName(value, fallback, source) {
  const raw = firstNonEmpty(value, fallback, "bycli-resource");
  let safe = raw
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "bycli-resource";
  if (!path.extname(safe)) {
    safe = `${safe}${extensionOf(source) || ".bin"}`;
  }
  return safe;
}

function titleFromMarkdown(markdown) {
  const heading = String(markdown || "").split(/\r?\n/).find((line) => /^#\s+/.test(line));
  return heading ? heading.replace(/^#\s+/, "").trim() : "";
}

function slugFromUrl(url) {
  if (!url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return firstNonEmpty(path.basename(parsed.pathname), parsed.hostname);
  } catch {
    return "";
  }
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif"]);

function extensionOf(value) {
  const text = String(value || "").split("?")[0].split("#")[0];
  return path.extname(text).toLowerCase();
}

function guessContentType(fileName) {
  const ext = extensionOf(fileName);
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] || "application/octet-stream";
}

function fileNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const baseName = path.basename(parsed.pathname);
    return baseName && baseName !== "/" ? decodeURIComponent(baseName) : "";
  } catch {
    return "";
  }
}

function hasMarkdownPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Boolean(value.markdown || value.content || value.text || value.response || value.value || value.collectionResult || value.markdownFiles || value.items);
}

function isResourceCandidateValue(value) {
  if (!value || value === true) {
    return false;
  }
  const text = String(value);
  if (looksLikeHttpUrl(text)) {
    return Boolean(extensionOf(text));
  }
  return fs.existsSync(expandHome(text));
}

function normalizeResourceCandidate(raw, args, index) {
  if (!raw || raw === true) {
    return undefined;
  }
  const source = typeof raw === "string"
    ? raw
    : firstNonEmpty(raw.fileUrl, raw.imageUrl, raw.iconUrl, raw.downloadUrl, raw.url, raw.path, raw.source);
  if (!isResourceCandidateValue(source)) {
    return undefined;
  }
  const fileName = sanitizeResourceFileName(
    typeof raw === "object" ? raw.fileName || raw.name : "",
    fileNameFromUrl(source) || path.basename(String(source)) || `bycli-resource-${index + 1}`,
    source,
  );
  const contentType = firstNonEmpty(typeof raw === "object" ? raw.contentType || raw.mimeType : "", guessContentType(fileName));
  return {
    source,
    fileName,
    contentType,
    kind: contentType.startsWith("image/") || IMAGE_EXTENSIONS.has(extensionOf(fileName)) ? "image" : "file",
  };
}

function collectResourceCandidatesFromValue(value, args) {
  if (value === undefined || value === null || hasMarkdownPayload(value)) {
    return [];
  }
  if (typeof value === "string") {
    return [normalizeResourceCandidate(value, args, 0)].filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectResourceCandidatesFromValue(item, args)
      .map((candidate) => ({ ...candidate, index })));
  }
  if (typeof value !== "object") {
    return [];
  }
  const containers = [
    ...asArray(value.files),
    ...asArray(value.images),
    ...asArray(value.attachments),
    ...asArray(value.resources),
  ];
  const nested = containers.flatMap((item) => collectResourceCandidatesFromValue(item, args));
  const direct = normalizeResourceCandidate(value, args, nested.length);
  return direct ? [direct, ...nested] : nested;
}

function buildResourceCandidates(args, stdinValue) {
  const directValues = [
    ...asArray(firstPresent(args, ["resource-url", "file-url", "image-url", "icon-url", "download-url"])),
    ...asArray(firstPresent(args, ["resource-path", "file-path", "image-path"])),
  ];
  const directCandidates = directValues.map((value, index) => normalizeResourceCandidate(value, args, index)).filter(Boolean);
  return [...directCandidates, ...collectResourceCandidatesFromValue(stdinValue, args)];
}

async function resolveResourceBytes(candidate) {
  if (looksLikeHttpUrl(candidate.source)) {
    const response = await fetch(candidate.source);
    if (!response.ok) {
      throw new Error(`下载资源失败 HTTP ${response.status}: ${candidate.source}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = firstNonEmpty(response.headers.get("content-type"), candidate.contentType, guessContentType(candidate.fileName));
    return { bytes, contentType };
  }
  const filePath = expandHome(candidate.source);
  return { bytes: fs.readFileSync(filePath), contentType: firstNonEmpty(candidate.contentType, guessContentType(filePath)) };
}

async function buildUploadFormData(candidates, args) {
  const formData = new FormData();
  for (const candidate of candidates) {
    const resolved = await resolveResourceBytes(candidate);
    const blob = new Blob([resolved.bytes], { type: resolved.contentType });
    formData.append("files", blob, candidate.fileName);
  }
  formData.append("sessionType", "AGENT");
  const sessionId = firstNonEmpty(pick(args, "session-id"), pick(args, "sessionId"));
  const agentId = firstNonEmpty(pick(args, "agent-id"), pick(args, "agentId"));
  if (sessionId) {
    formData.append("sessionId", sessionId);
  }
  if (agentId) {
    formData.append("agentId", agentId);
  }
  return formData;
}

async function uploadResources(candidates, args) {
  const uploadUrl = await endpoint("/chat/uploadFiles");
  if (args["dry-run"]) {
    return {
      dryRun: true,
      endpoint: uploadUrl,
      sessionType: "AGENT",
      resources: candidates,
    };
  }
  const formData = await buildUploadFormData(candidates, args);
  return requestMultipart(uploadUrl, formData);
}

function normalizeItem(rawItem, args, index) {
  const markdown = firstNonEmpty(
    rawItem?.markdown,
    rawItem?.content,
    rawItem?.text,
    rawItem?.response,
    rawItem?.value,
    typeof rawItem === "string" ? rawItem : "",
  );
  if (!markdown) {
    return undefined;
  }
  const sourceUrl = firstNonEmpty(rawItem?.sourceUrl, rawItem?.url, pick(args, "source-url"));
  const title = firstNonEmpty(rawItem?.title, rawItem?.name, titleFromMarkdown(markdown), sourceUrl);
  const fallbackName = firstNonEmpty(rawItem?.fileName, title, slugFromUrl(sourceUrl), `bycli-output-${index + 1}`);
  return {
    title,
    fileName: sanitizeFileName(rawItem?.fileName, fallbackName),
    sourceUrl,
    markdown,
  };
}

function normalizebyCliValue(value, args) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    return {
      rawOutput: value,
      items: [normalizeItem(value, args, 0)].filter(Boolean),
    };
  }
  if (Array.isArray(value)) {
    return {
      rawOutput: JSON.stringify(value),
      items: value.map((item, index) => normalizeItem(item, args, index)).filter(Boolean),
    };
  }
  if (value.collectionResult) {
    return normalizeCollectionResult(value.collectionResult, args, JSON.stringify(value));
  }
  if (value.data && typeof value.data === "object" && !Array.isArray(value.data)) {
    return normalizebyCliValue(value.data, args);
  }
  if (Array.isArray(value.markdownFiles)) {
    return {
      rawOutput: JSON.stringify(value),
      items: value.markdownFiles.map((item, index) => normalizeItem(item, args, index)).filter(Boolean),
    };
  }
  if (Array.isArray(value.items)) {
    return {
      rawOutput: firstNonEmpty(value.rawOutput, JSON.stringify(value)),
      command: Array.isArray(value.command) ? value.command : undefined,
      outputDir: value.outputDir,
      assetCount: value.assetCount,
      items: value.items.map((item, index) => normalizeItem(item, args, index)).filter(Boolean),
    };
  }
  return {
    rawOutput: JSON.stringify(value),
    items: [normalizeItem(value, args, 0)].filter(Boolean),
  };
}

function normalizeCollectionResult(collectionResult, args, rawOutput) {
  const normalized = normalizebyCliValue(collectionResult, args);
  return compactObject({
    command: parseJson(args["command-json"], "command-json") || normalized?.command,
    outputDir: pick(args, "output-dir", normalized?.outputDir),
    rawOutput: firstNonEmpty(pick(args, "raw-output"), readRawOutputFile(args), normalized?.rawOutput, rawOutput),
    assetCount: toNumber(pick(args, "asset-count", normalized?.assetCount)) || 0,
    items: normalized?.items || [],
  });
}

function readRawOutputFile(args) {
  const filePath = pick(args, "raw-output-file");
  return filePath ? readTextFile(filePath) : "";
}

function markdownItemsFromFiles(args) {
  const files = [...asArray(args["markdown-file"])];
  for (const dir of asArray(args["markdown-dir"])) {
    const resolvedDir = expandHome(dir);
    for (const entry of fs.readdirSync(resolvedDir).sort()) {
      if (entry.toLowerCase().endsWith(".md")) {
        files.push(path.join(resolvedDir, entry));
      }
    }
  }
  return files.map((filePath, index) => {
    const markdown = readTextFile(filePath);
    const fileName = sanitizeFileName(path.basename(filePath), `bycli-output-${index + 1}`);
    return normalizeItem({ markdown, fileName, title: titleFromMarkdown(markdown), sourceUrl: pick(args, "source-url") }, args, index);
  }).filter(Boolean);
}

function loadInputValue(args, stdinValue) {
  if (args["collection-result-json"]) {
    return { type: "collectionResult", value: parseJson(args["collection-result-json"], "collection-result-json") };
  }
  if (args["collection-result-file"]) {
    return { type: "collectionResult", value: readJsonFile(args["collection-result-file"]) };
  }
  if (args["bycli-json"]) {
    return { type: "bycli", value: parseJson(args["bycli-json"], "bycli-json") };
  }
  if (args["bycli-json-file"]) {
    return { type: "bycli", value: readJsonFile(args["bycli-json-file"]) };
  }
  if (stdinValue !== undefined) {
    return { type: "stdin", value: stdinValue };
  }
  return { type: "none", value: undefined };
}

function buildCollectionResult(args, stdinValue) {
  const input = loadInputValue(args, stdinValue);
  const fileItems = markdownItemsFromFiles(args);
  let collectionResult;
  if (input.type === "collectionResult") {
    collectionResult = normalizeCollectionResult(input.value, args, JSON.stringify(input.value));
  } else if (input.type !== "none") {
    collectionResult = normalizeCollectionResult(normalizebyCliValue(input.value, args), args, typeof input.value === "string" ? input.value : JSON.stringify(input.value));
  } else {
    collectionResult = normalizeCollectionResult({ items: [] }, args, "");
  }
  collectionResult.items = [...(collectionResult.items || []), ...fileItems];
  if (!collectionResult.items.length) {
    throw new Error("未找到可入库的 Markdown。请传 --bycli-json-file、--collection-result-file、--markdown-file、--markdown-dir 或 stdin");
  }
  collectionResult.items = collectionResult.items.map((item, index) => ({
    ...item,
    fileName: sanitizeFileName(item.fileName, `bycli-output-${index + 1}`),
  }));
  return collectionResult;
}

function buildTask(args, stdinJson) {
  const taskJson = parseJson(args["task-json"], "task-json") || stdinJson?.task || {};
  const knowledgeBaseResourceId = toNumber(pick(args, "knowledge-base-resource-id", taskJson.knowledgeBaseResourceId));
  return compactObject({
    ...taskJson,
    taskId: toNumber(pick(args, "task-id", taskJson.taskId)),
    taskName: pick(args, "task-name", taskJson.taskName),
    connectorCode: pick(args, "connector-code", taskJson.connectorCode || "web"),
    sourceName: pick(args, "source-name", taskJson.sourceName || "网页"),
    sourceUrl: pick(args, "source-url", taskJson.sourceUrl),
    importTarget: "knowledgeBase",
    knowledgeBaseResourceId,
    knowledgeBaseId: pick(args, "knowledge-base-id", taskJson.knowledgeBaseId),
    knowledgeBaseName: pick(args, "knowledge-base-name", taskJson.knowledgeBaseName),
  });
}

function buildTargetConfig(args, stdinJson, task) {
  const targetConfigJson = parseJson(args["target-config-json"], "target-config-json") || stdinJson?.targetConfig || {};
  return compactObject({
    ...targetConfigJson,
    knowledgeBaseResourceId: toNumber(pick(args, "knowledge-base-resource-id", targetConfigJson.knowledgeBaseResourceId || task.knowledgeBaseResourceId)),
    knowledgeBaseId: pick(args, "knowledge-base-id", targetConfigJson.knowledgeBaseId || task.knowledgeBaseId),
    knowledgeBaseName: pick(args, "knowledge-base-name", targetConfigJson.knowledgeBaseName || task.knowledgeBaseName),
  });
}

function toMarkdownFiles(collectionResult) {
  return collectionResult.items.map((item) => ({
    fileName: item.fileName,
    markdown: item.markdown,
    size: Buffer.byteLength(item.markdown || "", "utf8"),
  }));
}

function assertImportReady(targetConfig) {
  if (!targetConfig.knowledgeBaseResourceId && !targetConfig.knowledgeBaseId) {
    throw new Error("导入知识库必须提供 --knowledge-base-resource-id 或 --knowledge-base-id");
  }
}

function hasImportTarget(targetConfig) {
  return Boolean(targetConfig?.knowledgeBaseResourceId || targetConfig?.knowledgeBaseId);
}

function buildListKnowledgeBasePayload(args, stdinJson = {}) {
  return compactObject({
    pageNum: toNumber(pick(args, "page-num", pick(args, "kb-page-num", stdinJson.pageNum))) || 1,
    pageSize: toNumber(pick(args, "page-size", pick(args, "kb-page-size", stdinJson.pageSize))) || 20,
    sessionId: toNumber(pick(args, "session-id", stdinJson.sessionId)),
    createBy: toNumber(pick(args, "create-by", stdinJson.createBy)),
    keyword: pick(args, "keyword", pick(args, "kb-keyword", stdinJson.keyword)),
  });
}

function normalizeKnowledgeBases(raw) {
  const candidates = [
    ...asArray(raw?.selectedKbs),
    ...asArray(raw?.pageInfo?.list),
    ...asArray(raw?.list),
  ];
  const seen = new Set();
  return candidates
    .map((item) => {
      const resourceId = toNumber(firstNonEmpty(item?.dirId, item?.dataId, item?.resourceId, item?.knowledgeBaseResourceId));
      if (!resourceId || seen.has(resourceId)) {
        return undefined;
      }
      seen.add(resourceId);
      return compactObject({
        resourceId,
        knowledgeBaseResourceId: resourceId,
        name: item?.name || item?.resourceName,
        datasetId: item?.datasetId,
        dataType: item?.dataType,
        parentDirId: item?.parentDirId,
      });
    })
    .filter(Boolean);
}

async function listKnowledgeBases(args, stdinJson = {}) {
  const endpointUrl = await endpoint("/spaceDir/listPersonalKb");
  const payload = buildListKnowledgeBasePayload(args, stdinJson);
  if (args["dry-run"]) {
    return { dryRun: true, endpoint: endpointUrl, payload, knowledgeBases: [] };
  }
  const raw = await requestJson("POST", endpointUrl, payload);
  return { endpoint: endpointUrl, payload, raw, knowledgeBases: normalizeKnowledgeBases(raw) };
}

function buildPayloads(args, stdinValue) {
  const stdinJson = stdinValue && typeof stdinValue === "object" && !Array.isArray(stdinValue) ? stdinValue : {};
  const collectionResult = buildCollectionResult(args, stdinValue);
  const task = buildTask(args, stdinJson);
  const targetConfig = buildTargetConfig(args, stdinJson, task);
  const runId = toNumber(pick(args, "run-id", stdinJson.runId));
  const markdownFiles = toMarkdownFiles(collectionResult);
  return {
    runId,
    task,
    targetConfig,
    collectionResult,
    markdownFiles,
    storePayload: compactObject({ runId, task, collectionResult }),
    importPayload: compactObject({ task, targetConfig, markdownFiles }),
  };
}

function render(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function summarizePayloads(payloads) {
  return {
    runId: payloads.runId,
    task: payloads.task,
    targetConfig: payloads.targetConfig,
    markdownCount: payloads.collectionResult.items.length,
    files: payloads.collectionResult.items.map((item) => ({
      fileName: item.fileName,
      title: item.title,
      sourceUrl: item.sourceUrl,
      size: Buffer.byteLength(item.markdown || "", "utf8"),
    })),
  };
}

async function printHelp() {
  render({
    name: "bycli-markdown-ingest",
    commands: {
      "list-kb": "调用 /spaceDir/listPersonalKb 查询可入库个人知识库",
      normalize: "规范化 byCLI Markdown 输出，不请求后端",
      "upload-resource": "上传 byCLI 返回的图片或文件地址到 /chat/uploadFiles",
      store: "调用 /ecosystemCollection/ingestion/artifacts/store",
      import: "调用 /ecosystemCollection/ingestion/knowledge/import",
      ingest: "先 store 再 import，推荐使用",
    },
    inputs: [
      "--bycli-json-file <file>",
      "--collection-result-file <file>",
      "--markdown-file <file> (可重复)",
      "--markdown-dir <dir>",
      "--file-url/--image-url/--resource-url <url>",
      "--file-path/--image-path/--resource-path <path>",
      "stdin JSON 或 Markdown 文本",
    ],
    requiredForImport: ["--knowledge-base-resource-id 或 --knowledge-base-id"],
    examples: [
      "node bycli-markdown-ingest.mjs normalize --bycli-json-file /tmp/bycli-output.json --knowledge-base-resource-id 90001",
      "node bycli-markdown-ingest.mjs ingest --markdown-file article.md --source-url https://example.com --knowledge-base-resource-id 90001",
    ],
    backend: await resolveBackendBaseUrl(),
    auth: authSummary(),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";
  const stdinText = readStdinText();
  const stdinValue = parseMaybeJsonText(stdinText);

  if (command === "help" || args.help) {
    await printHelp();
    return;
  }

  const stdinJson = stdinValue && typeof stdinValue === "object" && !Array.isArray(stdinValue) ? stdinValue : {};

  if (command === "list-kb") {
    const listed = await listKnowledgeBases(args, stdinJson);
    render({ ok: true, action: "list-kb", ...listed });
    return;
  }

  const resourceCandidates = buildResourceCandidates(args, stdinValue);
  if (command === "upload-resource" || (command === "ingest" && resourceCandidates.length)) {
    if (!resourceCandidates.length) {
      throw new Error("未找到可上传的图片或文件地址。请传 --file-url、--image-url、--resource-url、--file-path，或在 stdin 中提供 fileUrl/imageUrl/downloadUrl/path");
    }
    const uploaded = await uploadResources(resourceCandidates, args);
    render({
      ok: true,
      action: "upload-resource",
      sessionType: "AGENT",
      resources: resourceCandidates,
      uploaded,
    });
    return;
  }

  const payloads = buildPayloads(args, stdinValue);

  if (command === "normalize") {
    render({ ok: true, action: "normalize", summary: summarizePayloads(payloads), payloads });
    return;
  }

  if (command === "store") {
    const storeUrl = await endpoint("/ecosystemCollection/ingestion/artifacts/store");
    if (args["dry-run"]) {
      render({ ok: true, action: "store", dryRun: true, endpoint: storeUrl, summary: summarizePayloads(payloads), payload: payloads.storePayload });
      return;
    }
    const stored = await requestJson("POST", storeUrl, payloads.storePayload);
    render({ ok: true, action: "store", summary: summarizePayloads(payloads), stored });
    return;
  }

  if (command === "import") {
    if (!hasImportTarget(payloads.targetConfig)) {
      const listed = await listKnowledgeBases(args, stdinJson);
      render({ ok: true, action: "select-knowledge-base", needsKnowledgeBaseSelection: true, summary: summarizePayloads(payloads), ...listed });
      return;
    }
    const importUrl = await endpoint("/ecosystemCollection/ingestion/knowledge/import");
    if (args["dry-run"]) {
      render({ ok: true, action: "import", dryRun: true, endpoint: importUrl, summary: summarizePayloads(payloads), payload: payloads.importPayload });
      return;
    }
    const imported = await requestJson("POST", importUrl, payloads.importPayload);
    render({ ok: true, action: "import", summary: summarizePayloads(payloads), imported });
    return;
  }

  if (command === "ingest") {
    if (!hasImportTarget(payloads.targetConfig)) {
      const listed = await listKnowledgeBases(args, stdinJson);
      render({ ok: true, action: "select-knowledge-base", needsKnowledgeBaseSelection: true, summary: summarizePayloads(payloads), ...listed });
      return;
    }
    const storeUrl = await endpoint("/ecosystemCollection/ingestion/artifacts/store");
    const importUrl = await endpoint("/ecosystemCollection/ingestion/knowledge/import");
    if (args["dry-run"]) {
      render({
        ok: true,
        action: "ingest",
        dryRun: true,
        endpoints: { store: storeUrl, import: importUrl },
        summary: summarizePayloads(payloads),
        storePayload: payloads.storePayload,
        importPayload: payloads.importPayload,
      });
      return;
    }
    const stored = await requestJson("POST", storeUrl, payloads.storePayload);
    const markdownFiles = Array.isArray(stored?.markdownFiles) && stored.markdownFiles.length
      ? stored.markdownFiles
      : payloads.markdownFiles;
    const importPayload = compactObject({
      task: payloads.task,
      targetConfig: payloads.targetConfig,
      markdownFiles,
    });
    const imported = await requestJson("POST", importUrl, importPayload);
    render({ ok: true, action: "ingest", summary: summarizePayloads(payloads), stored, imported });
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
