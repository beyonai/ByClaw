#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { initRedis, getRedis, closeRedis, DiscoveryClient, RegistryKeys } from "@byclaw/by-framework";

const DEFAULT_CONTEXT_PATH = "/byaiService";
const DEFAULT_SIGNATURE_SALT = "{#@*A12^c0+}";
const DEFAULT_BACKEND_SERVICE_NAME = "ByaiService";
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"]);

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

function asArray(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
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
    Accept: "application/json, text/plain, */*",
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

function render(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * The fileToMarkdown endpoint streams the converted markdown back as the response
 * body (curl `-o` writes it directly to a .md file). It may also arrive wrapped in
 * the standard { code, msg, data } envelope. Detect both: if the body is JSON with a
 * `code` field, honor it and extract `data`; otherwise treat the raw text as markdown.
 */
async function fetchMarkdown(url, formData) {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders("", null),
    body: formData,
  });
  const text = await response.text();
  let body;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  if (body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "code")) {
    const okCodes = [0, 200, "0", "200"];
    if (!okCodes.includes(body.code)) {
      throw new Error(body.msg || body.message || `接口返回异常 code=${body.code}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "success") && body.success === false) {
      throw new Error(body.msg || body.message || "接口返回失败 success=false");
    }
    const data = body.data;
    if (typeof data === "string") {
      return data;
    }
    if (data && typeof data === "object") {
      return firstNonEmpty(data.markdown, data.content, data.text, data.data, data.markdownContent) || "";
    }
    return data == null ? "" : String(data);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}: ${text || response.statusText || "转换失败"}`);
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "success") && body.success === false) {
    throw new Error(body.msg || body.message || "接口返回失败 success=false");
  }
  return text;
}

function requireStringArg(args, name) {
  const value = firstNonEmpty(pick(args, name));
  if (!value) {
    throw new Error(`缺少 --${name}`);
  }
  return value;
}

function validateInputFiles(files) {
  if (!files.length) {
    throw new Error("缺少 --file-path");
  }
  for (const filePath of files) {
    const resolvedPath = expandHome(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`不是文件: ${filePath}`);
    }
    const extension = path.extname(resolvedPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error(`不支持的文件类型: ${filePath}。仅支持 ${[...SUPPORTED_EXTENSIONS].join(", ")}`);
    }
  }
  return files;
}

function resolveOutputPath(inputFile, args) {
  const explicitOutput = firstNonEmpty(pick(args, "output"));
  const outputDir = firstNonEmpty(pick(args, "output-dir"));
  const resolvedInput = expandHome(inputFile);
  const baseName = path.basename(resolvedInput, path.extname(resolvedInput));
  if (outputDir) {
    return path.join(expandHome(outputDir), `${baseName}.md`);
  }
  if (explicitOutput) {
    return expandHome(explicitOutput);
  }
  return path.join(path.dirname(resolvedInput), `${baseName}.md`);
}

async function convertCommand(args) {
  const inputFiles = validateInputFiles(asArray(args["file-path"]).map(String));
  const explicitOutput = firstNonEmpty(pick(args, "output"));
  if (explicitOutput && inputFiles.length > 1) {
    throw new Error("多文件转换时请使用 --output-dir 而不是 --output");
  }
  const url = await endpoint("/datasetController/fileToMarkdown");
  if (args["dry-run"]) {
    return {
      ok: true,
      action: "convert",
      dryRun: true,
      url,
      files: inputFiles.map((filePath) => ({
        input: filePath,
        output: resolveOutputPath(filePath, args),
      })),
    };
  }
  const results = [];
  for (const filePath of inputFiles) {
    const resolved = expandHome(filePath);
    const formData = new FormData();
    formData.append("fileContent", new Blob([fs.readFileSync(resolved)]), path.basename(resolved));
    const markdown = await fetchMarkdown(url, formData);
    const outputPath = resolveOutputPath(filePath, args);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, markdown, "utf8");
    results.push({
      input: filePath,
      output: outputPath,
      bytes: Buffer.byteLength(markdown, "utf8"),
      chars: markdown.length,
    });
  }
  return { ok: true, action: "convert", results };
}

function helpManual() {
  return {
    ok: true,
    name: "by-doc-to-markdown",
    description: "文档转 Markdown CLI：将 pdf/doc(x)/xls(x)/ppt(x) 文档转换为 Markdown。",
    usage: "node ./scripts/by-doc-to-markdown.mjs <command> [options]",
    commands: {
      convert: {
        description: "将文档转换为 Markdown 并写入本地文件",
        required: ["--file-path"],
        optional: ["可重复传 --file-path", "--output（单文件时指定输出路径）", "--output-dir（多文件时指定输出目录）", "--dry-run", "仅支持 .pdf/.doc/.docx/.xls/.xlsx/.ppt/.pptx"],
        example: "convert --file-path /tmp/AOCI.pdf --output /tmp/AOCI.md",
      },
      help: {
        description: "查看命令帮助",
        required: [],
        optional: [],
        example: "help",
      },
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";
  let result;
  if (command === "help" || args.help) {
    result = helpManual();
  } else if (command === "convert") {
    result = await convertCommand(args);
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