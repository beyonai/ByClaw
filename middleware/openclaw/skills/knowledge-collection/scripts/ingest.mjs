#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { spawn } from "node:child_process";
import { lookup as dnsLookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_CONTEXT_PATH = "/byaiService";
const DEFAULT_SIGNATURE_SALT = "{#@*A12^c0+}";
const DEFAULT_BACKEND_SERVICE_NAME = "ByaiService";
const SERVICE_DISCOVERY_INSTANCE_PREFIX = "byai_gateway:sd:instances:";
const DEFAULT_RESOURCE_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESOURCE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_BATCH_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_RESOURCES = 20;
const DEFAULT_BACKEND_TIMEOUT_MS = 30_000;
const MAX_RESOURCE_REDIRECTS = 5;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_LOCAL_PATH = Symbol("canonicalLocalPath");

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

function toPositiveSafeInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value.trim())) {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function positiveSafeIntegerIfPresent(value, label) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = toPositiveSafeInteger(value);
  if (parsed === undefined) {
    throw new Error(`${label} 必须是正安全整数`);
  }
  return parsed;
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

function positiveIntegerEnv(name, fallback) {
  return toPositiveSafeInteger(firstNonEmpty(process.env[name])) ?? fallback;
}

function resourceLimits() {
  return {
    timeoutMs: positiveIntegerEnv("KNOWLEDGE_COLLECTION_RESOURCE_TIMEOUT_MS", DEFAULT_RESOURCE_TIMEOUT_MS),
    maxResourceBytes: positiveIntegerEnv("KNOWLEDGE_COLLECTION_MAX_RESOURCE_BYTES", DEFAULT_MAX_RESOURCE_BYTES),
    maxBatchBytes: positiveIntegerEnv("KNOWLEDGE_COLLECTION_MAX_BATCH_BYTES", DEFAULT_MAX_BATCH_BYTES),
    maxResources: positiveIntegerEnv("KNOWLEDGE_COLLECTION_MAX_RESOURCES", DEFAULT_MAX_RESOURCES),
  };
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
  return requestWithDeadline(url, {
    method: normalizedMethod,
    headers: authHeaders(bodyText),
    body: bodyText || undefined,
  }, normalizedMethod);
}

async function requestMultipart(url, formData) {
  return requestWithDeadline(url, {
    method: "POST",
    headers: authHeaders("", null),
    body: formData,
  }, "POST multipart");
}

async function requestWithDeadline(url, options, operation) {
  const timeoutMs = positiveIntegerEnv("KNOWLEDGE_COLLECTION_BACKEND_TIMEOUT_MS", DEFAULT_BACKEND_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return await parseJsonResponse(response, url);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`后端 ${operation} 请求超时（${timeoutMs}ms）: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  const raw = firstNonEmpty(value, fallback, "knowledge-collection-output");
  const safe = raw
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "knowledge-collection-output";
  return safe.toLowerCase().endsWith(".md") ? safe : `${safe}.md`;
}

function sanitizeResourceFileName(value, fallback, source) {
  const raw = firstNonEmpty(value, fallback, "knowledge-collection-resource");
  let safe = raw
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "knowledge-collection-resource";
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
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv", ".flv", ".mpeg", ".mpg", ".3gp", ".ts"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wma", ".amr", ".aiff", ".mid"]);

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
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".wmv": "video/x-ms-wmv",
    ".flv": "video/x-flv",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".3gp": "video/3gpp",
    ".ts": "video/mp2t",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".wma": "audio/x-ms-wma",
    ".amr": "audio/amr",
    ".aiff": "audio/aiff",
    ".mid": "audio/midi",
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
    fileNameFromUrl(source) || path.basename(String(source)) || `knowledge-collection-resource-${index + 1}`,
    source,
  );
  const contentType = firstNonEmpty(typeof raw === "object" ? raw.contentType || raw.mimeType : "", guessContentType(fileName));
  const ext = extensionOf(fileName);
  const isImage = contentType.startsWith("image/") || IMAGE_EXTENSIONS.has(ext);
  const isVideo = contentType.startsWith("video/") || VIDEO_EXTENSIONS.has(ext);
  const isAudio = contentType.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext);
  return {
    source,
    fileName,
    contentType,
    kind: isImage ? "image" : isVideo ? "video" : isAudio ? "audio" : "file",
    ...compactObject({ itemId: firstNonEmpty(asArray(args["item-id"])[index]) }),
  };
}

function collectResourceCandidatesFromValue(value, args) {
  if (value === undefined || value === null) {
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
  const directInput = hasMarkdownPayload(value)
    ? {
      fileUrl: value.fileUrl,
      imageUrl: value.imageUrl,
      iconUrl: value.iconUrl,
      downloadUrl: value.downloadUrl,
      path: value.path,
      fileName: value.fileName,
      name: value.name,
      contentType: value.contentType,
      mimeType: value.mimeType,
    }
    : value;
  const direct = normalizeResourceCandidate(directInput, args, nested.length);
  return direct ? [direct, ...nested] : nested;
}

function assertLocalPathArgsExist(args) {
  // 显式命令行路径参数（--file-path/--image-path/--resource-path）必须真实存在；
  // 不存在时抛明确错误，避免被 isResourceCandidateValue 静默丢弃后报“未找到候选”自相矛盾。
  // HTTP(S) URL 不做 existsSync 预检。
  for (const value of asArray(firstPresent(args, ["resource-path", "file-path", "image-path"]))) {
    if (!value || value === true || looksLikeHttpUrl(value)) {
      continue;
    }
    if (!fs.existsSync(expandHome(String(value)))) {
      throw new Error(`文件不存在: ${value}`);
    }
  }
}

function buildResourceCandidates(args, stdinValue) {
  assertLocalPathArgsExist(args);
  const directValues = [
    ...asArray(firstPresent(args, ["resource-url", "file-url", "image-url", "icon-url", "download-url"])),
    ...asArray(firstPresent(args, ["resource-path", "file-path", "image-path"])),
  ];
  const directCandidates = directValues.map((value, index) => normalizeResourceCandidate(value, args, index)).filter(Boolean);
  return [...directCandidates, ...collectResourceCandidatesFromValue(stdinValue, args)];
}

function ipv4Octets(address) {
  const parts = String(address).split(".").map((part) => Number.parseInt(part, 10));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : undefined;
}

function mappedIpv4Address(address) {
  const normalized = String(address).toLowerCase();
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    return dotted[1];
  }
  const hexadecimal = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexadecimal) {
    return "";
  }
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isUnsafeIpv4(address) {
  const octets = ipv4Octets(address);
  if (!octets) {
    return true;
  }
  const [first, second, third] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function isUnsafeIpAddress(address) {
  const normalized = String(address).toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const mapped = mappedIpv4Address(normalized);
  if (mapped) {
    return isUnsafeIpv4(mapped);
  }
  const family = net.isIP(normalized);
  if (family === 4) {
    return isUnsafeIpv4(normalized);
  }
  if (family !== 6) {
    return true;
  }
  return normalized === "::"
    || normalized === "::1"
    || /^f[cd]/.test(normalized)
    || /^fe[89ab]/.test(normalized)
    || /^ff/.test(normalized)
    || /^2001:db8(?::|$)/.test(normalized);
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function validatedRemoteTarget(rawUrl, args, timeoutMs) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`资源 URL 无效: ${rawUrl}`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error(`资源 URL 只允许 http 或 https: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("资源 URL 不得包含用户名或密码");
  }
  const allowPrivateResource = args["allow-private-resource"] === true;
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
    if (!allowPrivateResource) {
      throw new Error(`资源 URL 指向私有或保留地址: ${hostname}`);
    }
  }
  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname, family: net.isIP(hostname) }];
  } else {
    try {
      addresses = await withTimeout(
        dnsLookup(hostname, { all: true, verbatim: true }),
        timeoutMs,
        `资源下载超时（${timeoutMs}ms）: ${url.href}`,
      );
    } catch (error) {
      throw new Error(`资源主机解析失败: ${hostname}: ${error.message}`);
    }
  }
  if (!addresses.length) {
    throw new Error(`资源主机没有可用地址: ${hostname}`);
  }
  if (!allowPrivateResource && addresses.some((item) => isUnsafeIpAddress(item.address))) {
    throw new Error(`资源 URL 指向私有或保留地址: ${hostname}`);
  }
  return { url, addresses };
}

function downloadRemoteHop(target, candidate, limits, timeoutMs) {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === "https:" ? https : http;
    const addresses = target.addresses.map((item) => ({ address: item.address, family: item.family }));
    const request = transport.request(target.url, {
      method: "GET",
      headers: { Accept: "*/*" },
      lookup(_hostname, options, callback) {
        if (options?.all) {
          callback(null, addresses);
          return;
        }
        callback(null, addresses[0].address, addresses[0].family);
      },
    });
    let settled = false;
    const timer = setTimeout(() => {
      request.destroy(new Error(`资源下载超时（${limits.timeoutMs}ms）: ${target.url.href}`));
    }, timeoutMs);

    function finish(error, value) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    request.once("error", (error) => finish(error));
    request.once("response", async (response) => {
      try {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.destroy();
          finish(undefined, { redirect: new URL(response.headers.location, target.url).href });
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          throw new Error(`下载资源失败 HTTP ${status}: ${target.url.href}`);
        }
        const contentLength = Number.parseInt(firstNonEmpty(response.headers["content-length"]), 10);
        if (Number.isFinite(contentLength) && contentLength > limits.maxResourceBytes) {
          response.destroy();
          throw new Error(`资源超过单文件大小上限 ${limits.maxResourceBytes} 字节: ${candidate.fileName}`);
        }
        const chunks = [];
        let total = 0;
        for await (const chunk of response) {
          total += chunk.length;
          if (total > limits.maxResourceBytes) {
            response.destroy();
            throw new Error(`资源超过单文件大小上限 ${limits.maxResourceBytes} 字节: ${candidate.fileName}`);
          }
          chunks.push(chunk);
        }
        finish(undefined, {
          bytes: Buffer.concat(chunks, total),
          contentType: firstNonEmpty(response.headers["content-type"], candidate.contentType, guessContentType(candidate.fileName)),
        });
      } catch (error) {
        finish(error);
      }
    });
    request.end();
  });
}

async function downloadRemoteResource(candidate, args, limits) {
  let currentUrl = candidate.source;
  const deadline = Date.now() + limits.timeoutMs;
  for (let redirects = 0; redirects <= MAX_RESOURCE_REDIRECTS; redirects += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`资源下载超时（${limits.timeoutMs}ms）: ${candidate.source}`);
    }
    const target = await validatedRemoteTarget(currentUrl, args, remainingMs);
    const afterLookupMs = deadline - Date.now();
    if (afterLookupMs <= 0) {
      throw new Error(`资源下载超时（${limits.timeoutMs}ms）: ${candidate.source}`);
    }
    const result = await downloadRemoteHop(target, candidate, limits, afterLookupMs);
    if (!result.redirect) {
      return result;
    }
    if (redirects === MAX_RESOURCE_REDIRECTS) {
      throw new Error(`资源重定向次数超过上限 ${MAX_RESOURCE_REDIRECTS}: ${candidate.source}`);
    }
    currentUrl = result.redirect;
  }
  throw new Error(`资源重定向次数超过上限 ${MAX_RESOURCE_REDIRECTS}: ${candidate.source}`);
}

async function resolveResourceBytes(candidate, args, limits) {
  if (looksLikeHttpUrl(candidate.source)) {
    return downloadRemoteResource(candidate, args, limits);
  }
  const filePath = expandHome(candidate.source);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`资源路径必须指向普通文件: ${candidate.source}`);
  }
  if (stat.size > limits.maxResourceBytes) {
    throw new Error(`资源超过单文件大小上限 ${limits.maxResourceBytes} 字节: ${candidate.fileName}`);
  }
  return { bytes: fs.readFileSync(filePath), contentType: firstNonEmpty(candidate.contentType, guessContentType(filePath)) };
}

async function resolveResourceBatch(candidates, args) {
  const limits = resourceLimits();
  if (candidates.length > limits.maxResources) {
    throw new Error(`超过资源数量上限 ${limits.maxResources}`);
  }
  const resolved = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    const resource = await resolveResourceBytes(candidate, args, limits);
    totalBytes += resource.bytes.length;
    if (totalBytes > limits.maxBatchBytes) {
      throw new Error(`资源超过批次大小上限 ${limits.maxBatchBytes} 字节`);
    }
    resolved.push({ candidate, ...resource });
  }
  return resolved;
}

async function buildUploadFormData(candidates, args) {
  const formData = new FormData();
  for (const resolved of await resolveResourceBatch(candidates, args)) {
    const blob = new Blob([resolved.bytes], { type: resolved.contentType });
    formData.append("files", blob, resolved.candidate.fileName);
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

// 采集会话目录末段的运行时间戳，形如 /by/.sessions/<sessionId>/<runName>/20260728_211755/。
const RUN_TIMESTAMP_PATTERN = /^\d{8}_\d{6}$/;

// 从会话目录路径里取运行时间戳。刻意不用 Date.now() 兜底：
// assertConfirmedImportTarget 要求调用方回传的 --confirmed-directory-path 与解析结果
// 完全相等，调用时现取的时间戳两次不会一致，确认环节必然对不上。
// 复用会话目录的时间戳则是确定值，同一批采集产物落到同一个知识库目录，可反复推导。
function resolveRunTimestamp(args) {
  const candidates = [...asArray(args["session-dir"]), pick(args, "output-dir")];
  for (const candidate of candidates) {
    const dir = firstNonEmpty(candidate);
    if (!dir) {
      continue;
    }
    // 时间戳通常是末段，但回退目录可能再往下嵌一层，故整条路径倒序找第一个匹配段。
    const segments = path.resolve(expandHome(dir)).split(path.sep).filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      if (RUN_TIMESTAMP_PATTERN.test(segments[i])) {
        return segments[i];
      }
    }
  }
  return "";
}

// 入库目标目录的默认值：能推导出运行时间戳就用 /<时间戳>/，否则保持历史行为的根目录。
// 显式 --directory-path 始终优先，此函数只提供兜底。
function defaultIngestDirectoryPath(args) {
  const timestamp = resolveRunTimestamp(args);
  return timestamp ? `/${timestamp}/` : "/";
}

function confirmedImportTarget(resourceId, directoryPath) {
  return {
    knowledgeBaseResourceId: resourceId,
    directoryPath,
    requiredArguments: {
      "confirmed-knowledge-base-resource-id": resourceId,
      "confirmed-directory-path": directoryPath,
    },
  };
}

function assertConfirmedImportTarget(args, resourceId, directoryPath) {
  if (args["dry-run"]) {
    return;
  }
  const confirmedResourceId = toPositiveSafeInteger(args["confirmed-knowledge-base-resource-id"]);
  const confirmedDirectoryPath = firstNonEmpty(args["confirmed-directory-path"]);
  if (!Number.isSafeInteger(confirmedResourceId) || confirmedResourceId <= 0 || confirmedResourceId !== resourceId) {
    throw new Error("必须提供与目标一致的 --confirmed-knowledge-base-resource-id");
  }
  if (confirmedDirectoryPath !== directoryPath) {
    throw new Error("必须提供与目标一致的 --confirmed-directory-path");
  }
}

// 文件直传知识库支持的类型（后端 byclaw-qa 解析能力：pdf/docx/pptx/xlsx/csv/txt/md）。
const DOC_INGEST_EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".xlsx", ".csv", ".txt", ".md", ".markdown"]);
// 白名单外但仍有正文、需先提取为 Markdown 的文件类型（doc/xls/ppt/html 等老格式）。
const EXTRACTABLE_DOC_EXTENSIONS = new Set([".doc", ".xls", ".ppt", ".htm", ".html", ".rtf", ".odt", ".ods", ".odp"]);

// 给 ingest 兜底用：检测输入里被丢弃的文档类候选，区分“可直传 7 种”与“需提取的有正文类型”，
// 把分流引导固化进错误信息（H1/M1）。
function classifyDiscardedDocCandidates(args, stdinValue) {
  const uploadable = new Set();
  const extractable = new Set();
  for (const candidate of buildResourceCandidates(args, stdinValue)) {
    const ext = extensionOf(candidate.fileName);
    if (DOC_INGEST_EXTENSIONS.has(ext)) {
      uploadable.add(candidate.fileName);
    } else if (EXTRACTABLE_DOC_EXTENSIONS.has(ext)) {
      extractable.add(candidate.fileName);
    }
  }
  return { uploadable: [...uploadable], extractable: [...extractable] };
}

// 只接受 http/https 的 origin；带凭据、路径、查询或片段一律拒绝，避免拼出错误或泄露凭据的 URL。
function normalizeDatasetBaseUrl(value) {
  if (value === undefined) {
    return "";
  }
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    throw new Error("--base-url 不能为空");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`--base-url 不是合法 URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("--base-url 只支持 http 或 https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("--base-url 不得包含凭据");
  }
  if (parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== "/")) {
    throw new Error("--base-url 只能是 origin，不得包含路径、查询或片段");
  }
  return parsed.origin;
}

function buildDocCandidates(args, stdinValue) {
  const docs = [];
  const rejected = [];
  for (const candidate of buildResourceCandidates(args, stdinValue)) {
    const ext = extensionOf(candidate.fileName);
    if (DOC_INGEST_EXTENSIONS.has(ext)) {
      docs.push(candidate);
    } else {
      rejected.push({ fileName: candidate.fileName, ext: ext || "(none)" });
    }
  }
  return { docs, rejected };
}

// 正文里图片的相对链接形态，与 post-processing 的改写模式保持一致。
const LOCAL_IMAGE_LINK_PATTERN = /!\[([^\]]*)\]\(\s*(images\/[^)\s]+?)\s*\)/g;
const IMAGE_INGEST_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const DATASET_DOWNLOAD_ENDPOINT = "/byaiService/datasetController/download";

// 扫描选中正文，收集实际存在的本地图片。图片缺失、越出正文目录或含 .. 穿越的一律跳过并记录，
// 避免把无法读取的路径送进上传批次。
function collectLocalImages(markdownFiles) {
  const images = new Map();
  const skipped = [];
  for (const markdownFile of markdownFiles) {
    const absoluteMarkdown = path.resolve(markdownFile);
    const markdownDir = path.dirname(absoluteMarkdown);
    let markdown;
    try {
      markdown = fs.readFileSync(absoluteMarkdown, "utf8");
    } catch (error) {
      skipped.push({ markdownFile, reason: `正文读取失败: ${error.message}` });
      continue;
    }
    for (const match of markdown.matchAll(LOCAL_IMAGE_LINK_PATTERN)) {
      const relativeLink = match[2];
      let decoded = relativeLink;
      try {
        decoded = decodeURIComponent(relativeLink);
      } catch {
        // 保留原样，后续按普通相对路径处理。
      }
      if (decoded.split("/").includes("..")) {
        skipped.push({ markdownFile, link: relativeLink, reason: "链接含 .. 路径穿越" });
        continue;
      }
      const absoluteImage = path.resolve(markdownDir, decoded);
      if (absoluteImage !== markdownDir && !absoluteImage.startsWith(`${markdownDir}${path.sep}`)) {
        skipped.push({ markdownFile, link: relativeLink, reason: "图片超出正文所在目录" });
        continue;
      }
      const ext = extensionOf(absoluteImage);
      if (!IMAGE_INGEST_EXTENSIONS.has(ext)) {
        skipped.push({ markdownFile, link: relativeLink, reason: `不是受支持的图片类型: ${ext || "(none)"}` });
        continue;
      }
      let stat;
      try {
        stat = fs.lstatSync(absoluteImage);
      } catch {
        skipped.push({ markdownFile, link: relativeLink, reason: "图片文件不存在" });
        continue;
      }
      if (!stat.isFile()) {
        skipped.push({ markdownFile, link: relativeLink, reason: "图片不是普通文件" });
        continue;
      }
      if (!images.has(absoluteImage)) {
        images.set(absoluteImage, { absolutePath: absoluteImage, links: [] });
      }
      images.get(absoluteImage).links.push({ markdownFile: absoluteMarkdown, link: relativeLink });
    }
  }
  return { images: [...images.values()], skipped };
}

function buildDatasetDownloadUrl(filePath, resourceId, baseUrl) {
  const query = new URLSearchParams({ resourceId: String(resourceId), directoryPath: filePath });
  return `${baseUrl}${DATASET_DOWNLOAD_ENDPOINT}?${query.toString()}`;
}

// 把正文图片上传到知识库自身，使图片与文档同生命周期：采集会话目录被 cleanup 删除后，
// 知识库里的图片仍然可访问。图片只 upload 不 build——build 会让 QA 服务尝试把图片解析成
// Markdown 切片向量化，对图片没有意义。
async function uploadImagesToDataset(images, args) {
  const resourceId = positiveSafeIntegerIfPresent(
    firstPresent(args, ["knowledge-base-resource-id", "resource-id"]),
    "--knowledge-base-resource-id",
  );
  if (!resourceId) {
    throw new Error("图片入库必须提供 --knowledge-base-resource-id(知识库资源 ID)；可先用 list-kb 查询并让用户选择");
  }
  const directoryPath = firstNonEmpty(
    pick(args, "image-directory-path"),
    pick(args, "directory-path"),
    defaultIngestDirectoryPath(args),
  );
  const baseUrl = normalizeDatasetBaseUrl(args["base-url"]);
  const uploadUrl = await endpoint("/datasetController/uploadFiles");
  const candidates = images.map((image) => ({
    fileName: path.basename(image.absolutePath),
    kind: "image",
    source: image.absolutePath,
  }));
  if (args["dry-run"]) {
    return {
      dryRun: true,
      endpoint: uploadUrl,
      resourceId,
      directoryPath,
      images: images.map((image) => image.absolutePath),
    };
  }
  const formData = new FormData();
  for (const resolved of await resolveResourceBatch(candidates, args)) {
    formData.append("files", new Blob([resolved.bytes], { type: resolved.contentType }), resolved.candidate.fileName);
  }
  formData.append("resourceId", String(resourceId));
  formData.append("directoryPath", directoryPath);
  if (args.overwrite) {
    formData.append("overwrite", "true");
  }
  const uploaded = await requestMultipart(uploadUrl, formData);
  const uploadItems = asArray(uploaded?.uploadItems ?? uploaded?.items);
  if (!uploadItems.length) {
    throw new Error("图片上传未返回任何 uploadItems，上传可能未成功；请检查知识库资源 ID 与目录");
  }
  // 按文件名把上传结果映射回本地图片，再展开成「正文相对链接 → 知识库下载 URL」。
  const byFileName = new Map();
  for (const item of uploadItems) {
    const filePath = firstNonEmpty(item?.filePath, item?.path);
    if (filePath) {
      byFileName.set(path.basename(filePath), filePath);
    }
  }
  const linkMap = {};
  const unmapped = [];
  for (const image of images) {
    const fileName = path.basename(image.absolutePath);
    const filePath = byFileName.get(fileName);
    if (!filePath) {
      unmapped.push({ fileName, reason: "上传结果里没有对应 filePath" });
      continue;
    }
    const url = buildDatasetDownloadUrl(filePath, resourceId, baseUrl);
    for (const link of image.links) {
      linkMap[link.link] = url;
    }
  }
  return { resourceId, directoryPath, uploaded, linkMap, unmapped };
}

// 文件直传：POST /datasetController/uploadFiles(multipart) → 逐个 POST /datasetController/build。
// 后端把原始文件交给 QA 服务解析成 Markdown 再切片/向量化，跳过本地提取。
async function uploadDocsToDataset(candidates, args) {
  const resourceId = positiveSafeIntegerIfPresent(
    firstPresent(args, ["knowledge-base-resource-id", "resource-id"]),
    "--knowledge-base-resource-id",
  );
  if (!resourceId) {
    throw new Error("文件直传入库必须提供 --knowledge-base-resource-id(知识库资源 ID)；可先用 list-kb 查询并让用户选择");
  }
  const directoryPath = firstNonEmpty(pick(args, "directory-path"), defaultIngestDirectoryPath(args));
  assertConfirmedImportTarget(args, resourceId, directoryPath);
  const uploadUrl = await endpoint("/datasetController/uploadFiles");
  const buildUrl = await endpoint("/datasetController/build");
  if (args["dry-run"]) {
    return {
      dryRun: true,
      endpoints: { upload: uploadUrl, build: buildUrl },
      resourceId,
      directoryPath,
      files: candidates.map((candidate) => candidate.fileName),
      confirmation: confirmedImportTarget(resourceId, directoryPath),
    };
  }
  const resolvedResources = await resolveResourceBatch(candidates, args);
  const formData = new FormData();
  for (const resolved of resolvedResources) {
    formData.append("files", new Blob([resolved.bytes], { type: resolved.contentType }), resolved.candidate.fileName);
  }
  formData.append("resourceId", String(resourceId));
  formData.append("directoryPath", directoryPath);
  const fileDescription = pick(args, "file-description");
  if (fileDescription) {
    formData.append("fileDescription", String(fileDescription));
  }
  if (args.overwrite) {
    formData.append("overwrite", "true");
  }
  const uploaded = await requestMultipart(uploadUrl, formData);
  const uploadItems = asArray(uploaded?.uploadItems ?? uploaded?.items);
  // 上传返回空 uploadItems：文件没真正落地，后续无从 build；直接当失败抛错，避免“上传了却没建索引”却报 ok（M6）。
  if (!uploadItems.length) {
    throw new Error("文件直传未返回任何 uploadItems，上传可能未成功；请检查文件类型与知识库资源 ID");
  }
  const builds = [];
  const buildErrors = new Map();
  for (const item of uploadItems) {
    const filePath = firstNonEmpty(item?.filePath, item?.path, item?.fileUrl);
    if (!filePath) {
      continue;
    }
    try {
      // directoryPath 在 build 接口的语义其实是“单个文件的 filePath”（来自上一步 uploadItems[].filePath），逐个文件触发解析。
      const built = await requestJson("POST", buildUrl, { resourceId, directoryPath: filePath });
      builds.push({ filePath, built });
    } catch (error) {
      buildErrors.set(filePath, error instanceof Error ? error.message : String(error));
    }
  }
  // uploadItems 非空但无一可 build（都缺 filePath）：等于没建任何索引，反映为失败（M6）。
  if (!builds.length) {
    throw new Error("文件已上传但未触发 build（uploadItems 缺少 filePath），知识库未建索引；请检查后端返回");
  }
  const itemResults = buildUploadDocItemResults(candidates, uploadItems, builds, buildErrors);
  return {
    resourceId,
    directoryPath,
    uploaded,
    builds,
    ...(itemResults.length ? { itemResults } : {}),
  };
}

function buildUploadDocItemResults(candidates, uploadItems, builds, buildErrors) {
  const selected = candidates.filter((candidate) => typeof candidate.itemId === "string" && candidate.itemId);
  if (!selected.length) {
    return [];
  }
  const selectedNames = selected.map((candidate) => resultFileName(candidate.fileName));
  const duplicateSelectedNames = new Set(selectedNames.filter((name, index) => name && selectedNames.indexOf(name) !== index));
  return selected.map((candidate) => {
    if (duplicateSelectedNames.has(resultFileName(candidate.fileName))) {
      return { itemId: candidate.itemId, status: "unknown", reason: "ambiguous-file-name" };
    }
    const candidateName = resultFileName(candidate.fileName);
    const matchingUploads = uploadItems.filter((item) => (
      resultFileName(item?.fileName || item?.name || item?.filePath || item?.path) === candidateName
    ));
    if (matchingUploads.length !== 1) {
      return { itemId: candidate.itemId, status: "unknown", reason: "upload-result-unmapped" };
    }
    const uploaded = matchingUploads[0];
    if (!uploaded) {
      return { itemId: candidate.itemId, status: "unknown", reason: "upload-result-unmapped" };
    }
    const filePath = firstNonEmpty(uploaded.filePath, uploaded.path, uploaded.fileUrl);
    const buildError = buildErrors.get(filePath);
    if (buildError) {
      return { itemId: candidate.itemId, status: "failed", reason: buildError };
    }
    const matchingBuilds = builds.filter((item) => item.filePath === filePath);
    return matchingBuilds.length === 1
      ? { itemId: candidate.itemId, status: "success", reason: null }
      : { itemId: candidate.itemId, status: "unknown", reason: "upload-result-unmapped" };
  });
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
  const fallbackName = firstNonEmpty(
    rawItem?.fileName,
    title,
    slugFromUrl(sourceUrl),
    `knowledge-collection-output-${index + 1}`,
  );
  return {
    title,
    fileName: sanitizeFileName(rawItem?.fileName, fallbackName),
    sourceUrl,
    markdown,
    ...compactObject({ itemId: firstNonEmpty(asArray(args["item-id"])[index]) }),
  };
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

const CANONICAL_COLLECTION_KEYS = new Set(["schemaVersion", "title", "source", "backend", "url", "filters", "items"]);
const CANONICAL_ITEM_KEYS = new Set(["title", "url", "author", "publishTime", "markdown", "fileName"]);

function assertExactKeys(value, allowedKeys, label) {
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    throw new Error(`${label} 包含不支持的${label === "collection-result.json" ? "顶层" : ""}字段: ${unexpected.join(", ")}`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} 必须是非空字符串`);
  }
}

function validateCanonicalItem(rawItem, index) {
  const label = `collection-result.json items[${index}]`;
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
    throw new Error(`${label} 必须是对象`);
  }
  assertExactKeys(rawItem, CANONICAL_ITEM_KEYS, label);
  for (const key of ["title", "url", "markdown", "fileName"]) {
    requireNonEmptyString(rawItem[key], `${label}.${key}`);
  }
  for (const key of ["author", "publishTime"]) {
    if (rawItem[key] !== undefined && typeof rawItem[key] !== "string") {
      throw new Error(`${label}.${key} 必须是字符串`);
    }
  }
}

function validateCanonicalCollectionResult(collectionResult) {
  if (!collectionResult || typeof collectionResult !== "object" || Array.isArray(collectionResult)) {
    throw new Error("collection-result.json 根节点必须是对象");
  }
  assertExactKeys(collectionResult, CANONICAL_COLLECTION_KEYS, "collection-result.json");
  if (collectionResult.schemaVersion !== "1.0") {
    throw new Error('collection-result.json schemaVersion 必须是 "1.0"');
  }
  for (const key of ["title", "source", "backend", "url"]) {
    requireNonEmptyString(collectionResult[key], `collection-result.json.${key}`);
  }
  if (!collectionResult.filters || typeof collectionResult.filters !== "object" || Array.isArray(collectionResult.filters)) {
    throw new Error("collection-result.json filters 必须是对象");
  }
  if (!Array.isArray(collectionResult.items)) {
    throw new Error("collection-result.json items 必须是数组");
  }
  collectionResult.items.forEach(validateCanonicalItem);
}

function resolveCanonicalMarkdownPath(rootDir, rawPath, itemIndex, fieldName) {
  const relativePath = firstNonEmpty(rawPath);
  const label = `collection-result.json items[${itemIndex}].${fieldName}`;
  if (!relativePath) {
    throw new Error(`${label} 缺失；必须提供采集根目录内的相对 Markdown 路径`);
  }
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(`${label} 必须是采集根目录内的相对路径，不能使用绝对路径`);
  }

  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (!isPathInside(resolvedRoot, resolvedPath)) {
    throw new Error(`${label} 越出采集根目录，已拒绝读取: ${relativePath}`);
  }

  let realRoot;
  let realPath;
  try {
    realRoot = fs.realpathSync(resolvedRoot);
    realPath = fs.realpathSync(resolvedPath);
  } catch {
    throw new Error(`${label} 指向的 Markdown 文件不存在或无法读取: ${relativePath}`);
  }
  if (!isPathInside(realRoot, realPath)) {
    throw new Error(`${label} 通过符号链接越出采集根目录，已拒绝读取: ${relativePath}`);
  }
  if (!fs.statSync(realPath).isFile()) {
    throw new Error(`${label} 必须指向 Markdown 文件: ${relativePath}`);
  }
  if (![".md", ".markdown"].includes(path.extname(realPath).toLowerCase())) {
    throw new Error(`${label} 必须指向扩展名为 .md 或 .markdown 的 Markdown 文件: ${relativePath}`);
  }

  return {
    absolutePath: realPath,
    relativePath: path.relative(resolvedRoot, resolvedPath).split(path.sep).join("/"),
  };
}

function assertSanitizedCanonicalPath(rootDir, relativePath, itemIndex, fieldName) {
  const candidate = path.resolve(rootDir, relativePath);
  const sanitizedRoot = path.resolve(rootDir, 'sanitized', 'items');
  if (!isPathInside(sanitizedRoot, candidate) || candidate === sanitizedRoot) {
    throw new Error(`collection-result.json items[${itemIndex}].${fieldName} 必须位于 sanitized/items/`);
  }
}

function normalizeCanonicalItem(rawItem, args, index, rootDir) {
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
    throw new Error(`collection-result.json items[${index}] 必须是对象`);
  }
  const markdownPath = resolveCanonicalMarkdownPath(rootDir, rawItem.markdown, index, "markdown");
  const fileNamePath = resolveCanonicalMarkdownPath(rootDir, rawItem.fileName, index, "fileName");
  assertSanitizedCanonicalPath(rootDir, rawItem.markdown, index, "markdown");
  assertSanitizedCanonicalPath(rootDir, rawItem.fileName, index, "fileName");
  if (markdownPath.absolutePath !== fileNamePath.absolutePath) {
    throw new Error(`collection-result.json items[${index}].markdown 与 fileName 必须指向同一个 Markdown 文件`);
  }
  let markdown;
  try {
    markdown = fs.readFileSync(markdownPath.absolutePath, "utf8");
  } catch {
    throw new Error(`collection-result.json items[${index}].markdown 读取失败: ${rawItem.markdown}`);
  }
  const sourceUrl = firstNonEmpty(rawItem.url, rawItem.sourceUrl, pick(args, "source-url"));
  const normalized = compactObject({
    title: firstNonEmpty(rawItem.title, rawItem.name, titleFromMarkdown(markdown), sourceUrl),
    fileName: fileNamePath.relativePath,
    url: firstNonEmpty(rawItem.url),
    sourceUrl,
    author: firstNonEmpty(rawItem.author),
    publishTime: firstNonEmpty(rawItem.publishTime),
    markdown,
    itemId: firstNonEmpty(asArray(args["item-id"])[index]),
  });
  normalized[CANONICAL_LOCAL_PATH] = markdownPath.absolutePath;
  return normalized;
}

function normalizeInputValue(value, args) {
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
    return normalizeInputValue(value.data, args);
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
  const normalized = normalizeInputValue(collectionResult, args);
  return compactObject({
    command: parseJson(args["command-json"], "command-json") || normalized?.command,
    outputDir: pick(args, "output-dir", normalized?.outputDir),
    rawOutput: firstNonEmpty(pick(args, "raw-output"), readRawOutputFile(args), normalized?.rawOutput, rawOutput),
    assetCount: toNumber(pick(args, "asset-count", normalized?.assetCount)) || 0,
    items: normalized?.items || [],
  });
}

function normalizeCanonicalCollectionResult(collectionResult, args, rawOutput, rootDir) {
  validateCanonicalCollectionResult(collectionResult);
  const items = asArray(collectionResult.items)
    .map((item, index) => normalizeCanonicalItem(item, args, index, rootDir));
  const seenPaths = new Set();
  for (const item of items) {
    const canonicalPath = item[CANONICAL_LOCAL_PATH];
    if (seenPaths.has(canonicalPath)) {
      throw new Error(`collection-result.json canonical Markdown 路径重复: ${item.fileName}`);
    }
    seenPaths.add(canonicalPath);
  }
  return {
    schemaVersion: collectionResult.schemaVersion,
    title: collectionResult.title,
    source: collectionResult.source,
    backend: collectionResult.backend,
    url: collectionResult.url,
    filters: collectionResult.filters,
    items,
    ...compactObject({
      command: parseJson(args["command-json"], "command-json") || collectionResult.command,
      outputDir: pick(args, "output-dir", collectionResult.outputDir),
      rawOutput: firstNonEmpty(pick(args, "raw-output"), readRawOutputFile(args), rawOutput),
      assetCount: toNumber(pick(args, "asset-count")) || 0,
    }),
  };
}

function readRawOutputFile(args) {
  const filePath = pick(args, "raw-output-file");
  return filePath ? readTextFile(filePath) : "";
}

function markdownItemsFromFiles(args) {
  const files = [...asArray(args["markdown-file"])];
  for (const dir of asArray(args["markdown-dir"])) {
    const resolvedDir = expandHome(dir);
    let entries;
    try {
      entries = fs.readdirSync(resolvedDir).sort();
    } catch (error) {
      throw new Error(`Markdown 目录读取失败: ${dir}: ${error.message}`);
    }
    for (const entry of entries) {
      if (entry.toLowerCase().endsWith(".md")) {
        files.push(path.join(resolvedDir, entry));
      }
    }
  }
  return files.map((filePath, index) => {
    let markdown;
    try {
      markdown = readTextFile(filePath);
    } catch (error) {
      throw new Error(`Markdown 文件读取失败: ${filePath}: ${error.message}`);
    }
    const fileName = sanitizeFileName(path.basename(filePath), `knowledge-collection-output-${index + 1}`);
    return {
      ...normalizeItem({ markdown, fileName, title: titleFromMarkdown(markdown), sourceUrl: pick(args, "source-url") }, args, index),
      localPath: expandHome(filePath),
    };
  }).filter(Boolean);
}

function loadInputValue(args, stdinValue) {
  if (args["collection-result-json"]) {
    const value = parseJson(args["collection-result-json"], "collection-result-json");
    if (value?.schemaVersion !== undefined) {
      throw new Error("--collection-result-json 仅兼容内联 Markdown；规范 collection-result.json 包含相对路径，必须使用 --collection-result-file");
    }
    return { type: "collection-result-inline-compat", value };
  }
  if (args["collection-result-file"]) {
    const filePath = path.resolve(expandHome(args["collection-result-file"]));
    return { type: "collection-result-file", value: readJsonFile(filePath), rootDir: path.dirname(filePath) };
  }
  if (args["bycli-json"]) {
    return { type: "bycli-legacy", value: parseJson(args["bycli-json"], "bycli-json") };
  }
  if (args["bycli-json-file"]) {
    return { type: "bycli-legacy", value: readJsonFile(args["bycli-json-file"]) };
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
  if (input.type === "collection-result-file") {
    collectionResult = normalizeCanonicalCollectionResult(input.value, args, JSON.stringify(input.value), input.rootDir);
  } else if (input.type === "collectionResult" || input.type === "collection-result-inline-compat") {
    collectionResult = normalizeCollectionResult(input.value, args, JSON.stringify(input.value));
  } else if (input.type !== "none") {
    collectionResult = normalizeCollectionResult(normalizeInputValue(input.value, args), args, typeof input.value === "string" ? input.value : JSON.stringify(input.value));
  } else {
    collectionResult = normalizeCollectionResult({ items: [] }, args, "");
  }
  collectionResult.items = [...(collectionResult.items || []), ...fileItems];
  const acceptsEmptyCanonicalView = input.type === "collection-result-file" && collectionResult.items.length === 0;
  if (!collectionResult.items.length && !acceptsEmptyCanonicalView) {
    const { uploadable, extractable } = classifyDiscardedDocCandidates(args, stdinValue);
    if (uploadable.length) {
      throw new Error(`检测到 pdf/docx 等文档（${uploadable.join("、")}），请改用 upload-doc 直传入库（后端 QA 解析，免提取）`);
    }
    if (extractable.length) {
      throw new Error(`检测到 ${extractable.join("、")}（白名单外的有正文文档），请先提取为 Markdown 再用 --markdown-file 入库`);
    }
    throw new Error("未找到可入库的 Markdown。请传 --collection-result-file、--markdown-file、--markdown-dir、兼容参数 --bycli-json-file 或 stdin");
  }
  collectionResult.items = collectionResult.items.map((item, index) => ({
    ...item,
    fileName: input.type === "collection-result-file"
      ? item.fileName
      : sanitizeFileName(item.fileName, `knowledge-collection-output-${index + 1}`),
  }));
  return collectionResult;
}

function buildTask(args, stdinJson) {
  const taskJson = parseJson(args["task-json"], "task-json") || stdinJson?.task || {};
  const knowledgeBaseResourceId = positiveSafeIntegerIfPresent(
    pick(args, "knowledge-base-resource-id", taskJson.knowledgeBaseResourceId),
    "--knowledge-base-resource-id",
  );
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
    knowledgeBaseResourceId: positiveSafeIntegerIfPresent(
      pick(args, "knowledge-base-resource-id", targetConfigJson.knowledgeBaseResourceId || task.knowledgeBaseResourceId),
      "--knowledge-base-resource-id",
    ),
    knowledgeBaseId: pick(args, "knowledge-base-id", targetConfigJson.knowledgeBaseId || task.knowledgeBaseId),
    knowledgeBaseName: pick(args, "knowledge-base-name", targetConfigJson.knowledgeBaseName || task.knowledgeBaseName),
    directoryPath: firstNonEmpty(
      pick(args, "directory-path"),
      targetConfigJson.directoryPath,
      defaultIngestDirectoryPath(args),
    ),
  });
}

function toMarkdownFiles(collectionResult) {
  return collectionResult.items.map((item) => {
    const markdownFile = {
      fileName: item.fileName,
      markdown: item.markdown,
      size: Buffer.byteLength(item.markdown || "", "utf8"),
      ...compactObject({ itemId: item.itemId }),
    };
    if (item.localPath) {
      markdownFile.localPath = item.localPath;
    }
    if (item[CANONICAL_LOCAL_PATH]) {
      markdownFile[CANONICAL_LOCAL_PATH] = item[CANONICAL_LOCAL_PATH];
    }
    return markdownFile;
  });
}

function resultFileName(value) {
  if (!value) {
    return '';
  }
  try {
    return path.basename(new URL(String(value), 'file:///').pathname);
  } catch {
    return path.basename(String(value));
  }
}

function buildIngestItemResults(markdownFiles, managerResult) {
  const selected = markdownFiles.filter((item) => typeof item.itemId === 'string' && item.itemId);
  if (!selected.length) {
    return [];
  }
  const explicit = asArray(managerResult?.itemResults)
    .filter((item) => item && typeof item === 'object' && typeof item.itemId === 'string')
    .map((item) => ({
      itemId: item.itemId,
      status: ['success', 'failed', 'pending', 'unknown'].includes(item.status) ? item.status : 'unknown',
      reason: firstNonEmpty(item.reason) || null,
    }));
  if (explicit.length) {
    const byId = new Map(explicit.map((item) => [item.itemId, item]));
    return selected.map((item) => byId.get(item.itemId) || {
      itemId: item.itemId,
      status: 'unknown',
      reason: 'manager-result-unmapped',
    });
  }
  const uploaded = asArray(managerResult?.uploaded?.uploadItems ?? managerResult?.uploaded?.items);
  const builds = asArray(managerResult?.builds);
  const selectedNames = selected.map((item) => resultFileName(item.fileName || item.localPath));
  const duplicateSelectedNames = new Set(selectedNames.filter((name, index) => name && selectedNames.indexOf(name) !== index));
  return selected.map((item) => {
    const expectedName = resultFileName(item.fileName || item.localPath);
    if (duplicateSelectedNames.has(expectedName)) {
      return { itemId: item.itemId, status: 'unknown', reason: 'ambiguous-file-name' };
    }
    const uploadedMatches = uploaded.filter((entry) => (
      resultFileName(entry?.fileName || entry?.name || entry?.filePath || entry?.path) === expectedName
    ));
    const uploadedPath = uploadedMatches.length === 1
      ? firstNonEmpty(uploadedMatches[0]?.filePath, uploadedMatches[0]?.path, uploadedMatches[0]?.fileUrl)
      : '';
    const buildMatches = builds.filter((entry) => (
      uploadedPath && firstNonEmpty(entry?.filePath, entry?.path) === uploadedPath
    ));
    if (uploadedMatches.length === 1 && buildMatches.length === 1) {
      return { itemId: item.itemId, status: 'success', reason: null };
    }
    return { itemId: item.itemId, status: 'unknown', reason: 'manager-result-unmapped' };
  });
}

function assertImportReady(targetConfig) {
  if (!targetConfig.knowledgeBaseResourceId && !targetConfig.knowledgeBaseId) {
    throw new Error("导入知识库必须提供 --knowledge-base-resource-id 或 --knowledge-base-id");
  }
}

function hasImportTarget(targetConfig) {
  return Boolean(targetConfig?.knowledgeBaseResourceId || targetConfig?.knowledgeBaseId);
}

function resolveKnowledgeManagerScript(args) {
  const explicit = firstNonEmpty(
    pick(args, "knowledge-manager-script"),
    process.env.BY_KNOWLEDGE_MANAGER_SCRIPT,
  );
  const candidates = explicit
    ? [explicit]
    : [
      path.resolve(SCRIPT_DIR, "../../by-knowledge-manager/scripts/by-knowledge-manager.mjs"),
      path.resolve(process.cwd(), "middleware/openclaw/skills/by-knowledge-manager/scripts/by-knowledge-manager.mjs"),
    ];
  for (const candidate of candidates) {
    const resolved = expandHome(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  throw new Error(`找不到 by-knowledge-manager 脚本。请设置 BY_KNOWLEDGE_MANAGER_SCRIPT 或 --knowledge-manager-script。已尝试: ${candidates.join(", ")}`);
}

function candidateSessionDirs(args, payloads) {
  const dirs = [
    ...asArray(args["session-dir"]),
    pick(args, "output-dir"),
    payloads.collectionResult?.outputDir,
  ];
  for (const key of ["collection-result-file", "bycli-json-file"]) {
    const filePath = pick(args, key);
    if (filePath && filePath !== true) {
      dirs.push(path.dirname(expandHome(filePath)));
    }
  }
  const seen = new Set();
  return dirs
    .map((dir) => firstNonEmpty(dir))
    .filter(Boolean)
    .map((dir) => path.resolve(expandHome(dir)))
    .filter((dir) => {
      if (seen.has(dir)) {
        return false;
      }
      seen.add(dir);
      return fs.existsSync(dir);
    });
}

function existingMarkdownPath(item, sessionDirs) {
  const direct = firstNonEmpty(item[CANONICAL_LOCAL_PATH], item.localPath);
  if (direct && fs.existsSync(expandHome(direct))) {
    return expandHome(direct);
  }
  const fileName = firstNonEmpty(item.fileName);
  if (!fileName) {
    return "";
  }
  if (path.isAbsolute(fileName) && fs.existsSync(fileName)) {
    return fileName;
  }
  for (const dir of sessionDirs) {
    const candidates = [
      path.resolve(dir, fileName),
      path.resolve(dir, path.basename(fileName)),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return "";
}

function prepareMarkdownUploadFiles(args, payloads) {
  const sessionDirs = candidateSessionDirs(args, payloads);
  const filePaths = [];
  const reusedFiles = [];
  const generatedFiles = [];
  let tempDir = "";

  for (const [index, item] of payloads.markdownFiles.entries()) {
    const existingPath = existingMarkdownPath(item, sessionDirs);
    if (existingPath) {
      filePaths.push(existingPath);
      reusedFiles.push(existingPath);
      continue;
    }

    if (!tempDir) {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-collection-ingest-"));
    }
    const fileName = sanitizeFileName(item.fileName, `knowledge-collection-output-${index + 1}.md`);
    let filePath = path.join(tempDir, fileName);
    if (fs.existsSync(filePath)) {
      filePath = path.join(tempDir, `${index + 1}-${fileName}`);
    }
    fs.writeFileSync(filePath, item.markdown || "", "utf8");
    filePaths.push(filePath);
    generatedFiles.push(filePath);
  }

  return { tempDir, filePaths, reusedFiles, generatedFiles, sessionDirs };
}

function runNodeJson(scriptPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => {
      let json;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = undefined;
      }
      if (code !== 0 || json?.ok === false) {
        const detail = json?.error || stderr || stdout || `exit ${code}`;
        reject(new Error(`by-knowledge-manager upload 失败: ${detail}`));
        return;
      }
      const expectedActions = options.expectedActions || ["upload"];
      if (!json || typeof json !== "object" || Array.isArray(json) || json.ok !== true || !expectedActions.includes(json.action)) {
        reject(new Error(`by-knowledge-manager ${args[0]} 未返回有效 JSON 返回契约`));
        return;
      }
      resolve({ code, stdout, stderr, json });
    });
  });
}

async function uploadMarkdownWithKnowledgeManager(args, payloads) {
  const resourceId = toPositiveSafeInteger(payloads.targetConfig.knowledgeBaseResourceId || payloads.targetConfig.knowledgeBaseId);
  if (!resourceId) {
    throw new Error("导入知识库必须提供 --knowledge-base-resource-id 或 --knowledge-base-id");
  }
  const directoryPath = firstNonEmpty(payloads.targetConfig.directoryPath, "/");
  assertConfirmedImportTarget(args, resourceId, directoryPath);
  const managerScript = resolveKnowledgeManagerScript(args);
  const hasCanonicalArtifacts = payloads.markdownFiles.some((item) => Boolean(item[CANONICAL_LOCAL_PATH]));
  if (args["dry-run"]) {
    const sessionDirs = candidateSessionDirs(args, payloads);
    return {
      dryRun: true,
      managerScript,
      command: "upload",
      resourceId,
      directoryPath,
      confirmation: confirmedImportTarget(resourceId, directoryPath),
      files: payloads.markdownFiles.map((item) => ({
        fileName: item.fileName,
        source: item[CANONICAL_LOCAL_PATH] ? "validated-canonical" : undefined,
        existingPath: item[CANONICAL_LOCAL_PATH]
          ? undefined
          : existingMarkdownPath(item, sessionDirs) || undefined,
      })),
      ...(!hasCanonicalArtifacts ? { sessionDirs } : {}),
    };
  }

  const { tempDir, filePaths, reusedFiles, generatedFiles, sessionDirs } = prepareMarkdownUploadFiles(args, payloads);
  let preserveTempForContinuation = false;
  try {
    const baseManagerArgs = [
      "upload",
      "--resource-id", String(resourceId),
      "--directory-path", directoryPath,
    ];
    for (const filePath of filePaths) {
      baseManagerArgs.push("--file-path", filePath);
    }
    const confirmedOverwritePaths = asArray(args["confirmed-overwrite-path"])
      .filter((item) => item !== true)
      .map(String);
    let result;
    if (confirmedOverwritePaths.length) {
      const checked = await runNodeJson(managerScript, [...baseManagerArgs, "--check-conflicts"]);
      const actualPaths = asArray(checked.json?.overwritePaths).map(String).sort();
      const confirmedPaths = [...new Set(confirmedOverwritePaths)].sort();
      if (!checked.json?.needsOverwriteConfirmation || JSON.stringify(actualPaths) !== JSON.stringify(confirmedPaths)) {
        throw new Error("--confirmed-overwrite-path 与最新冲突路径不一致，已拒绝覆盖");
      }
      const updateArgs = [
        "update-file",
        "--resource-id", String(resourceId),
        "--directory-path", directoryPath,
        "--skip-conflict-check",
      ];
      for (const filePath of filePaths) {
        updateArgs.push("--file-path", filePath);
      }
      result = await runNodeJson(managerScript, updateArgs, { expectedActions: ["update-file"] });
    } else {
      const managerArgs = [...baseManagerArgs];
      if (args["check-conflicts"]) {
        managerArgs.push("--check-conflicts");
      }
      result = await runNodeJson(managerScript, managerArgs);
    }
    if (result.json?.needsOverwriteConfirmation) {
      preserveTempForContinuation = Boolean(tempDir);
      return {
        action: "confirm-overwrite",
        conflict: Boolean(result.json.conflict),
        needsOverwriteConfirmation: true,
        overwritePaths: asArray(result.json.overwritePaths),
        resourceId,
        directoryPath,
        manager: result.json,
        continuation: {
          command: "ingest",
          markdownFilePaths: filePaths,
          resourceUploadMustNotBeReplayed: true,
          requiredArguments: {
            "knowledge-base-resource-id": resourceId,
            "directory-path": directoryPath,
            "confirmed-knowledge-base-resource-id": resourceId,
            "confirmed-directory-path": directoryPath,
            "confirmed-overwrite-path": asArray(result.json.overwritePaths),
          },
        },
      };
    }
    const publicResult = {
      managerScript,
      resourceId,
      directoryPath,
      manager: result.json,
    };
    const itemResults = buildIngestItemResults(payloads.markdownFiles, result.json);
    return hasCanonicalArtifacts
      ? {
        ...publicResult,
        ...(itemResults.length ? { itemResults } : {}),
        files: payloads.markdownFiles.map((item) => ({
          fileName: item.fileName,
          source: item[CANONICAL_LOCAL_PATH] ? "validated-canonical" : "runtime-generated",
        })),
      }
      : {
        ...publicResult,
        ...(itemResults.length ? { itemResults } : {}),
        tempDir,
        filePaths,
        reusedFiles,
        generatedFiles,
        sessionDirs,
      };
  } finally {
    if (tempDir && !args["keep-temp"] && !preserveTempForContinuation) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
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

async function resolveLegacyKnowledgeBaseId(args, payloads, stdinJson) {
  if (payloads.targetConfig.knowledgeBaseResourceId) {
    return payloads.targetConfig.knowledgeBaseResourceId;
  }
  const legacyId = positiveSafeIntegerIfPresent(
    payloads.targetConfig.knowledgeBaseId,
    "--knowledge-base-id",
  );
  if (!legacyId) {
    return undefined;
  }
  const listed = await listKnowledgeBases({ ...args, "page-num": "1", "page-size": "1000" }, stdinJson);
  const matches = listed.knowledgeBases.filter((item) => (
    toPositiveSafeInteger(item.resourceId) === legacyId
    || toPositiveSafeInteger(item.datasetId) === legacyId
  ));
  if (matches.length !== 1) {
    throw new Error(`--knowledge-base-id ${legacyId} 无法唯一解析为知识库资源 ID；请先用 list-kb 查询并改用 --knowledge-base-resource-id`);
  }
  const resourceId = matches[0].resourceId;
  payloads.targetConfig.knowledgeBaseResourceId = resourceId;
  payloads.task.knowledgeBaseResourceId = resourceId;
  return resourceId;
}

function buildPayloads(args, stdinValue) {
  const stdinJson = stdinValue && typeof stdinValue === "object" && !Array.isArray(stdinValue) ? stdinValue : {};
  const collectionResult = buildCollectionResult(args, stdinValue);
  const task = buildTask(args, stdinJson);
  const targetConfig = buildTargetConfig(args, stdinJson, task);
  const runId = toNumber(pick(args, "run-id", stdinJson.runId));
  const markdownFiles = toMarkdownFiles(collectionResult);
  const itemIds = asArray(args["item-id"]).filter((item) => item !== true && firstNonEmpty(item));
  if (itemIds.length && itemIds.length !== markdownFiles.length) {
    throw new Error(`--item-id 数量必须与选中 Markdown 数量一致（${itemIds.length} != ${markdownFiles.length}）`);
  }
  return {
    runId,
    task,
    targetConfig,
    collectionResult,
    markdownFiles,
    needsMaterialization: markdownFiles.length === 0 && Boolean(args["collection-result-file"]),
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
    name: "knowledge-collection-ingest",
    commands: {
      "list-kb": "调用 /spaceDir/listPersonalKb 查询可入库个人知识库",
      normalize: "规范化知识采集 Markdown 输出，不请求后端",
      "upload-resource": "上传图片/音频/视频到 /chat/uploadFiles（会话文件，不进知识库）",
      "upload-images": "把选中正文里的本地图片上传知识库（只 upload 不 build），返回相对链接到下载 URL 的映射",
    "upload-doc": "文件直传知识库：/datasetController/uploadFiles + build，后端解析 pdf/docx/pptx/xlsx/csv/txt/md",
      ingest: "归一化 Markdown 后调用 by-knowledge-manager upload/build",
    },
    inputs: [
      "--collection-result-file <file>",
      "--collection-result-json <json> (inline compatibility; relative paths require --collection-result-file)",
      "--markdown-file <file> (可重复)",
      "--markdown-dir <dir>",
      "--bycli-json-file <file> (legacy compatibility)",
      "--bycli-json <json> (legacy compatibility)",
      "--file-url/--image-url/--resource-url <url>",
      "--file-path/--image-path/--resource-path <path>",
      "--allow-private-resource (explicitly trust private-network resource URLs)",
      "--confirmed-knowledge-base-resource-id <id> (required for writes)",
      "--confirmed-directory-path <path> (required for writes)",
      "--confirmed-overwrite-path <path> (repeatable; resumes a conflict after exact recheck)",
      "--item-id <id> (可重复；按 Markdown 输入顺序绑定 inventory itemId)",
      "stdin JSON 或 Markdown 文本",
    ],
    requiredForImport: ["--knowledge-base-resource-id 或 --knowledge-base-id"],
    examples: [
      "node knowledge-collection-ingest.mjs normalize --collection-result-file /tmp/knowledge-collection-result.json --knowledge-base-resource-id 90001",
      "node knowledge-collection-ingest.mjs ingest --dry-run --markdown-file article.md --knowledge-base-resource-id 90001 --directory-path /imports",
      "node knowledge-collection-ingest.mjs ingest --markdown-file article.md --knowledge-base-resource-id 90001 --directory-path /imports --confirmed-knowledge-base-resource-id 90001 --confirmed-directory-path /imports",
      "node knowledge-collection-ingest.mjs ingest --markdown-file article.md --knowledge-base-resource-id 90001 --directory-path /imports --confirmed-knowledge-base-resource-id 90001 --confirmed-directory-path /imports --confirmed-overwrite-path /imports/article.md",
      "node knowledge-collection-ingest.mjs upload-doc --file-path report.pdf --knowledge-base-resource-id 90001 --directory-path /imports --confirmed-knowledge-base-resource-id 90001 --confirmed-directory-path /imports",
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

  if (command === "upload-doc") {
    const { docs, rejected } = buildDocCandidates(args, stdinValue);
    if (!docs.length) {
      throw new Error(
        `未找到可直传的文档文件。支持 ${[...DOC_INGEST_EXTENSIONS].join("/")}；请用 --file-path 或 --file-url 指定。`
        + (rejected.length ? ` 已忽略不支持类型：${rejected.map((item) => item.fileName).join("、")}` : ""),
      );
    }
    const result = await uploadDocsToDataset(docs, args);
    render({ ok: true, action: "upload-doc", rejected, ...result });
    return;
  }

  if (command === "upload-images") {
    const markdownFiles = asArray(firstPresent(args, ["markdown-file"]) ?? []).map(String).filter(Boolean);
    if (!markdownFiles.length) {
      throw new Error("upload-images 必须用 --markdown-file 指定选中的正文文件（可重复传入）");
    }
    const { images, skipped } = collectLocalImages(markdownFiles);
    if (!images.length) {
      render({ ok: true, action: "upload-images", images: [], linkMap: {}, skipped });
      return;
    }
    const result = await uploadImagesToDataset(images, args);
    render({ ok: true, action: "upload-images", imageCount: images.length, skipped, ...result });
    return;
  }

  const resourceCandidates = buildResourceCandidates(args, stdinValue);
  // 分流：图片 / 音频 / 视频走 /chat/uploadFiles；其余文件类型继续走下方 Markdown 入库流程。
  // upload-resource 是显式上传命令，接受任意资源；ingest 自动分流只挑图片 / 音频 / 视频，非媒体文件交给 Markdown 流程。
  const mediaCandidates = resourceCandidates.filter((candidate) => candidate.kind === "image" || candidate.kind === "video" || candidate.kind === "audio");
  if (command === "upload-resource") {
    if (!resourceCandidates.length) {
      throw new Error("未找到可上传的图片/音频/视频地址。请传 --image-url、指向图片/音频/视频的 --file-url、--file-path，或在 stdin 中提供 fileUrl/imageUrl/downloadUrl/path");
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

  let payloads;
  try {
    payloads = buildPayloads(args, stdinValue);
  } catch (error) {
    if (command === "ingest" && mediaCandidates.length && /未找到可入库的 Markdown/.test(error.message)) {
      throw new Error("ingest 必须包含可入库的 Markdown；仅上传图片、音频或视频请使用 upload-resource");
    }
    throw error;
  }

  if (command === "normalize") {
    render({
      ok: true,
      action: "normalize",
      ...(payloads.needsMaterialization ? { needsMaterialization: true } : {}),
      summary: summarizePayloads(payloads),
      payloads,
    });
    return;
  }

  if (command === "store" || command === "import") {
    throw new Error("store/import 命令已废弃；请使用 ingest，由知识采集入库编排调用 by-knowledge-manager upload/build");
    return;
  }

  if (command === "ingest") {
    if (payloads.needsMaterialization) {
      render({
        ok: true,
        action: "ingest",
        needsMaterialization: true,
        summary: summarizePayloads(payloads),
      });
      return;
    }
    if (!hasImportTarget(payloads.targetConfig)) {
      const listed = await listKnowledgeBases(args, stdinJson);
      render({ ok: true, action: "select-knowledge-base", needsKnowledgeBaseSelection: true, summary: summarizePayloads(payloads), ...listed });
      return;
    }
    await resolveLegacyKnowledgeBaseId(args, payloads, stdinJson);
    const resourceId = positiveSafeIntegerIfPresent(
      payloads.targetConfig.knowledgeBaseResourceId || payloads.targetConfig.knowledgeBaseId,
      "知识库资源 ID",
    );
    const directoryPath = firstNonEmpty(payloads.targetConfig.directoryPath, "/");
    assertConfirmedImportTarget(args, resourceId, directoryPath);
    if (args["dry-run"]) {
      const uploaded = await uploadMarkdownWithKnowledgeManager(args, payloads);
      const resourceUpload = mediaCandidates.length ? await uploadResources(mediaCandidates, args) : undefined;
      if (resourceUpload) {
        render({
          ok: true,
          action: "ingest",
          dryRun: true,
          summary: summarizePayloads(payloads),
          resourceUpload,
          knowledgeIngest: uploaded,
        });
        return;
      }
      render({
        ok: true,
        action: "ingest",
        dryRun: true,
        summary: summarizePayloads(payloads),
        upload: uploaded,
      });
      return;
    }
    const uploaded = await uploadMarkdownWithKnowledgeManager(args, payloads);
    if (uploaded.needsOverwriteConfirmation) {
      render({
        ok: true,
        action: "confirm-overwrite",
        conflict: uploaded.conflict,
        needsOverwriteConfirmation: true,
        overwritePaths: uploaded.overwritePaths,
        summary: summarizePayloads(payloads),
        continuation: uploaded.continuation,
      });
      return;
    }
    const resourceUpload = mediaCandidates.length ? await uploadResources(mediaCandidates, args) : undefined;
    if (resourceUpload) {
      render({
        ok: true,
        action: "ingest",
        summary: summarizePayloads(payloads),
        resourceUpload,
        knowledgeIngest: uploaded,
        ...(uploaded.itemResults ? { itemResults: uploaded.itemResults } : {}),
      });
      return;
    }
    render({
      ok: true,
      action: "ingest",
      summary: summarizePayloads(payloads),
      uploaded,
      ...(uploaded.itemResults ? { itemResults: uploaded.itemResults } : {}),
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
