#!/usr/bin/env node

import crypto from "node:crypto";

const DEFAULT_CONTEXT_PATH = "/byaiService";
const DEFAULT_SIGNATURE_SALT = "{#@*A12^c0+}";
const PROJECT_CONTEXT_PATH = "open/api/v1/projectContext";
const REQUEST_TIMEOUT_MS = 30_000;

const COMMAND_SECTIONS = {
  current: undefined,
  basic: ["basic"],
  repos: ["repositories"],
  resources: ["knowledge", "ontologies"],
  members: ["members"],
  files: ["sharedFiles"],
};

class PublicFailure extends Error {
  constructor(errorCode, detail = "") {
    super(detail ? `${errorCode}: ${detail}` : errorCode);
    this.errorCode = errorCode;
    this.detail = detail;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = value === undefined || value === null ? "" : String(value).trim();
    if (text) return text;
  }
  return "";
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const eqIndex = token.indexOf("=");
    const key = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2);
    let value = eqIndex >= 0 ? token.slice(eqIndex + 1) : argv[index + 1];
    if (value === undefined || String(value).startsWith("--")) {
      value = true;
    } else if (eqIndex < 0) {
      index += 1;
    }
    args[key] = value;
  }
  return args;
}

function positiveInteger(value, field, maximum) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new PublicFailure("PROJECT_CONTEXT_INPUT_INVALID", field);
  }
  return Math.min(parsed, maximum);
}

function normalizeBaseUrl(rawBaseUrl) {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith(DEFAULT_CONTEXT_PATH) ? trimmed : `${trimmed}${DEFAULT_CONTEXT_PATH}`;
}

function backendBaseUrl() {
  const explicit = firstNonEmpty(process.env.BYAI_SERVICE_BASE_URL, process.env.KN_MANAGER_URL);
  if (explicit) return normalizeBaseUrl(explicit);
  const host = firstNonEmpty(process.env.HOST, "127.0.0.1");
  if (/^https?:\/\//i.test(host)) return normalizeBaseUrl(host);
  const protocol = firstNonEmpty(process.env.BE_PROTOCOL, "http");
  const port = firstNonEmpty(process.env.BE_SERVER_PORT, "8086");
  const portPart = /:\d+$/.test(host) ? "" : `:${port}`;
  return normalizeBaseUrl(`${protocol}://${host}${portPart}`);
}

function resolveAuth() {
  return {
    beyondToken: firstNonEmpty(
      process.env.BEYOND_TOKEN,
      process.env.BYCLAW_BEYOND_TOKEN,
      process.env.BYCLAW_ECOSYSTEM_BEYOND_TOKEN,
    ),
    userCode: firstNonEmpty(process.env.USER_CODE, process.env.BYCLAW_ECOSYSTEM_USER_CODE),
    sessionId: firstNonEmpty(
      process.env.BAIYING_SESSION,
      process.env.SESSION_ID,
      process.env.BYCLAW_SESSION,
      process.env.BYCLAW_ECOSYSTEM_SESSION,
    ),
  };
}

function signatureHeaders(userCode, bodyText) {
  if (!userCode) return {};
  const nonce = crypto.randomUUID();
  const timestamp = Date.now().toString();
  const salt = firstNonEmpty(
    process.env.BYCLAW_ECOSYSTEM_SIGNATURE_SALT,
    process.env.BYCLAW_SIGNATURE_SALT,
    DEFAULT_SIGNATURE_SALT,
  );
  const signature = crypto
    .createHash("md5")
    .update(`${userCode}${nonce}${timestamp}${bodyText}${salt}`, "utf8")
    .digest("hex");
  return { "x-signature-nonce": nonce, "x-signature-timestamp": timestamp, "x-signature-value": signature };
}

async function postJson(payload) {
  const auth = resolveAuth();
  if (!auth.beyondToken && !auth.sessionId) {
    throw new PublicFailure("PROJECT_CONTEXT_AUTH_CONTEXT_UNAVAILABLE");
  }
  const bodyText = JSON.stringify(payload);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...signatureHeaders(auth.userCode, bodyText),
  };
  if (auth.beyondToken) headers["Beyond-Token"] = auth.beyondToken;
  if (auth.userCode) headers["X-User-Id"] = auth.userCode;
  if (auth.sessionId) {
    headers["x-signature-sessionId"] = auth.sessionId;
    headers.Cookie = `SESSION=${auth.sessionId}; PORTAL-SESSION=${auth.sessionId}`;
  }

  let response;
  try {
    response = await fetch(`${backendBaseUrl()}/${PROJECT_CONTEXT_PATH}`, {
      method: "POST",
      headers,
      body: bodyText,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new PublicFailure("PROJECT_CONTEXT_BACKEND_TIMEOUT");
    }
    throw new PublicFailure("PROJECT_CONTEXT_BACKEND_UNREACHABLE");
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new PublicFailure("PROJECT_CONTEXT_RESPONSE_INVALID");
  }
  if (response.status === 401) {
    throw new PublicFailure("PROJECT_CONTEXT_AUTH_REJECTED", body?.resultMsg || "HTTP 401");
  }
  if (!response.ok) {
    throw new PublicFailure("PROJECT_CONTEXT_BACKEND_HTTP_ERROR", body?.msg || `HTTP ${response.status}`);
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "code") && ![0, 200, "0", "200"].includes(body.code)) {
    const detail = body.msg || `code=${body.code}`;
    if (/无权|permission|access denied/i.test(detail)) {
      throw new PublicFailure("PROJECT_CONTEXT_ACCESS_DENIED", detail);
    }
    if (/未绑定项目|not bound/i.test(detail)) {
      throw new PublicFailure("PROJECT_CONTEXT_SESSION_UNBOUND", detail);
    }
    throw new PublicFailure("PROJECT_CONTEXT_BACKEND_REJECTED", detail);
  }
  return body && Object.prototype.hasOwnProperty.call(body, "data") ? body.data : body;
}

function help() {
  return {
    ok: true,
    commands: Object.keys(COMMAND_SECTIONS),
    usage: "project-context.mjs <current|basic|repos|resources|members|files> (--project-id <id> | --session-id <id>) [--size 1..100]",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";
  if (command === "help" || args.help === true) return help();
  if (!Object.prototype.hasOwnProperty.call(COMMAND_SECTIONS, command)) {
    throw new PublicFailure("PROJECT_CONTEXT_COMMAND_INVALID", command);
  }
  const projectId = positiveInteger(args["project-id"], "project-id", Number.MAX_SAFE_INTEGER);
  const sessionId = positiveInteger(args["session-id"], "session-id", Number.MAX_SAFE_INTEGER);
  if (!projectId && !sessionId) throw new PublicFailure("PROJECT_CONTEXT_ID_MISSING");
  const pageSize = positiveInteger(args.size, "size", 100);
  const sections = COMMAND_SECTIONS[command];
  const payload = {
    ...(projectId ? { projectId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sections ? { sections } : {}),
    ...(pageSize ? { pageSize } : {}),
  };
  const data = await postJson(payload);
  return { ok: true, ...data };
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const failure = error instanceof PublicFailure
    ? error
    : new PublicFailure("PROJECT_CONTEXT_FAILED", error instanceof Error ? error.message : String(error));
  process.stdout.write(`${JSON.stringify({ ok: false, errorCode: failure.errorCode, detail: failure.detail })}\n`);
  process.exitCode = 1;
}
