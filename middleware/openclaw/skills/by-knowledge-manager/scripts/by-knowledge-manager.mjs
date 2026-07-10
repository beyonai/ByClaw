#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { initRedis, getRedis, closeRedis, DiscoveryClient, RegistryKeys } from "@byclaw/by-framework";

const DEFAULT_CONTEXT_PATH = "/byaiService";
const DEFAULT_SIGNATURE_SALT = "{#@*A12^c0+}";
const DEFAULT_BACKEND_SERVICE_NAME = "ByaiService";
const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".xlsx",
  ".xls",
  ".csv",
]);

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

function asArray(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
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

let discoveryClient;

function discoveryTimeoutMs() {
  return Math.max(500, Number.parseInt(firstNonEmpty(process.env.BYCLAW_REDIS_DISCOVERY_TIMEOUT_MS, "3000"), 10));
}

function getDiscoveryClient() {
  if (!discoveryClient) {
    initRedis({
      connectTimeout: discoveryTimeoutMs(),
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    discoveryClient = new DiscoveryClient(getRedis(), 30);
  }
  return discoveryClient;
}

async function closeDiscovery() {
  try {
    discoveryClient?.close();
  } catch {}
  discoveryClient = undefined;
  try {
    await closeRedis();
  } catch {}
}

function backendInstanceBaseUrl(instance) {
  const pathPrefix = firstNonEmpty(instance?.pathPrefix, DEFAULT_CONTEXT_PATH).replace(/^\/+|\/+$/g, "");
  const prefix = pathPrefix ? `/${pathPrefix}` : "";
  return `${instance.protocol || "http"}://${instance.host}:${instance.port}${prefix}`.replace(/\/+$/g, "");
}

async function discoverBackendBaseUrl() {
  const serviceName = firstNonEmpty(process.env.BE_DOMAINNAME, DEFAULT_BACKEND_SERVICE_NAME);
  const redisKey = RegistryKeys.sd_instance_details(serviceName);
  if (!firstNonEmpty(process.env.REDIS_HOST)) {
    return { baseUrl: "", source: "redis", serviceName, redisKey };
  }
  const client = getDiscoveryClient();
  const instance = await client.discover(serviceName, "round-robin");
  if (!instance) {
    return { baseUrl: "", source: "redis", serviceName, redisKey };
  }
  return {
    baseUrl: backendInstanceBaseUrl({
      host: instance.host,
      port: instance.port,
      pathPrefix: instance.metadata?.path_prefix,
    }),
    source: "redis",
    serviceName,
    redisKey,
    instanceId: instance.id,
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
  if (body && Object.prototype.hasOwnProperty.call(body, "success") && body.success === false) {
    throw new Error(body.msg || body.message || "接口返回失败 success=false");
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "code")) {
    const okCodes = [0, 200, "0", "200"];
    if (!okCodes.includes(body.code)) {
      throw new Error(body.msg || body.message || `接口返回异常 code=${body.code}`);
    }
    return Object.prototype.hasOwnProperty.call(body, "data") ? body.data : body;
  }
  return body;
}

async function requestJson(method, url, payload) {
  const bodyText = payload === undefined ? "" : JSON.stringify(payload);
  const response = await fetch(url, {
    method: method.toUpperCase(),
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

async function requestDownload(url, output) {
  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders("", null),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}: ${response.statusText || "download failed"}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("application/json")) {
    try {
      const body = JSON.parse(bytes.toString("utf8"));
      if (
        body
        && (
          body.success === false
          || (Object.prototype.hasOwnProperty.call(body, "code") && ![0, 200, "0", "200"].includes(body.code))
        )
      ) {
        throw new Error(body.msg || body.message || `接口返回异常 code=${body.code}`);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`下载接口返回 JSON 但无法解析: ${error.message}`);
      }
      throw error;
    }
  }
  const outputPath = expandHome(output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, bytes);
  const contentDisposition = response.headers.get("content-disposition") || "";
  const fileNameMatch = contentDisposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1].replace(/^"|"$/g, "")) : "";
  return {
    output: outputPath,
    bytes: bytes.length,
    contentType,
    fileName,
  };
}

function render(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function sanitizeDirectoryResult(value, resourceId) {
  if (!value || typeof value !== "object") {
    return value ?? null;
  }
  return compactObject({
    resourceId,
    directoryPath: value.directoryPath,
    directoryName: value.directoryName,
    directoryDescription: value.directoryDescription,
  });
}

function sanitizeUploadItem(item) {
  if (!item || typeof item !== "object") {
    return item;
  }
  return compactObject({
    fileName: item.fileName || item.name,
    filePath: firstNonEmpty(item.filePath, item.path, item.fileUrl),
  });
}

function sanitizeListItem(item) {
  if (!item || typeof item !== "object") {
    return item;
  }
  return compactObject({
    name: item.name,
    type: item.type,
    fileName: item.fileName,
  });
}

function sanitizeUploadResult(value, resourceId) {
  if (!value || typeof value !== "object") {
    return { resourceId, uploadItems: [] };
  }
  return compactObject({
    resourceId: toNumber(value.resourceId) || resourceId,
    uploadItems: asArray(value.uploadItems ?? value.items).map(sanitizeUploadItem),
  });
}

function sanitizeReadFileResult(value, resourceId) {
  if (!value || typeof value !== "object") {
    return { resourceId };
  }
  return compactObject({
    resourceId,
    filePath: value.filePath,
    startLine: toNumber(value.startLine),
    endLine: toNumber(value.endLine),
    content: value.data,
    reachedEof: value.reachedEof,
  });
}

function sanitizeSearchItem(item) {
  if (!item || typeof item !== "object") {
    return item;
  }
  return compactObject({
    resourceId: toNumber(item.knCode),
    filePath: item.filePath,
    chunkNo: toNumber(item.chunkNo),
    chunkText: item.chunkText,
    score: item.score,
    imagePath: item.imagePath,
    startLine: toNumber(item.startLine),
    endLine: toNumber(item.endLine),
  });
}

function helpManual() {
  return {
    ok: true,
    name: "by-knowledge-manager",
    description: "知识库内容管理 CLI：管理知识库目录、文件上传/更新/构建/下载/删除。",
    usage: "node ./scripts/by-knowledge-manager.mjs <command> [options]",
    commands: {
      list: {
        description: "查询指定目录下的文件和子目录",
        required: ["--resource-id", "--directory-path"],
        optional: [],
        example: "list --resource-id 10037121 --directory-path /产品资料",
      },
      mkdir: {
        description: "创建知识库目录",
        required: ["--resource-id", "--directory-path", "--directory-name"],
        optional: ["--directory-description"],
        example: "mkdir --resource-id 10037121 --directory-path / --directory-name 产品资料",
      },
      "rename-dir": {
        description: "重命名知识库目录",
        required: ["--resource-id", "--directory-path", "--directory-name"],
        optional: [],
        example: "rename-dir --resource-id 10037121 --directory-path /产品资料 --directory-name 产品手册",
      },
      "delete-dir": {
        description: "删除知识库目录",
        required: ["--resource-id", "--directory-path"],
        optional: [],
        example: "delete-dir --resource-id 10037121 --directory-path /产品手册",
      },
      "check-conflicts": {
        description: "上传前检查目标目录是否存在同名文件",
        required: ["--resource-id", "--directory-path", "--file-name"],
        optional: ["可重复传 --file-name"],
        example: "check-conflicts --resource-id 10037121 --directory-path /产品资料 --file-name a.md",
      },
      upload: {
        description: "上传文件到知识库目录，成功后自动触发构建",
        required: ["--resource-id", "--directory-path", "--file-path"],
        optional: ["可重复传 --file-path", "--file-description", "--process-front-matter true|false", "--check-conflicts", "仅支持 .md/.markdown/.txt/.pdf/.docx/.doc/.pptx/.ppt/.xlsx/.xls/.csv"],
        example: "upload --resource-id 10037121 --directory-path /产品资料 --file-path /tmp/a.md",
      },
      "update-file": {
        description: "覆盖上传文件，默认先检查冲突，成功后自动触发构建",
        required: ["--resource-id", "--directory-path", "--file-path"],
        optional: ["可重复传 --file-path", "--file-description", "--process-front-matter true|false", "--skip-conflict-check", "仅支持 .md/.markdown/.txt/.pdf/.docx/.doc/.pptx/.ppt/.xlsx/.xls/.csv"],
        example: "update-file --resource-id 10037121 --directory-path /产品资料 --file-path /tmp/a.md",
      },
      build: {
        description: "触发指定知识文件构建",
        required: ["--resource-id", "--file-path"],
        optional: [],
        example: "build --resource-id 10037121 --file-path /产品资料/a.md",
      },
      "build-status": {
        description: "查询知识文件构建状态",
        required: ["--resource-id", "--file-path"],
        optional: [],
        example: "build-status --resource-id 10037121 --file-path /产品资料/a.md",
      },
      download: {
        description: "下载知识库文件或目录压缩包",
        required: ["--resource-id", "--output", "--file-path 或 --directory-path"],
        optional: [],
        example: "download --resource-id 10037121 --file-path /产品资料/a.md --output /tmp/a.md",
      },
      "read-file": {
        description: "读取知识库文件指定行范围内容",
        required: ["--resource-id", "--file-path"],
        optional: ["--start-line", "--end-line"],
        example: "read-file --resource-id 10037121 --file-path /产品资料/a.md --start-line 1 --end-line 20",
      },
      search: {
        description: "检索知识库内容",
        required: ["--resource-id", "--query"],
        optional: ["可重复传 --resource-id", "--top-k"],
        example: "search --resource-id 10037121 --query 员工请假流程是什么 --top-k 5",
      },
      "remove-file": {
        description: "删除知识库文件",
        required: ["--resource-id", "--file-path"],
        optional: [],
        example: "remove-file --resource-id 10037121 --file-path /产品资料/a.md",
      },
    },
  };
}

function requireNumberArg(args, name) {
  const value = toNumber(pick(args, name));
  if (!value) {
    throw new Error(`缺少 --${name}`);
  }
  return value;
}

function optionalNumberArg(args, name) {
  const value = pick(args, name);
  if (value === undefined || value === true || value === "") {
    return undefined;
  }
  const parsed = toNumber(value);
  if (parsed === undefined) {
    throw new Error(`--${name} 必须是数字`);
  }
  return parsed;
}

function requireStringArg(args, name) {
  const value = firstNonEmpty(pick(args, name));
  if (!value) {
    throw new Error(`缺少 --${name}`);
  }
  return value;
}

function directoryPayload(args) {
  return {
    resourceId: requireNumberArg(args, "resource-id"),
    directoryPath: requireStringArg(args, "directory-path"),
  };
}

function filePayload(args) {
  return {
    resourceId: requireNumberArg(args, "resource-id"),
    directoryPath: requireStringArg(args, "file-path"),
  };
}

function downloadTargetPath(args) {
  const filePath = firstNonEmpty(pick(args, "file-path"));
  const directoryPath = firstNonEmpty(pick(args, "directory-path"));
  if (filePath && directoryPath) {
    throw new Error("download 只能传 --file-path 或 --directory-path 其中一个");
  }
  if (filePath) {
    return { path: filePath, type: "file" };
  }
  if (directoryPath) {
    return { path: directoryPath, type: "directory" };
  }
  throw new Error("缺少 --file-path 或 --directory-path");
}

async function createFolder(args) {
  const resourceId = requireNumberArg(args, "resource-id");
  const payload = {
    resourceId,
    directoryPath: requireStringArg(args, "directory-path"),
    directoryName: requireStringArg(args, "directory-name"),
    directoryDescription: firstNonEmpty(pick(args, "directory-description")),
  };
  const url = await endpoint("/datasetController/createFolder");
  if (args["dry-run"]) {
    return { ok: true, action: "mkdir", dryRun: true, payload };
  }
  return { ok: true, action: "mkdir", created: sanitizeDirectoryResult(await requestJson("POST", url, compactObject(payload)), resourceId) };
}

async function renameFolder(args) {
  const resourceId = requireNumberArg(args, "resource-id");
  const payload = {
    resourceId,
    directoryPath: requireStringArg(args, "directory-path"),
    directoryName: requireStringArg(args, "directory-name"),
  };
  const url = await endpoint("/datasetController/renameFolder");
  if (args["dry-run"]) {
    return { ok: true, action: "rename-dir", dryRun: true, payload };
  }
  return { ok: true, action: "rename-dir", renamed: sanitizeDirectoryResult(await requestJson("POST", url, payload), resourceId) };
}

async function deleteFolder(args) {
  const payload = directoryPayload(args);
  const url = await endpoint("/datasetController/deleteFolder");
  if (args["dry-run"]) {
    return { ok: true, action: "delete-dir", dryRun: true, payload };
  }
  return { ok: true, action: "delete-dir", deleted: await requestJson("POST", url, payload) };
}

async function listDir(args) {
  const payload = directoryPayload(args);
  const url = await endpoint("/datasetController/queryDirAndFileByLevel");
  if (args["dry-run"]) {
    return { ok: true, action: "list", dryRun: true, payload, items: [] };
  }
  const raw = await requestJson("POST", url, payload);
  return { ok: true, action: "list", items: Array.isArray(raw) ? raw.map(sanitizeListItem) : [] };
}

function fileNamesFromArgs(args) {
  return asArray(args["file-name"]).map(String).filter(Boolean);
}

async function checkConflicts(args, fileNames = fileNamesFromArgs(args)) {
  if (!fileNames.length) {
    throw new Error("缺少 --file-name");
  }
  const payload = {
    ...directoryPayload(args),
    fileNames,
  };
  const url = await endpoint("/datasetController/checkUploadFileConflicts");
  if (args["dry-run"]) {
    return { ok: true, action: "check-conflicts", dryRun: true, payload, conflict: false, needsOverwriteConfirmation: false, overwritePaths: [] };
  }
  const raw = await requestJson("POST", url, payload);
  return {
    ok: true,
    action: "check-conflicts",
    conflict: Boolean(raw?.conflict),
    needsOverwriteConfirmation: Boolean(raw?.conflict),
    overwritePaths: asArray(raw?.overwritePaths),
  };
}

function localFiles(args) {
  const files = asArray(args["file-path"]).map(String);
  if (!files.length) {
    throw new Error("缺少 --file-path");
  }
  for (const filePath of files) {
    const resolvedPath = expandHome(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    const extension = path.extname(resolvedPath).toLowerCase();
    if (!SUPPORTED_UPLOAD_EXTENSIONS.has(extension)) {
      throw new Error(`不支持的文件类型: ${filePath}。仅支持 ${[...SUPPORTED_UPLOAD_EXTENSIONS].join(", ")}`);
    }
  }
  return files;
}

function boolArg(args, name, defaultValue) {
  const value = args[name];
  if (value === undefined) {
    return defaultValue;
  }
  if (value === true) {
    return true;
  }
  return !["false", "0", "no"].includes(String(value).toLowerCase());
}

async function uploadFiles(args, overwrite) {
  const resourceId = requireNumberArg(args, "resource-id");
  const directoryPath = requireStringArg(args, "directory-path");
  const files = localFiles(args);
  const url = await endpoint("/datasetController/uploadFiles");
  if (args["dry-run"]) {
    return {
      dryRun: true,
      resourceId,
      directoryPath,
      files,
      overwrite,
      processFrontMatter: boolArg(args, "process-front-matter", true),
    };
  }
  const formData = new FormData();
  for (const filePath of files) {
    const resolved = expandHome(filePath);
    formData.append("files", new Blob([fs.readFileSync(resolved)]), path.basename(resolved));
  }
  formData.append("resourceId", String(resourceId));
  formData.append("directoryPath", directoryPath);
  const fileDescription = firstNonEmpty(pick(args, "file-description"));
  if (fileDescription) {
    formData.append("fileDescription", fileDescription);
  }
  formData.append("processFrontMatter", String(boolArg(args, "process-front-matter", true)));
  formData.append("overwrite", String(Boolean(overwrite)));
  const uploaded = await requestMultipart(url, formData);
  return { resourceId, directoryPath, uploaded: sanitizeUploadResult(uploaded, resourceId) };
}

function buildPathFromUploadItem(item) {
  return firstNonEmpty(item?.filePath, item?.path, item?.fileUrl);
}

async function buildUploadedItems(resourceId, uploaded) {
  const uploadItems = asArray(uploaded?.uploadItems ?? uploaded?.items);
  if (!uploadItems.length) {
    throw new Error("上传成功但未返回 uploadItems，无法触发构建");
  }
  const buildUrl = await endpoint("/datasetController/build");
  const builds = [];
  for (const item of uploadItems) {
    const filePath = buildPathFromUploadItem(item);
    if (!filePath) {
      throw new Error(`uploadItems 中的文件缺少 filePath/path/fileUrl: ${firstNonEmpty(item?.fileName, item?.name, "(unknown)")}`);
    }
    const built = await requestJson("POST", buildUrl, { resourceId, directoryPath: filePath });
    builds.push({ filePath, built });
  }
  return { builds };
}

async function uploadCommand(args) {
  if (args["check-conflicts"]) {
    const names = localFiles(args).map((item) => path.basename(item));
    const conflict = await checkConflicts(args, names);
    if (conflict.conflict) {
      return { ...conflict, action: "upload", needsOverwriteConfirmation: true };
    }
  }
  const uploaded = await uploadFiles(args, false);
  if (uploaded.dryRun) {
    return { ok: true, action: "upload", ...uploaded };
  }
  const built = await buildUploadedItems(uploaded.resourceId, uploaded.uploaded);
  return { ok: true, action: "upload", uploaded: uploaded.uploaded, builds: built.builds };
}

async function updateFileCommand(args) {
  let conflict;
  if (!args["skip-conflict-check"]) {
    const names = localFiles(args).map((item) => path.basename(item));
    conflict = await checkConflicts(args, names);
  }
  const uploaded = await uploadFiles(args, true);
  if (uploaded.dryRun) {
    return { ok: true, action: "update-file", conflict, ...uploaded };
  }
  const built = await buildUploadedItems(uploaded.resourceId, uploaded.uploaded);
  return { ok: true, action: "update-file", conflict, uploaded: uploaded.uploaded, builds: built.builds };
}

async function buildCommand(args) {
  const payload = filePayload(args);
  const url = await endpoint("/datasetController/build");
  if (args["dry-run"]) {
    return { ok: true, action: "build", dryRun: true, payload };
  }
  return { ok: true, action: "build", built: await requestJson("POST", url, payload) };
}

async function buildStatusCommand(args) {
  const resourceId = requireNumberArg(args, "resource-id");
  const directoryPath = requireStringArg(args, "file-path");
  const url = new URL(await endpoint("/datasetController/fileBuildStatus"));
  url.searchParams.set("resourceId", String(resourceId));
  url.searchParams.set("directoryPath", directoryPath);
  if (args["dry-run"]) {
    return { ok: true, action: "build-status", dryRun: true, resourceId, directoryPath };
  }
  return { ok: true, action: "build-status", status: await requestJson("GET", url.toString()) };
}

async function downloadCommand(args) {
  const resourceId = requireNumberArg(args, "resource-id");
  const target = downloadTargetPath(args);
  const output = requireStringArg(args, "output");
  const url = new URL(await endpoint("/datasetController/download"));
  url.searchParams.set("resourceId", String(resourceId));
  url.searchParams.set("directoryPath", target.path);
  if (args["dry-run"]) {
    return { ok: true, action: "download", dryRun: true, resourceId, targetType: target.type, path: target.path, output };
  }
  return { ok: true, action: "download", targetType: target.type, ...(await requestDownload(url.toString(), output)) };
}

async function readFileCommand(args) {
  const resourceId = requireNumberArg(args, "resource-id");
  const payload = compactObject({
    resourceId,
    filePath: requireStringArg(args, "file-path"),
    startLine: optionalNumberArg(args, "start-line"),
    endLine: optionalNumberArg(args, "end-line"),
  });
  const url = await endpoint("/datasetController/readFile");
  return { ok: true, action: "read-file", file: sanitizeReadFileResult(await requestJson("POST", url, payload), resourceId) };
}

function resourceIdsFromArgs(args) {
  const ids = asArray(args["resource-id"]).map((item) => toNumber(item)).filter(Boolean);
  if (!ids.length) {
    throw new Error("缺少 --resource-id");
  }
  return ids;
}

async function searchCommand(args) {
  const resourceIds = resourceIdsFromArgs(args);
  const query = requireStringArg(args, "query");
  const topK = optionalNumberArg(args, "top-k") || 5;
  const payload = {
    resourceIdList: resourceIds,
    query,
    topK,
    searchMode: "mixedRecall",
  };
  const url = await endpoint("/datasetController/knowledgeItems/search");
  const raw = await requestJson("POST", url, payload);
  const items = asArray(raw?.data).map(sanitizeSearchItem);
  return { ok: true, action: "search", resourceIds, query, topK, items };
}

async function removeFileCommand(args) {
  const payload = filePayload(args);
  const url = await endpoint("/datasetController/removeFile");
  if (args["dry-run"]) {
    return { ok: true, action: "remove-file", dryRun: true, payload };
  }
  return { ok: true, action: "remove-file", removed: await requestJson("POST", url, payload) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";
  let result;
  if (command === "help" || args.help) {
    result = helpManual();
  } else if (command === "mkdir") {
    result = await createFolder(args);
  } else if (command === "rename-dir") {
    result = await renameFolder(args);
  } else if (command === "delete-dir") {
    result = await deleteFolder(args);
  } else if (command === "list") {
    result = await listDir(args);
  } else if (command === "check-conflicts") {
    result = await checkConflicts(args);
  } else if (command === "upload") {
    result = await uploadCommand(args);
  } else if (command === "update-file") {
    result = await updateFileCommand(args);
  } else if (command === "build") {
    result = await buildCommand(args);
  } else if (command === "build-status") {
    result = await buildStatusCommand(args);
  } else if (command === "download") {
    result = await downloadCommand(args);
  } else if (command === "read-file") {
    result = await readFileCommand(args);
  } else if (command === "search") {
    result = await searchCommand(args);
  } else if (command === "remove-file") {
    result = await removeFileCommand(args);
  } else {
    throw new Error(`未知命令: ${command}`);
  }
  render(result);
}

main()
  .then(() => closeDiscovery())
  .catch(async (error) => {
    await closeDiscovery().catch(() => {});
    render({
      ok: false,
      error: error.message,
    });
    process.exitCode = 1;
  });
