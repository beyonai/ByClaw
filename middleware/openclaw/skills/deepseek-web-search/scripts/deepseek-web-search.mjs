#!/usr/bin/env node

import crypto from "node:crypto";

const DEFAULT_CONTEXT_PATH = "/byaiService";
const DEFAULT_SIGNATURE_SALT = "{#@*A12^c0+}";
const REQUEST_TIMEOUT_MS = 120_000;

class PublicFailure extends Error {
  constructor(errorCode, detail = "") {
    super(errorCode);
    this.errorCode = errorCode;
    this.detail = detail;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = value == null ? "" : String(value).trim();
    if (text) return text;
  }
  return "";
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new PublicFailure("DEEPSEEK_WEB_SEARCH_INPUT_INVALID", token);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new PublicFailure("DEEPSEEK_WEB_SEARCH_INPUT_INVALID", key);
    if (key === "query") {
      args.query ??= [];
      args.query.push(value);
    } else {
      args[key] = value;
    }
    index += 1;
  }
  return args;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const queries = [...new Set((args.query ?? []).map(value => firstNonEmpty(value)).filter(Boolean))];
  if (queries.length < 1 || queries.length > 4 || queries.some(query => query.length > 2000)) {
    throw new PublicFailure("DEEPSEEK_WEB_SEARCH_INPUT_INVALID", "queries");
  }
  const parsedMax = args["max-results"] == null ? 10 : Number(args["max-results"]);
  if (!Number.isSafeInteger(parsedMax) || parsedMax < 1 || parsedMax > 20) {
    throw new PublicFailure("DEEPSEEK_WEB_SEARCH_INPUT_INVALID", "max-results");
  }
  const auth = resolveAuth();
  if (!auth.beyondToken && !auth.sessionId) {
    throw new PublicFailure("DEEPSEEK_WEB_SEARCH_AUTH_CONTEXT_UNAVAILABLE");
  }
  const bodyText = JSON.stringify({ queries, maxResults: parsedMax });
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
    response = await fetch(`${backendBaseUrl()}/connector/runtime/deepseek-web-search/search`, {
      method: "POST",
      headers,
      body: bodyText,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new PublicFailure("DEEPSEEK_WEB_SEARCH_BACKEND_TIMEOUT");
    }
    throw new PublicFailure("DEEPSEEK_WEB_SEARCH_BACKEND_UNREACHABLE");
  }
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new PublicFailure("DEEPSEEK_WEB_SEARCH_RESPONSE_INVALID");
  }
  if (!response.ok || (body && ![0, 200, "0", "200"].includes(body.code))) {
    const detail = body?.msg || `HTTP ${response.status}`;
    if (/CONNECTOR_NOT_AUTHORIZED/i.test(detail)) {
      throw new PublicFailure("DEEPSEEK_WEB_SEARCH_CONNECTOR_NOT_AUTHORIZED");
    }
    if (/CONNECTOR_NOT_ENABLED|disabled|未启用/i.test(detail)) {
      throw new PublicFailure("DEEPSEEK_WEB_SEARCH_CONNECTOR_DISABLED");
    }
    if (response.status === 401 || response.status === 403) {
      throw new PublicFailure("DEEPSEEK_WEB_SEARCH_AUTH_REJECTED");
    }
    throw new PublicFailure("DEEPSEEK_WEB_SEARCH_BACKEND_REJECTED", detail);
  }
  return body?.data ?? body;
}

try {
  process.stdout.write(`${JSON.stringify(await main())}\n`);
} catch (error) {
  const failure = error instanceof PublicFailure
    ? error
    : new PublicFailure("DEEPSEEK_WEB_SEARCH_FAILED", error instanceof Error ? error.message : String(error));
  process.stdout.write(`${JSON.stringify({ ok: false, errorCode: failure.errorCode, detail: failure.detail })}\n`);
  process.exitCode = 1;
}
