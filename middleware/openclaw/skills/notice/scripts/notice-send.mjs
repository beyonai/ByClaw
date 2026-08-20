#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

// 站内信发送与项目成员查询。凭据、服务地址、请求头全部在脚本内部解析，
// 调用方（agent）只给业务参数，拿不到也不需要 token / URL / header。
const DEFAULT_CONTEXT_PATH = "/byaiService";
const DEFAULT_SIGNATURE_SALT = "{#@*A12^c0+}";
const NOTICE_PATH = "open/api/notice/create";
const MEMBER_PATH = "open/api/v1/listProjectMembers";
const PROJECT_PATH = "open/api/v1/selectProjectsByQo";
const RESOLVE_PROJECT_PATH = "open/api/v1/resolveProjectBySession";
const DINGTALK_SEND_PATH = "open/api/v1/dingtalk/sendUserToUser";
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
  const beyondToken = firstNonEmpty(
    process.env.BEYOND_TOKEN,
    process.env.BYCLAW_BEYOND_TOKEN,
    process.env.BYCLAW_ECOSYSTEM_BEYOND_TOKEN
  );
  const userCode = firstNonEmpty(process.env.USER_CODE, process.env.BYCLAW_ECOSYSTEM_USER_CODE);
  const sessionId = firstNonEmpty(
    process.env.BAIYING_SESSION,
    process.env.SESSION_ID,
    process.env.BYCLAW_SESSION,
    process.env.BYCLAW_ECOSYSTEM_SESSION
  );

  // 从 BEYOND_TOKEN 解析 userId（JWT payload 的 userId 字段）
  let userId = undefined;
  if (beyondToken) {
    try {
      const parts = beyondToken.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
        userId = payload.userId || payload.uid || payload.sub;
      }
    } catch (error) {
      // JWT 解析失败不影响站内信发送，只影响钉钉侧
    }
  }

  return { beyondToken, userCode, sessionId, userId };
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
  // 两条凭据都空就别发了：后端会回 401，和「token 过期」长得一模一样，
  // 调用方只能猜。这里提前判死，让「运行时没给凭据」有自己的错误码。
  if (!auth.beyondToken && !auth.sessionId) {
    throw new PublicFailure("NOTICE_AUTH_CONTEXT_UNAVAILABLE");
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
    // 拦截器先看 HttpSession 再看 beyond-token（AccessTokenVerifyInterceptor#preHandle）。
    // session 存 Redis 共享，所以定时任务里 env 的 token 快照过期后，这条 cookie 仍能过。
    headers.Cookie = `SESSION=${auth.sessionId}; PORTAL-SESSION=${auth.sessionId}`;
  }

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
    // 401 体是 {resultCode,resultMsg}（setLoginError），不是 ResponseUtil 的 {code,msg}。
    // resultMsg 区分「未登录」和「token 过期」，不含凭据，直接透出给人排障。
    if (response.status === 401) {
      throw new PublicFailure("NOTICE_AUTH_REJECTED", body?.resultMsg || "HTTP 401");
    }
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

  // 站内通知发送完成后，尝试发送钉钉消息（可选,失败不影响主流程）
  // 逐人记账：一个人失败不能把整批计成 0，否则回执无法区分"全失败"和"部分失败"
  const dingtalkFailures = [];
  let dingtalkSent = 0;
  if (payload?.sendDingtalk === true && auth.userId) {
    const dingtalkBody = payload?.dingtalkBody || payload?.content || defaults.content;
    for (const detail of details) {
      if (!detail.targetId) continue; // 钉钉发送需要 targetId
      const result = await sendDingtalkMessage(auth.userId, detail.targetId, dingtalkBody);
      if (result.ok) {
        dingtalkSent += 1;
      }
      else {
        dingtalkFailures.push({ targetId: detail.targetId, error: result.message });
      }
    }
  }

  return {
    ok: failures.length === 0,
    requested: details.length,
    sent,
    batches: batches.length,
    failures,
    dingtalkSent,
    dingtalkFailures: dingtalkFailures.length > 0 ? dingtalkFailures : undefined,
  };
}

/**
 * 尝试通过钉钉发送消息(可选,失败不影响站内通知)。
 * @param {number} senderUserId - 发送人(执行 skill 的用户)
 * @param {number} receiverUserId - 接收人
 * @param {string} content - 消息内容(Markdown)
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
async function sendDingtalkMessage(senderUserId, receiverUserId, content) {
  try {
    const response = await postJson(DINGTALK_SEND_PATH, {
      senderUserId,
      receiverUserId,
      content,
    });
    return { ok: true };
  } catch (error) {
    const message = error?.message || String(error);
    return { ok: false, message };
  }
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
  // 手机号默认不回传：它只用于外部连接器精确匹配联系人，默认带上会让号码进入
  // 日常输出和留档，属于无意义的个人信息外泄。调用方确有需要时显式 --with-phone。
  // 工号不同：同样能精确匹配，但不是敏感个人信息，所以默认带上，让调用方优先用它。
  const withPhone = args["with-phone"] === true || firstNonEmpty(args["with-phone"]) === "true";
  // 只回传通知需要的字段：userId/userCode 用于站内信寻址，userNumber/userName 用于连接器匹配。
  const members = rows
    .filter((row) => row && (row.userId || row.userCode))
    .map((row) => {
      const member = {
        userId: row.userId ?? null,
        userCode: row.userCode ?? null,
        userName: row.userName ?? null,
        userNumber: row.userNumber ?? null,
        role: row.role ?? null,
        agentName: row.agentName ?? null,
      };
      if (withPhone) member.phone = row.phone ?? null;
      return member;
    });
  return { ok: true, projectId: Number(projectId), total: members.length, members };
}

// 定时任务只知道自己跑在哪个会话里。会话已绑项目就直接拿到 projectId，
// 不用为了要一个 ID 把整条链路停下来等人。未绑定返回 bound:false，由调用方兜底。
async function resolveProjectCommand(args) {
  const sessionId = firstNonEmpty(args["session-id"], args.sessionId);
  if (!sessionId) throw new PublicFailure("NOTICE_SESSION_ID_MISSING");
  const data = await postJson(RESOLVE_PROJECT_PATH, { sessionId: Number(sessionId) });
  return {
    ok: true,
    bound: data?.bound === true,
    sessionId: Number(sessionId),
    projectId: data?.projectId ?? null,
    projectName: data?.projectName ?? null,
    projectType: data?.projectType ?? null,
  };
}

// projectId 缺失时用来列候选项目：让调用方把开放式追问变成"从列表里选一个"，
// 而不是猜项目或拿来源渠道顶替。只读，不产生任何通知。
async function projectsCommand(args) {
  const keyword = firstNonEmpty(args.keyword, args.q);
  const data = await postJson(PROJECT_PATH, {
    keyword: keyword || undefined,
    projectType: firstNonEmpty(args["project-type"], args.projectType) || undefined,
    pageNum: Number(firstNonEmpty(args.page, "1")),
    pageSize: Number(firstNonEmpty(args.size, "20")),
  });
  const rows = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
  const projects = rows
    .filter((row) => row && row.projectId)
    .map((row) => ({
      projectId: row.projectId,
      projectName: row.projectName ?? null,
      projectType: row.projectType ?? null,
      sessionCount: row.sessionCount ?? null,
    }));
  return { ok: true, total: data?.total ?? projects.length, projects };
}

function helpText() {
  return {
    ok: true,
    commands: {
      send: "node scripts/notice-send.mjs send [--input <payload.json>]  # 无 --input 时读 stdin",
      members:
        "node scripts/notice-send.mjs members --project-id <projectId> [--user-name <名字>] [--with-phone]",
      projects: "node scripts/notice-send.mjs projects [--keyword <关键词>] [--page 1] [--size 20]  # projectId 缺失时列候选",
      "resolve-project":
        "node scripts/notice-send.mjs resolve-project --session-id <sessionId>  # 按会话反查 projectId",
    },
    sendPayload: {
      title: "批次默认标题，单条可覆盖（<=200）",
      content: "批次默认正文，单条可覆盖（<=2000）",
      priority: "low|medium|high 或 1-4，默认 medium",
      sendDingtalk: "true 则尝试同时发送钉钉消息(需发送人已授权 dws)",
      dingtalkBody: "可选,钉钉消息内容,默认使用 content",
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
  if (command === "projects") return projectsCommand(args);
  if (command === "resolve-project") return resolveProjectCommand(args);
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
