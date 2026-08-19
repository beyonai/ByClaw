#!/usr/bin/env node
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { initRedis, getRedis, closeRedis, DiscoveryClient, RegistryKeys } from "@byclaw/by-framework";

const DEFAULT_CONTEXT_PATH = "/byaiService";
const DEFAULT_SIGNATURE_SALT = "{#@*A12^c0+}";
const DEFAULT_BACKEND_SERVICE_NAME = "ByaiService";
const BIND_PATH = "/digitalEmployeeController/installRelResources";
const UNBIND_PATH = "/digitalEmployeeController/uninstallRelResources";
const REL_LIST_PATH = "/digitalEmployeeController/queryRelResourceInfo";
const AUTH_LIST_PATH = "/auth/privilegeGrant/listResourceUseAuth";
const INNER_SKILL_TYPE = "inner";
const AUTH_PAGE_SIZE = 200;
const DEFAULT_TIMEOUT_MS = 30000;

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

function asArray(value) {
  if (value === undefined || value === true) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toNumber(value) {
  if (value === undefined || value === true) {
    return undefined;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isTruthyFlag(value) {
  if (value === undefined) {
    return false;
  }
  if (value === true) {
    return true;
  }
  return !["false", "0", "no", "off"].includes(String(value).trim().toLowerCase());
}

function expandHome(value) {
  const text = firstNonEmpty(value);
  if (!text) {
    return "";
  }
  return text.startsWith("~") ? path.join(os.homedir(), text.slice(1)) : text;
}

function timeoutMsFromArgs(args) {
  return Math.max(1000, toNumber(args["timeout-ms"]) ?? DEFAULT_TIMEOUT_MS);
}

function render(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Backend base URL: Redis service discovery first, then env/host fallback.
// ---------------------------------------------------------------------------

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
  if (!firstNonEmpty(process.env.REDIS_HOST)) {
    return { baseUrl: "", source: "redis", serviceName };
  }
  const instance = await getDiscoveryClient().discover(serviceName, "round-robin");
  if (!instance) {
    return { baseUrl: "", source: "redis", serviceName };
  }
  return {
    baseUrl: backendInstanceBaseUrl({
      host: instance.host,
      port: instance.port,
      pathPrefix: instance.metadata?.path_prefix,
    }),
    source: "redis",
    serviceName,
    instanceId: instance.id,
  };
}

async function resolveBackendBaseUrl() {
  const override = firstNonEmpty(process.env.BYAI_SERVICE_BASE_URL, process.env.SKILL_INSTALLER_URL);
  if (override) {
    return { baseUrl: normalizeBaseUrl(override), source: "env" };
  }
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
  return { baseUrl: composeHostBackendBaseUrl(), source: "HOST" };
}

async function endpoint(pathname) {
  const backend = await resolveBackendBaseUrl();
  if (!backend.baseUrl) {
    throw new Error("无法解析后端地址，请检查 REDIS_HOST 或 BYAI_SERVICE_BASE_URL");
  }
  return `${backend.baseUrl}/${pathname.replace(/^\/+/, "")}`;
}

// ---------------------------------------------------------------------------
// Auth: read the OpenClaw auth file, then let env vars override.
// ---------------------------------------------------------------------------

function normalizeAuthContext(rawAuth) {
  if (!rawAuth || typeof rawAuth !== "object" || Array.isArray(rawAuth)) {
    return {};
  }
  const nested = [rawAuth, rawAuth.data, rawAuth.user, rawAuth.userInfo, rawAuth.currentUser, rawAuth.loginInfo]
    .filter((item) => item && typeof item === "object" && !Array.isArray(item));
  const normalized = { ...rawAuth };
  for (const item of nested) {
    normalized.sessionId = firstNonEmpty(normalized.sessionId, item.sessionId, item.session_id, item.session);
    normalized.beyondToken = firstNonEmpty(
      normalized.beyondToken, item.beyondToken, item.beyond_token, item["Beyond-Token"], item["beyond-token"],
    );
    normalized.userCode = firstNonEmpty(normalized.userCode, item.userCode, item.user_code, item.usercode);
    normalized.user_id = firstNonEmpty(normalized.user_id, item.user_id, item.userId);
    if (item.headers && typeof item.headers === "object") {
      normalized.headers = { ...(normalized.headers || {}), ...item.headers };
    }
  }
  return normalized;
}

function pickHeader(headers, name) {
  if (!headers || typeof headers !== "object") {
    return "";
  }
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) {
      return firstNonEmpty(value);
    }
  }
  return "";
}

function candidateAuthFiles() {
  const stateDir = expandHome(firstNonEmpty(
    process.env.OPENCLAW_STATE_DIR, process.env.OPENCLAW_HOME, path.join(os.homedir(), ".openclaw"),
  ));
  const explicit = expandHome(process.env.BAIYING_AUTH_FILE);
  return [explicit, path.join(stateDir, "baiying-auth.json"), path.join(stateDir, "auth.json")].filter(Boolean);
}

function loadAuthContextSync() {
  for (const file of candidateAuthFiles()) {
    try {
      // Sync read keeps auth resolution usable from every helper without threading promises through.
      const raw = readFileSync(file, "utf8");
      const parsed = normalizeAuthContext(JSON.parse(raw));
      if (Object.keys(parsed).length) {
        return parsed;
      }
    } catch {}
  }
  return {};
}

function resolveAuthValues(auth) {
  const headers = auth.headers && typeof auth.headers === "object" ? auth.headers : {};
  return {
    sessionId: firstNonEmpty(
      process.env.BAIYING_SESSION, process.env.SESSION_ID, auth.sessionId,
      pickHeader(headers, "x-signature-sessionId"), process.env.BYCLAW_SESSION,
    ),
    beyondToken: firstNonEmpty(
      process.env.BEYOND_TOKEN, auth.beyondToken, auth["Beyond-Token"],
      pickHeader(headers, "beyond-token"), process.env.BYCLAW_BEYOND_TOKEN,
    ),
    userCode: firstNonEmpty(
      process.env.USER_CODE, auth.userCode, pickHeader(headers, "x-user-id"), process.env.BYCLAW_USER_CODE,
    ),
    userId: firstNonEmpty(auth.user_id, process.env.USER_ID, process.env.BAIYING_USER_ID),
  };
}

function buildSignatureHeaders(userCode, body) {
  if (!userCode) {
    return {};
  }
  const nonce = crypto.randomUUID();
  const timestamp = Date.now().toString();
  const salt = firstNonEmpty(
    process.env.BYCLAW_ECOSYSTEM_SIGNATURE_SALT, process.env.BYCLAW_SIGNATURE_SALT, DEFAULT_SIGNATURE_SALT,
  );
  const signature = crypto.createHash("md5")
    .update(`${userCode}${nonce}${timestamp}${body || ""}${salt}`, "utf8").digest("hex");
  return {
    "x-signature-nonce": nonce,
    "x-signature-timestamp": timestamp,
    "x-signature-value": signature,
  };
}

function authHeaders({ bodyText = "", accept = "application/json" } = {}) {
  const auth = loadAuthContextSync();
  const values = resolveAuthValues(auth);
  const headers = { Accept: accept, ...(auth.headers || {}) };
  if (process.env.BAIYING_AGENT_AUTH) {
    headers.Authorization = process.env.BAIYING_AGENT_AUTH;
  }
  if (values.beyondToken) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "beyond-token") {
        delete headers[key];
      }
    }
    headers["beyond-token"] = values.beyondToken;
  }
  if (values.userCode) {
    headers["X-User-Id"] = values.userCode;
  }
  const cookies = [];
  if (values.sessionId) {
    headers["x-signature-sessionId"] = values.sessionId;
    headers["X-Session-Id"] = values.sessionId;
    cookies.push(`SESSION=${values.sessionId}`, `PORTAL-SESSION=${values.sessionId}`);
  }
  if (values.userId) {
    cookies.push(`currentUserId=${values.userId}`);
  }
  if (cookies.length) {
    headers.Cookie = cookies.join("; ");
  }
  return { ...headers, ...buildSignatureHeaders(values.userCode, bodyText) };
}

function authSummary() {
  const values = resolveAuthValues(loadAuthContextSync());
  return {
    hasSession: Boolean(values.sessionId),
    hasBeyondToken: Boolean(values.beyondToken),
    hasUserCode: Boolean(values.userCode),
    canSign: Boolean(values.userCode),
  };
}

// ---------------------------------------------------------------------------
// skillCode -> skillId resolution
//
// Source: the resource-permission list (auth/privilegeGrant/listResourceUseAuth)
// filtered to resourceBizType=SKILL. ResourceAuthVo.resourceCode is the
// skillCode and resourceId is the rel ID the digital-employee binding wants.
// Only skillType=inner (built-in) entries are considered here.
// ---------------------------------------------------------------------------

function responseSucceeded(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return false;
  }
  return json.success === true || json.code === 0 || json.resultCode === 0;
}

function validateSkillCode(rawCode) {
  const code = firstNonEmpty(rawCode);
  if (!code) {
    throw new Error("skillCode 不能为空");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(code) || code.startsWith(".") || code === "." || code === "..") {
    throw new Error(`非法 skillCode: ${rawCode}`);
  }
  return code;
}

async function postJson({ pathname, body, timeoutMs }) {
  const bodyText = JSON.stringify(body ?? {});
  const response = await fetch(await endpoint(pathname), {
    method: "POST",
    headers: { ...authHeaders({ bodyText }), "Content-Type": "application/json" },
    body: bodyText,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`请求 ${pathname} 失败 HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${pathname} 返回非 JSON: ${text.slice(0, 200)}`);
  }
  if (!responseSucceeded(json)) {
    throw new Error(json?.msg || json?.message || `${pathname} 返回异常: ${text.slice(0, 200)}`);
  }
  return json.data;
}

function isInnerSkill(entry) {
  return String(entry?.skillType || "").trim().toLowerCase() === INNER_SKILL_TYPE;
}

async function fetchInnerSkills({ timeoutMs, keyword, ownerType }) {
  const body = {
    resourceBizTypeList: ["SKILL"],
    pageNum: 1,
    pageSize: AUTH_PAGE_SIZE,
    keyword: keyword || "",
    language: firstNonEmpty(process.env.BYCLAW_LANGUAGE, "zh-CN"),
  };
  if (ownerType) {
    body.ownerType = ownerType;
  }
  const data = await postJson({ pathname: AUTH_LIST_PATH, body, timeoutMs });
  const list = Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : [];
  return list.filter(isInnerSkill);
}

// 把一个技能条目压成搜索/列表输出用的扁平结构。
function describeSkillEntry(entry) {
  return {
    skillCode: firstNonEmpty(entry?.resourceCode),
    skillId: toNumber(entry?.resourceId) ?? null,
    skillName: firstNonEmpty(entry?.resourceName),
    skillDesc: firstNonEmpty(entry?.resourceDesc, entry?.description),
    skillType: firstNonEmpty(entry?.skillType),
    ownerType: firstNonEmpty(entry?.ownerType),
  };
}

// 关键词落在 code / 名称 / 描述任意一处都算命中，让 agent 用中文词也能搜到英文 code。
function skillMatchesKeyword(entry, keyword) {
  if (!keyword) {
    return true;
  }
  const needle = keyword.toLowerCase();
  return [entry.skillCode, entry.skillName, entry.skillDesc]
    .some((field) => String(field || "").toLowerCase().includes(needle));
}

async function searchCommand(args) {
  const timeoutMs = timeoutMsFromArgs(args);
  const ownerType = firstNonEmpty(args["owner-type"]);
  const keyword = firstNonEmpty(args.keyword, args.q, args._?.[1]);

  // 后端 keyword 只匹配 code，中文词会落空；所以先全量拉再本地过滤三个字段。
  const entries = (await fetchInnerSkills({ timeoutMs, keyword: "", ownerType })).map(describeSkillEntry);
  const matched = entries
    .filter((entry) => skillMatchesKeyword(entry, keyword))
    .sort((left, right) => left.skillCode.localeCompare(right.skillCode));

  // 绑定状态是增强信息：推导不到数字员工时仍然要能搜。
  let digitalEmployee = null;
  let boundIds = new Set();
  try {
    const { digitalEmployeeId, source } = resolveDigitalEmployeeId(args);
    digitalEmployee = { id: digitalEmployeeId, source };
    const bound = await fetchBoundResources({ digitalEmployeeId, timeoutMs });
    boundIds = new Set(bound.map((item) => toNumber(item?.resourceId)).filter((id) => id !== undefined));
  } catch (error) {
    digitalEmployee = { id: null, source: null, unavailable: error instanceof Error ? error.message : String(error) };
  }

  const skills = matched.map((entry) => ({
    ...entry,
    bound: digitalEmployee?.id === null || digitalEmployee?.id === undefined ? null : boundIds.has(entry.skillId),
  }));

  return {
    ok: true,
    action: "search",
    keyword: keyword || null,
    digitalEmployee,
    visibleInnerSkillCount: entries.length,
    // 命中上限说明可能还有没拉到的条目，提示调用方缩小 ownerType 再搜。
    truncated: entries.length >= AUTH_PAGE_SIZE,
    matchedCount: skills.length,
    skills,
    hint: skills.length
      ? "用 bind --skill-code <code> 绑定；bound: false 表示可见但未绑定，bound: null 表示未能确定数字员工"
      : "没有命中。换个关键词，或不带 --keyword 列出全部可见内置技能",
  };
}

async function resolveSkillIdByCode({ skillCode, timeoutMs, ownerType }) {
  const code = validateSkillCode(skillCode);
  // Pass the code as keyword so the backend narrows the page server-side.
  const entries = await fetchInnerSkills({ timeoutMs, keyword: code, ownerType });
  const matches = entries.filter((entry) => firstNonEmpty(entry?.resourceCode) === code);
  const candidates = matches.length
    ? matches
    : entries.filter((entry) => firstNonEmpty(entry?.resourceCode).toLowerCase() === code.toLowerCase());
  if (!candidates.length) {
    // keyword 只匹配 code，命中为空时再全量拉一次找形近候选，避免让调用方靠猜。
    let pool = entries;
    if (!pool.length) {
      pool = await fetchInnerSkills({ timeoutMs, keyword: "", ownerType }).catch(() => []);
    }
    const available = pool.map((entry) => firstNonEmpty(entry?.resourceCode)).filter(Boolean);
    const near = available.filter((item) => {
      const low = item.toLowerCase();
      const target = code.toLowerCase();
      return low.includes(target) || target.includes(low);
    });
    const suggestions = (near.length ? near : available).slice(0, 10);
    throw new Error(
      `未找到 skillCode=${code} 对应的内置技能（skillType=inner）`
      + `${near.length ? `；形近候选: ${suggestions.join(", ")}` : suggestions.length ? `；当前可见内置技能: ${suggestions.join(", ")}` : ""}`
      + `；用 search --keyword <词> 按名称或描述检索完整清单`,
    );
  }
  const withId = candidates.filter((entry) => toNumber(entry?.resourceId) !== undefined);
  if (!withId.length) {
    throw new Error(`内置技能 ${code} 缺少 resourceId，无法绑定`);
  }
  if (withId.length > 1) {
    const ids = withId.map((entry) => toNumber(entry.resourceId)).join(", ");
    throw new Error(`skillCode=${code} 命中多个内置技能资源 (${ids})，请用 --skill-id 指定`);
  }
  const entry = withId[0];
  return {
    skillId: toNumber(entry.resourceId),
    skillCode: firstNonEmpty(entry.resourceCode) || code,
    skillName: firstNonEmpty(entry.resourceName),
    skillType: firstNonEmpty(entry.skillType),
    sourceType: firstNonEmpty(entry.sourceType),
  };
}

// ---------------------------------------------------------------------------
// Digital employee resolution + skill binding
// ---------------------------------------------------------------------------

function decodeJwtPayload(token) {
  const segment = String(token || "").split(".")[1];
  if (!segment) {
    return null;
  }
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function resolveDigitalEmployeeId(args) {
  const explicit = toNumber(args["digital-employee-id"]);
  if (explicit !== undefined) {
    return { digitalEmployeeId: explicit, source: "flag" };
  }
  const fromEnv = toNumber(firstNonEmpty(
    process.env.BAIYING_DIGITAL_EMPLOYEE_ID, process.env.DIGITAL_EMPLOYEE_ID, process.env.RESOURCE_ID,
  ));
  if (fromEnv !== undefined) {
    return { digitalEmployeeId: fromEnv, source: "env" };
  }
  // Extract from current working directory if it matches workspace-baiying-agent-<id>
  const cwdMatch = process.cwd().match(/workspace-baiying-agent-(\d+)/);
  if (cwdMatch) {
    return { digitalEmployeeId: toNumber(cwdMatch[1]), source: "cwd" };
  }
  // Extract from BYAI_WORKER_ID=openclaw-<usercode>
  const workerMatch = process.env.BYAI_WORKER_ID?.match(/openclaw-(\d+)/);
  if (workerMatch) {
    return { digitalEmployeeId: toNumber(workerMatch[1]), source: "BYAI_WORKER_ID" };
  }
  // Extract from BAIYING_AGENT_AUTH JWT sub claim
  const agentAuthPayload = decodeJwtPayload(process.env.BAIYING_AGENT_AUTH);
  const fromAgentAuth = toNumber(agentAuthPayload?.sub);
  if (fromAgentAuth !== undefined) {
    return { digitalEmployeeId: fromAgentAuth, source: "BAIYING_AGENT_AUTH" };
  }
  // Beyond-Token carries the caller's default digital employee.
  const payload = decodeJwtPayload(resolveAuthValues(loadAuthContextSync()).beyondToken);
  const fromToken = toNumber(payload?.defaultDigitalEmployeeId);
  if (fromToken !== undefined) {
    return { digitalEmployeeId: fromToken, source: "beyond-token" };
  }
  throw new Error("无法确定数字员工，请用 --digital-employee-id 指定");
}

async function fetchBoundResources({ digitalEmployeeId, timeoutMs }) {
  const data = await postJson({
    pathname: REL_LIST_PATH,
    body: { resourceId: digitalEmployeeId },
    timeoutMs,
  });
  return Array.isArray(data) ? data : [];
}

async function mutateBinding({ pathname, digitalEmployeeId, relIds, timeoutMs }) {
  return postJson({ pathname, body: { digitalEmployeeId, relIds }, timeoutMs });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function resolveTargets(args) {
  // skillCode is the primary handle; --skill-id stays available as an override
  // for codes the permission list cannot disambiguate.
  const codes = asArray(args["skill-code"]).map((item) => firstNonEmpty(item)).filter(Boolean);
  const ids = asArray(args["skill-id"]).map(toNumber).filter((id) => id !== undefined);
  if (!codes.length && !ids.length) {
    throw new Error("缺少 --skill-code（也可用 --skill-id 直接指定资源ID）");
  }
  if (codes.length && ids.length && codes.length !== ids.length) {
    throw new Error("同时传入 --skill-code 与 --skill-id 时，两者数量必须一致");
  }
  const length = Math.max(codes.length, ids.length);
  const targets = [];
  const seen = new Set();
  for (let index = 0; index < length; index += 1) {
    const skillCode = codes[index] ? validateSkillCode(codes[index]) : "";
    const skillId = ids[index];
    const key = `${skillCode}#${skillId ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push({ skillCode, skillId });
  }
  return targets;
}

async function resolveTarget({ skillCode, skillId, timeoutMs, ownerType }) {
  if (skillId !== undefined) {
    return { skillId, skillCode: skillCode || `skill-${skillId}`, resolvedBy: "skill-id" };
  }
  const resolved = await resolveSkillIdByCode({ skillCode, timeoutMs, ownerType });
  return { ...resolved, resolvedBy: "auth-list" };
}

async function resolveAll(args) {
  const timeoutMs = timeoutMsFromArgs(args);
  const ownerType = firstNonEmpty(args["owner-type"]);
  const resolved = [];
  const failed = [];
  for (const target of resolveTargets(args)) {
    const label = target.skillCode || `skill-${target.skillId}`;
    try {
      resolved.push(await resolveTarget({ ...target, timeoutMs, ownerType }));
    } catch (error) {
      failed.push({ skillCode: label, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { resolved, failed, timeoutMs };
}

async function bindCommand(args, { unbind = false } = {}) {
  const action = unbind ? "unbind" : "bind";
  const { digitalEmployeeId, source } = resolveDigitalEmployeeId(args);
  const { resolved, failed, timeoutMs } = await resolveAll(args);
  const bound = await fetchBoundResources({ digitalEmployeeId, timeoutMs });
  const boundIds = new Set(bound.map((item) => toNumber(item?.resourceId)).filter((id) => id !== undefined));

  // Binding is idempotent server-side (install merges, uninstall filters), but
  // skipping no-ops keeps the digital employee's audit log clean.
  const actionable = resolved.filter((item) => (unbind ? boundIds.has(item.skillId) : !boundIds.has(item.skillId)));
  const noop = resolved.filter((item) => (unbind ? !boundIds.has(item.skillId) : boundIds.has(item.skillId)));

  const base = {
    ok: failed.length === 0,
    action,
    digitalEmployee: { id: digitalEmployeeId, source },
    skills: resolved.map((item) => ({ skillCode: item.skillCode, skillId: item.skillId })),
    alreadyInDesiredState: noop.map((item) => item.skillCode),
    failed,
  };

  if (isTruthyFlag(args["dry-run"])) {
    return { ...base, dryRun: true, wouldChange: actionable.map((item) => item.skillCode) };
  }
  if (!actionable.length) {
    return { ...base, changed: [], reason: unbind ? "目标技能均未绑定" : "目标技能均已绑定" };
  }

  await mutateBinding({
    pathname: unbind ? UNBIND_PATH : BIND_PATH,
    digitalEmployeeId,
    relIds: actionable.map((item) => item.skillId),
    timeoutMs,
  });

  // Re-fetch to verify the mutation actually took effect
  const afterBound = await fetchBoundResources({ digitalEmployeeId, timeoutMs });
  const afterBoundIds = new Set(afterBound.map((item) => toNumber(item?.resourceId)).filter((id) => id !== undefined));

  const verified = actionable.filter((item) => (unbind ? !afterBoundIds.has(item.skillId) : afterBoundIds.has(item.skillId)));
  const verifyFailed = actionable.filter((item) => (unbind ? afterBoundIds.has(item.skillId) : !afterBoundIds.has(item.skillId)));

  return {
    ...base,
    // 写入未生效同样是失败：ok 必须把校验结果算进去，否则退出码 0 会掩盖问题。
    ok: base.ok && verifyFailed.length === 0,
    changed: verified.map((item) => item.skillCode),
    verifyFailed: verifyFailed.length ? verifyFailed.map((item) => ({ skillCode: item.skillCode, skillId: item.skillId })) : undefined,
  };
}

async function listCommand(args) {
  const { digitalEmployeeId, source } = resolveDigitalEmployeeId(args);
  const timeoutMs = timeoutMsFromArgs(args);
  const bound = await fetchBoundResources({ digitalEmployeeId, timeoutMs });

  // 绑定关系接口不回 skillType，用权限列表补一层 skillId -> skillType。
  // 这只是增强：查不到就退回接口原值，不让 list 因为补全失败而整体报错。
  const ownerType = firstNonEmpty(args["owner-type"]);
  let skillTypeMap = new Map();
  let enrichment = "auth-list";
  try {
    const innerSkills = await fetchInnerSkills({ timeoutMs, keyword: "", ownerType });
    skillTypeMap = new Map(
      innerSkills
        .map((entry) => [toNumber(entry?.resourceId), firstNonEmpty(entry?.skillType)])
        .filter(([id, type]) => id !== undefined && type),
    );
    // 权限列表按 AUTH_PAGE_SIZE 分页，命中上限说明可能还有未覆盖的条目。
    if (innerSkills.length >= AUTH_PAGE_SIZE) {
      enrichment = "auth-list-truncated";
    }
  } catch (error) {
    enrichment = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }

  const skills = bound
    .filter((item) => String(item?.resourceBizType || "").toUpperCase() === "SKILL"
      || firstNonEmpty(item?.skillType))
    .map((item) => {
      const skillId = toNumber(item?.resourceId) ?? null;
      const skillType = firstNonEmpty(item?.skillType) || skillTypeMap.get(skillId) || "";
      return {
        skillCode: firstNonEmpty(item?.resourceCode),
        skillId,
        skillName: firstNonEmpty(item?.resourceName),
        skillType,
        // skillType 补不到时用 null 表示未知，避免和"确认不是内置技能"混淆。
        inner: skillType ? String(skillType).trim().toLowerCase() === INNER_SKILL_TYPE : null,
      };
    })
    .sort((left, right) => left.skillCode.localeCompare(right.skillCode));
  return {
    ok: true,
    action: "list",
    digitalEmployee: { id: digitalEmployeeId, source },
    // 告知 skillType 的来源与可信度：inner: null 的条目源于这里补全失败或分页截断。
    skillTypeEnrichment: enrichment,
    boundSkillCount: skills.length,
    skills,
  };
}

async function statusCommand(args) {
  const { digitalEmployeeId, source } = resolveDigitalEmployeeId(args);
  const { resolved, failed, timeoutMs } = await resolveAll(args);
  const backend = await resolveBackendBaseUrl();
  const bound = await fetchBoundResources({ digitalEmployeeId, timeoutMs });
  const boundIds = new Set(bound.map((item) => toNumber(item?.resourceId)).filter((id) => id !== undefined));
  return {
    ok: failed.length === 0,
    action: "status",
    backend: { baseUrl: backend.baseUrl, source: backend.source },
    auth: authSummary(),
    digitalEmployee: { id: digitalEmployeeId, source },
    items: [
      ...resolved.map((item) => ({
        skillCode: item.skillCode,
        skillId: item.skillId,
        skillType: item.skillType || "",
        bound: boundIds.has(item.skillId),
      })),
      ...failed,
    ],
  };
}

function helpManual() {
  return {
    ok: true,
    action: "help",
    description: "按 skillCode 查平台内置技能（skillType=inner）并绑定到数字员工，让 agent 可以使用",
    resolution: [
      "skillCode 经 listResourceUseAuth (resourceBizType=SKILL) 解析为资源ID（ResourceAuthVo.resourceCode -> resourceId）",
      "只接受 skillType=inner 的内置技能；内置技能随运行时镜像提供，无需下载，绑定关系即可生效",
      "再调用 installRelResources 建立数字员工与技能的关联",
    ],
    commands: [
      {
        name: "search",
        summary: "搜索可见的内置技能（keyword 在 code / 名称 / 描述任意一处匹配即命中，不带 keyword 列全部）",
        options: [
          "--keyword <词> / --q <词>   可选，关键词；缺失时列出全部可见内置技能",
          "--digital-employee-id <id>  可选，数字员工；用于标注 bound 状态，推导不到不影响搜索",
          "--owner-type <type>         可选，限定归属范围",
        ],
      },
      {
        name: "bind",
        summary: "把内置技能绑定到数字员工；已绑定的跳过",
        options: [
          "--skill-code <code>          技能编码，可重复传入批量绑定",
          "--skill-id <id>              可选，直接指定资源ID绕过 skillCode 解析",
          "--digital-employee-id <id>   可选，目标数字员工；按 6 级链路推导（见下方环境变量）",
          "--owner-type <type>          可选，限定归属范围，如 personal / enterprise",
          "--dry-run                    可选，只解析不改动绑定关系",
          "--timeout-ms <ms>            可选，单次请求超时，默认 30000",
        ],
      },
      { name: "unbind", summary: "解绑技能；未绑定的跳过", options: ["同 bind"] },
      { name: "list", summary: "列出数字员工已绑定的技能", options: ["--digital-employee-id <id>"] },
      { name: "status", summary: "查询指定 skillCode 的解析结果与绑定状态", options: ["同 bind"] },
      { name: "help", summary: "输出本帮助" },
    ],
    endpoints: {
      authList: `POST ${DEFAULT_CONTEXT_PATH}${AUTH_LIST_PATH}`,
      bind: `POST ${DEFAULT_CONTEXT_PATH}${BIND_PATH}`,
      unbind: `POST ${DEFAULT_CONTEXT_PATH}${UNBIND_PATH}`,
      relList: `POST ${DEFAULT_CONTEXT_PATH}${REL_LIST_PATH}`,
    },
    environment: [
      "数字员工推导链（优先级从高到低）：",
      "  1. --digital-employee-id <id>",
      "  2. BAIYING_DIGITAL_EMPLOYEE_ID / DIGITAL_EMPLOYEE_ID / RESOURCE_ID",
      "  3. workspace-baiying-agent-<id> (cwd 工作目录名)",
      "  4. BYAI_WORKER_ID=openclaw-<usercode>",
      "  5. BAIYING_AGENT_AUTH JWT sub claim",
      "  6. BEYOND_TOKEN 的 defaultDigitalEmployeeId",
      "",
      "后端地址推导：",
      "  BYAI_SERVICE_BASE_URL / SKILL_INSTALLER_URL   显式后端地址，优先级最高",
      "  REDIS_HOST + BE_DOMAINNAME                    Redis 服务发现",
      "  BE_PROTOCOL / HOST / BE_SERVER_PORT           兜底组装地址",
      "",
      "鉴权：BAIYING_AUTH_FILE / BEYOND_TOKEN / USER_CODE",
    ],
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = firstNonEmpty(args._[0], "help");
  let result;
  if (command === "help") {
    result = helpManual();
  } else if (command === "search") {
    result = await searchCommand(args);
  } else if (command === "bind") {
    result = await bindCommand(args);
  } else if (command === "unbind") {
    result = await bindCommand(args, { unbind: true });
  } else if (command === "status") {
    result = await statusCommand(args);
  } else if (command === "list") {
    result = await listCommand(args);
  } else {
    throw new Error(`未知命令: ${command}`);
  }
  render(result);
  if (result.ok === false) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
  main()
    .then(() => closeDiscovery())
    .catch(async (error) => {
      await closeDiscovery().catch(() => {});
      render({ ok: false, error: error instanceof Error ? error.message : String(error) });
      process.exitCode = 1;
    });
}

export {
  bindCommand,
  fetchBoundResources,
  helpManual,
  isInnerSkill,
  listCommand,
  mutateBinding,
  resolveDigitalEmployeeId,
  resolveSkillIdByCode,
  resolveTargets,
  responseSucceeded,
  searchCommand,
  statusCommand,
  validateSkillCode,
};
