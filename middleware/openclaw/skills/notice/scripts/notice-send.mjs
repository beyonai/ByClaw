#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

// 站内信发送与项目成员查询。凭据、服务地址、请求头全部在脚本内部解析，
// 调用方（agent）只给业务参数，拿不到也不需要 token / URL / header。
const DEFAULT_CONTEXT_PATH = "/byaiService";
const DEFAULT_SIGNATURE_SALT = "{#@*A12^c0+}";
const NOTICE_PATH = "open/api/notice/create";
const MEMBER_PATH = "open/api/v1/listProjectMembers";
// 后端 Notices DTO 的 @Size(max = 100)，超出会整批 400，所以在客户端分批。
const NOTICE_BATCH_SIZE = 100;
const TITLE_MAX = 200;
const CONTENT_MAX = 2000;
const REQUEST_TIMEOUT_MS = 30_000;

// requirement 优先级 → ByaiNotification.priority（1低/2中/3高/4紧急）。
// 4 留给人工升级，自动化链路不产出。
const PRIORITY_MAP = { low: 1, medium: 2, high: 3 };

class PublicFailure extends Error {
  constructor(errorCode, detail) {
    super(detail ? `${errorCode}: ${detail}` : errorCode);
    this.errorCode = errorCode;
    this.detail = detail || "";
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
    const key = eqIndex > -1 ? token.slice(2, eqIndex) : token.slice(2);
    let value = eqIndex > -1 ? token.slice(eqIndex + 1) : argv[index + 1];
    if (value === undefined || String(value).startsWith("--")) {
      value = true;
    } else if (eqIndex === -1) {
      index += 1;
    }
    args[key] = value;
  }
  return args;
}

function normalizeBaseUrl(rawBaseUrl) {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith(DEFAULT_CONTEXT_PATH) ? trimmed : `${trimmed}${DEFAULT_CONTEXT_PATH}`;
}

// 服务发现与 by-knowledge-manager 一致，但不引 @byclaw/by-framework：
// 本技能只打两个固定接口，用环境变量组装即可，免掉 npm install 这一步。
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
      process.env.BYCLAW_ECOSYSTEM_BEYOND_TOKEN
    ),
    userCode: firstNonEmpty(process.env.USER_CODE, process.env.BYCLAW_ECOSYSTEM_USER_CODE),
    sessionId: firstNonEmpty(process.env.BAIYING_SESSION, process.env.SESSION_ID, process.env.BYCLAW_SESSION),
  };
}

// 网关按 userCode + nonce + timestamp + body + salt 的 md5 校验，缺 userCode 时跳过签名头。
function signatureHeaders(userCode, bodyText) {
  if (!userCode) return {};
  const nonce = crypto.randomUUID();
  const timestamp = Date.now().toString();
  const salt = firstNonEmpty(
    process.env.BYCLAW_ECOSYSTEM_SIGNATURE_SALT,
    process.env.BYCLAW_SIGNATURE_SALT,
    DEFAULT_SIGNATURE_SALT
  );
  const signature = crypto
    .createHash("md5")
    .update(`${userCode}${nonce}${timestamp}${bodyText || ""}${salt}`, "utf8")
    .digest("hex");
  return { "x-signature-nonce": nonce, "x-signature-timestamp": timestamp, "x-signature-value": signature };
}

async function postJson(pathname, payload) {
  const auth = resolveAuth();
  const bodyText = JSON.stringify(payload);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...signatureHeaders(auth.userCode, bodyText),
  };
  if (auth.beyondToken) headers["Beyond-Token"] = auth.beyondToken;
  if (auth.userCode) headers["X-User-Id"] = auth.userCode;
  if (auth.sessionId) headers["x-signature-sessionId"] = auth.sessionId;

  const url = `${backendBaseUrl()}/${pathname}`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: bodyText,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new PublicFailure("NOTICE_BACKEND_TIMEOUT");
    }
    throw new PublicFailure("NOTICE_BACKEND_UNREACHABLE");
  }
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new PublicFailure("NOTICE_RESPONSE_INVALID");
  }
  if (!response.ok) {
    throw new PublicFailure("NOTICE_BACKEND_HTTP_ERROR", body?.msg || `HTTP ${response.status}`);
  }
  // ResponseUtil：code 0 成功，-1 失败；msg 可直接透出，不含凭据。
  if (body && Object.prototype.hasOwnProperty.call(body, "code") && ![0, 200, "0", "200"].includes(body.code)) {
    throw new PublicFailure("NOTICE_BACKEND_REJECTED", body.msg || `code=${body.code}`);
  }
  return body && Object.prototype.hasOwnProperty.call(body, "data") ? body.data : body;
}

async function readPayload(args) {
  if (args.input && args.input !== true) {
    let text;
    try {
      text = fs.readFileSync(String(args.input), "utf8");
    } catch {
      throw new PublicFailure("NOTICE_INPUT_UNREADABLE");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new PublicFailure("NOTICE_INPUT_NOT_JSON");
    }
  }
  // 无 --input 时从 stdin 读，便于上游直接管道喂 JSON。
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) throw new PublicFailure("NOTICE_INPUT_MISSING");
  try {
    return JSON.parse(text);
  } catch {
    throw new PublicFailure("NOTICE_INPUT_NOT_JSON");
  }
}

function normalizePriority(raw) {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 4) return raw;
  const key = String(raw || "").trim().toLowerCase();
  return PRIORITY_MAP[key] || PRIORITY_MAP.medium;
}

// 后端 @Size 超限会整批 400，宁可截断也不让整批失败；截断在末尾留标记便于排查。
function clamp(text, max, field) {
  const value = String(text ?? "").trim();
  if (!value) throw new PublicFailure("NOTICE_FIELD_EMPTY", field);
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function buildNoticeDetails(items, defaults) {
  const senderId = defaults.senderId;
  const sendUserCode = defaults.sendUserCode;
  // sender 与 target 两侧后端都会解析，缺任一侧整条报 openapi.*.user.not.found。
  if (!senderId && !sendUserCode) throw new PublicFailure("NOTICE_SENDER_UNRESOLVED");
  return items.map((item, index) => {
    const targetId = firstNonEmpty(item.targetId, item.userId);
    const targetUserCode = firstNonEmpty(item.targetUserCode, item.userCode);
    if (!targetId && !targetUserCode) throw new PublicFailure("NOTICE_TARGET_UNRESOLVED", `#${index}`);
    const detail = {
      title: clamp(item.title ?? defaults.title, TITLE_MAX, "title"),
      content: clamp(item.content ?? defaults.content, CONTENT_MAX, "content"),
      priority: normalizePriority(item.priority ?? defaults.priority),
    };
    if (senderId) detail.senderId = Number(senderId);
    else detail.sendUserCode = sendUserCode;
    if (targetId) detail.targetId = Number(targetId);
    else detail.targetUserCode = targetUserCode;
    return detail;
  });
}

async function sendCommand(args) {
  const payload = await readPayload(args);
  const rawItems = Array.isArray(payload) ? payload : payload?.notices;
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new PublicFailure("NOTICE_ITEMS_EMPTY");
  const auth = resolveAuth();
  const defaults = {
    title: payload?.title,
    content: payload?.content,
    priority: payload?.priority,
    senderId: firstNonEmpty(payload?.senderId, process.env.NOTICE_SENDER_ID),
    // 发信人默认取运行身份的 userCode，避免调用方需要知道任何账号信息。
    sendUserCode: firstNonEmpty(payload?.sendUserCode, auth.userCode),
  };
  const details = buildNoticeDetails(rawItems, defaults);

  const batches = [];
  for (let index = 0; index < details.length; index += NOTICE_BATCH_SIZE) {
    batches.push(details.slice(index, index + NOTICE_BATCH_SIZE));
  }
  let sent = 0;
  const failures = [];
  for (const [batchIndex, batch] of batches.entries()) {
    try {
      await postJson(NOTICE_PATH, { noticeDetails: batch });
      sent += batch.length;
    } catch (error) {
      const failure = error instanceof PublicFailure ? error : new PublicFailure("NOTICE_SEND_FAILED");
      failures.push({ batch: batchIndex, count: batch.length, errorCode: failure.errorCode, detail: failure.detail });
    }
  }
  return {
    ok: failures.length === 0,
    requested: details.length,
    sent,
    batches: batches.length,
    failures,
  };
}

async function membersCommand(args) {
  const projectId = firstNonEmpty(args["project-id"], args.projectId);
  if (!projectId) throw new PublicFailure("NOTICE_PROJECT_ID_MISSING");
  const userName = firstNonEmpty(args["user-name"], args.userName);
  const data = await postJson(MEMBER_PATH, {
    projectId: Number(projectId),
    userName: userName || undefined,
  });
  const rows = Array.isArray(data) ? data : [];
  // 只回传通知需要的字段：userId/userCode 用于站内信寻址，userName 用于连接器按名字匹配。
  const members = rows
    .filter((row) => row && (row.userId || row.userCode))
    .map((row) => ({
      userId: row.userId ?? null,
      userCode: row.userCode ?? null,
      userName: row.userName ?? null,
      role: row.role ?? null,
      agentName: row.agentName ?? null,
    }));
  return { ok: true, projectId: Number(projectId), total: members.length, members };
}

function helpText() {
  return {
    ok: true,
    commands: {
      send: "node scripts/notice-send.mjs send [--input <payload.json>]  # 无 --input 时读 stdin",
      members: "node scripts/notice-send.mjs members --project-id <projectId> [--user-name <名字>]",
    },
    sendPayload: {
      title: "批次默认标题，单条可覆盖（<=200）",
      content: "批次默认正文，单条可覆盖（<=2000）",
      priority: "low|medium|high 或 1-4，默认 medium",
      notices: [{ userId: 10000022, userCode: "zhangsan", title: "可选", content: "可选", priority: "high" }],
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "help";
  const args = parseArgs(argv.slice(command === "help" ? 0 : 1));
  if (command === "help") return helpText();
  if (command === "send") return sendCommand(args);
  if (command === "members") return membersCommand(args);
  throw new PublicFailure("NOTICE_UNKNOWN_COMMAND", command);
}

main()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result?.ok === false ? 1 : 0;
  })
  .catch((error) => {
    const failure = error instanceof PublicFailure ? error : new PublicFailure("NOTICE_FAILED", error?.message);
    process.stdout.write(`${JSON.stringify({ ok: false, errorCode: failure.errorCode, detail: failure.detail })}\n`);
    process.exitCode = 1;
  });
