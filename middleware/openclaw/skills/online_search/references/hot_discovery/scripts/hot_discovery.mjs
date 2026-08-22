#!/usr/bin/env node
/**
 * hot_discovery.mjs — online_search 的热度发现通道
 *
 * 两个子命令：
 *   search --dimensions a,b --query "..." [--limit N] [--tiers 1,2] [--json]
 *   merge  --hot-file f [--searxng-file f] [--agent-reach-file f]
 *
 * ============================ 边界约束（改代码前必读）============================
 *
 * 【硬约束】本通道的输出只允许是 URL、标题、热度字段，以及一格硬截断 100 字符的
 * titleContext。任何正文获取必须回到 agent-reach 主路由表。
 *
 * 这条防的是一类具体绕过：bycli 适配器的 columns 里带 selftext / content /
 * description / info / summary / intro / abstract / bio 等正文类列（33 个纳入适配器里
 * 17 个命中）。它们看起来能当正文用，但那等于用发现通道完成取内容，绕过 agent-reach
 * 路由表与 collect 的物化登记。
 *
 * 实现形式必须是白名单，且必须是「构造新对象」而非「delete 不要的键」：
 *   ✔ const out = {url, title, ...metrics}
 *   ✘ const out = {...row}; delete out.description
 * 后者在字段名意外时会静默保留。
 *
 * 为什么是白名单而不是黑名单：列名由适配器作者自由命名，是一个开放集合。
 * rubygems 用 info、tvmaze 用 summary、weread-official 用 intro、twitter 用 bio —— 都不含
 * desc/text/content 词根，任何子串黑名单都拦不住。juejin 的 extra.brief / extra.summary
 * 更根本不在 columns 顶层，黑名单连扫描入口都没有。
 *
 * 【禁止项】不取正文、不写 session.json、不调 searxng（merge 只读它的输出文件）、
 * 不硬编码适配器清单（一律读 adapters.md + bycli list 运行时校验）、不触发登录流程、
 * 不发任何直接 HTTP 请求（禁 fetch / curl / web_fetch）。
 *
 * 【titleContext 的三层约束】
 *   1. 长度：硬截断 100 字符（UTF-16 码元，非字节）
 *   2. 命名：叫 titleContext，不叫 snippet/summary/excerpt —— 命名是这里唯一真正的防线
 *   3. 路径：严禁写入 collectionFilters / citations / 最终报告
 * 第 3 层是纸面纪律，无程序拦截，是本设计最薄弱处。接受它的理由是失效后果被第 1 层
 * 压小一个量级：泄漏的是残句而非全文。
 *
 * 【生命周期】发现快照里的 titleContext 与 searxngContent 一经 collect 登记即作废
 * （inventory 里存在同 sourceUrl 即算，materialization=pending 也算）。cleanup 在部分成功
 * 场景下不清 .post-processing-inputs/，快照会长期留存，续跑还会重新读它。
 * ==============================================================================
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createBycliIntegration, deriveExecutionProfile } from './bycli_integration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTERS_MD = resolve(HERE, '..', 'adapters.md');
const BYCLI_BASELINE_VERSION = '2.1.38';

/** titleContext 硬上限（字符 = UTF-16 码元，不是字节） */
const TITLE_CONTEXT_MAX = 100;
/** 无标题列的适配器从正文列截取的标题上限。刻意小于 TITLE_CONTEXT_MAX，见 adapters.md */
const DERIVED_TITLE_MAX = 60;
/** 已知的 quirk ID —— 声明里出现未识别的 ID 即启动失败，防声明与代码漂移 */
const KNOWN_QUIRKS = new Set([
  'juejin-kind-dispatch', 'juejin-nested-extra', 'juejin-cumulative-hotness',
  'juejin-period-empty', 'github-rate-limit', 'github-watchers-dead',
  'choices-empty-untrusted', 'weread-api-key',
  'twitter-no-title-column', 'jike-no-title-column', 'cnki-no-metric',
]);

// ────────────────────────────── §6.3 URL 规范化 ──────────────────────────────
// 基础四条（去 utm_* / 末尾斜杠 / http→https / fragment）实测对 6 种真实形态只对齐 1 种。
// 补三条：去 www. / 移动子域按白名单归一 / 查询参数按白名单保留。
//
// 站点有显式参数白名单时只保留身份参数；未知站点默认保留业务参数，只删除明确的追踪参数。
// 多留参数最多造成漏合并，误删业务参数却会把不同资源合并成伪双通道，因此默认走安全侧。
//
// 【不解决】等价路径变体（/tree/master）。判定两个路径是否同一资源需要站点语义，
// 无通用规则，且尝试对齐反有误合并风险（/tree/v1 与 /tree/v2 是不同内容）。已知缺口。

export function normalizeUrl(raw, cfg = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const paramAllow = cfg.queryParamAllowlist || {};
  const mobileAllow = new Set(cfg.mobileSubdomainAllowlist || []);

  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  if (!u.port) u.protocol = 'https:'; // 规则 3；非默认端口不改协议，避免改变资源身份
  u.hash = '';                  // 规则 4
  u.username = '';
  u.password = '';

  let host = u.hostname.toLowerCase();
  // 规则 6：移动子域按白名单归一，不用 m.* 通配 —— 个别站点 m. 是独立内容
  if (mobileAllow.has(host)) host = host.replace(/^(m|mobile)\./, '');
  // 规则 5：去 www.
  host = host.replace(/^www\./, '');
  u.hostname = host;

  // 规则 7：已声明站点按白名单保留身份参数；未知站点只删除明确追踪参数。
  const hasExactAllowlist = Object.prototype.hasOwnProperty.call(paramAllow, host);
  const allow = new Set(hasExactAllowlist ? paramAllow[host] : []);
  const isTrackingParam = (key) => /^utm_/i.test(key)
    || ['fbclid', 'gclid', 'dclid', 'msclkid'].includes(key.toLowerCase());
  const canonicalKeys = new Set([...u.searchParams.keys()]
    .map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const hasSigningContext = [...canonicalKeys].some((key) =>
    /^(xamz|xgoog)/.test(key)
    || /(signature|credential|securitytoken|keypairid)$/.test(key) || key === 'sig');
  const hasOauthContext = canonicalKeys.has('code')
    && (canonicalKeys.has('iss') || canonicalKeys.has('state') || /(?:oauth|callback)/i.test(u.pathname));
  const isSensitiveParam = (key) => {
    const canonicalKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/^(xamz|xgoog)/.test(canonicalKey)) return true;
    if (canonicalKey === 'code') return hasOauthContext;
    if (canonicalKey === 'state') return hasOauthContext;
    if (canonicalKey === 'policy') return hasSigningContext;
    if (hasSigningContext
      && [
        'expires', 'keypairid', 'rscc', 'rscd', 'rsce', 'rscl', 'rsct',
        'saoid', 'scid', 'se', 'sip', 'ske', 'skoid', 'sks', 'skt', 'sktid', 'skv',
        'sp', 'spr', 'sr', 'st', 'suoid', 'sv',
      ].includes(canonicalKey)) {
      return true;
    }
    return ['auth', 'jwt', 'key', 'sig'].includes(canonicalKey)
      || /(token|secret|signature|credential|password|passwd|authorization|cookie|session|sessionid|apikey|accesskey|accesskeyid|keypairid)$/.test(canonicalKey);
  };
  const kept = [...u.searchParams.entries()]
    .filter(([k]) => !isSensitiveParam(k)
      && (hasExactAllowlist ? allow.has(k) : !isTrackingParam(k)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));   // 顺序无关
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);

  // 规则 2：统一末尾斜杠（去掉），但根路径保留 "/"
  let path = u.pathname;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  u.pathname = path || '/';

  return u.toString();
}

// ─────────────────────── adapters.md 声明解析与校验 ───────────────────────

export function parseDeclarations(mdText) {
  const m = mdText.match(/```ADAPTER-DECLARATIONS\n([\s\S]*?)\n```/);
  if (!m) throw new Error('adapters.md 缺少 ADAPTER-DECLARATIONS 块');
  let decl;
  try {
    decl = JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`ADAPTER-DECLARATIONS 不是合法 JSON: ${e.message}`);
  }
  const adapters = [];
  for (const tier of [1, 2, 3]) {
    const bucket = decl[`tier${tier}`] || {};
    for (const [site, spec] of Object.entries(bucket)) {
      const quirks = spec.quirks || [];
      for (const q of quirks) {
        if (!KNOWN_QUIRKS.has(q)) {
          throw new Error(`适配器 ${site} 声明了未识别的 quirk "${q}" —— 声明与代码已漂移`);
        }
      }
      // titleColumn 为 null 时必须给 titleFrom，否则该适配器 100% 丢弃候选
      if (!spec.titleColumn && !(spec.titleFrom || []).length) {
        throw new Error(`适配器 ${site} 既无 titleColumn 也无 titleFrom —— 候选会 100% 丢弃`);
      }
      if (!spec.urlColumn) throw new Error(`适配器 ${site} 未声明 urlColumn`);
      adapters.push({ site, tier, ...spec, quirks });
    }
  }
  return {
    adapters,
    queryParamAllowlist: decl.queryParamAllowlist || {},
    mobileSubdomainAllowlist: decl.mobileSubdomainAllowlist || [],
  };
}

// ───────────────────────────── bycli 调用与错误分派 ─────────────────────────────
//
// 实测（bycli 2.1.31）：失败时 stdout 为空，错误以 YAML 写到 stderr：
//     ok: false
//     error:
//       code: AUTH_REQUIRED
//       message: ...
//       exitCode: 77
// 因此不能 JSON.parse(stdout) 读 error.code —— 设计文档 §5.0 的这一点与实测不符。

/** 从 stderr 的 YAML 里抠出 error.code。不引 YAML 依赖，只取这一个字段。 */
export function parseBycliErrorCode(stderr) {
  if (typeof stderr !== 'string') return null;
  const m = stderr.match(/^\s*code:\s*([A-Z_][A-Z0-9_]*)\s*$/m);
  return m ? m[1] : null;
}

/**
 * 按退出码 + error.code 分派失败。
 *
 * exit 75 同码两义：github 的 RATE_LIMITED 与微信登录 TIMEOUT 共用它。分派必须同时读
 * error.code —— 只看码会把限流误判为「等待登录」而进入错误的等待分支。
 */
export function classifyFailure(exitCode, errorCode, timedOut = false) {
  if (timedOut) return 'timeout';
  if (errorCode === 'AUTH_REQUIRED') return 'auth_required';
  if (errorCode === 'BROWSER_CONNECT') return 'bridge_unavailable';
  if (errorCode === 'RATE_LIMITED') return 'rate_limited';
  if (errorCode === 'EMPTY_RESULT') return 'empty_result';
  if (errorCode === 'TIMEOUT') return 'login_timeout';
  switch (exitCode) {
    case 77: return 'auth_required';
    case 69: return 'bridge_unavailable';
    case 66: return 'empty_result';
    // exit 75 无 error.code 时不猜：既可能是限流也可能是登录等待
    case 75: return 'exit75_ambiguous';
    default: return 'command_failed';
  }
}

export function bridgeFailureStats(tier, result) {
  return {
    tier,
    status: result.timedOut ? 'timeout' : 'bridge_unavailable',
    exitCode: result.code,
    ...(result.killed ? { killed: true } : {}),
    ...(result.rawErrorCode ? { rawErrorCode: result.rawErrorCode } : {}),
  };
}

// ───────────────────────── 白名单取列（★ 边界的实现点）─────────────────────────

const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/**
 * 白名单取列。
 *
 * 放行的完整集合：声明的 urlColumn / titleColumn(或 titleFrom) / metricColumns /
 * secondaryColumns / 由 titleContextFrom 派生并硬截断的 titleContext。其余一律丢弃。
 *
 * 构造新对象而非 delete —— 见文件头注释。
 *
 * 规则 1（拒绝嵌套）：若白名单内某字段的值是 object/array，记 shape_unexpected 并拒绝该
 * 字段，不展平。展平会把二层正文（juejin 的 extra.brief、twitter 的 author.bio）提升到顶层
 * 绕开按字段名的白名单。报错优于猜测。
 */
export function extractCandidate(row, spec, stats) {
  const note = (k) => { stats[k] = (stats[k] || 0) + 1; };

  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    note('row_shape_unexpected');
    return null;
  }

  // 嵌套探测覆盖整行：即使嵌套字段不在白名单里，也要记账（juejin 的 extra 即此例），
  // 这样声明漂移到把嵌套列纳入白名单时能立刻看见。
  for (const [k, v] of Object.entries(row)) {
    if (v !== null && typeof v === 'object') {
      note('shape_unexpected');
      stats.shapeUnexpectedFields = stats.shapeUnexpectedFields || new Set();
      stats.shapeUnexpectedFields.add(k);
    }
  }

  const pick = (col) => {
    if (!col) return undefined;
    const v = row[col];
    if (v === undefined) return undefined;
    if (!isScalar(v)) return undefined;      // 嵌套值一律拒绝，已在上面记账
    return v;
  };

  // ── URL：取不到即丢弃。无 URL 的候选连去重的键都没有，比无标题更彻底地不可用
  const rawUrl = pick(spec.urlColumn);
  if (rawUrl === undefined || rawUrl === null || String(rawUrl).trim() === '') {
    note('url_missing');
    return null;
  }

  // ── 标题：取不到即丢弃并记 title_missing（不得以空标题落盘 —— 会污染分组视图与审计链）
  let title;
  let titleDerived = false;
  if (spec.titleColumn) {
    const t = pick(spec.titleColumn);
    if (t !== undefined && t !== null && String(t).trim() !== '') title = String(t).trim();
  } else {
    // titleColumn: null 的适配器（twitter / jike）从正文列截 DERIVED_TITLE_MAX 字符。
    // 这是白名单在标题项上的第三种失败模式：列不存在。显式声明，不让运行时猜。
    for (const col of spec.titleFrom || []) {
      const t = pick(col);
      if (t !== undefined && t !== null && String(t).trim() !== '') {
        title = String(t).trim().slice(0, DERIVED_TITLE_MAX);
        titleDerived = true;
        break;
      }
    }
  }
  if (!title) { note('title_missing'); return null; }

  // ── 热度列：全部缺失时候选保留、降级为无 popularity 的普通候选，但必须告警。
  // 声明为空数组（cnki）是预期的无热度，不算漂移，不记 metric_missing。
  const metrics = {};
  for (const col of spec.metricColumns || []) {
    const v = pick(col);
    if (typeof v === 'number' && Number.isFinite(v)) metrics[col] = v;
  }
  const declaredMetrics = (spec.metricColumns || []).length;
  if (declaredMetrics > 0 && Object.keys(metrics).length === 0) note('metric_missing');

  const secondary = {};
  for (const col of spec.secondaryColumns || []) {
    const v = pick(col);
    if (v !== undefined && isScalar(v) && v !== null && v !== '') secondary[col] = v;
  }

  // ── titleContext：硬截断 100 字符（UTF-16 码元，非字节）。
  // 截断在字符层，不做「取第一句」这类语义处理 —— 语义处理会试图保留完整意思，
  // 那正是滑向正文的机制。
  // 派生标题的适配器不再给这一格：同一条短贴不泄漏两份文本。
  let titleContext;
  if (!titleDerived) {
    for (const col of spec.titleContextFrom || []) {
      const v = pick(col);
      if (typeof v === 'string' && v.trim()) {
        titleContext = v.trim().slice(0, TITLE_CONTEXT_MAX);
        break;
      }
    }
  }

  // 构造新对象 —— 不是 {...row} 再 delete。这一行是整个边界约束的落点。
  return { url: String(rawUrl).trim(), title, titleContext, metrics, secondary };
}

// ──────────────────────────── 本地重排 ────────────────────────────
//
// 当前声明的 52 个适配器中有 7 个带原生热度排序参数，其余 45 个必须本地按热度字段重排
// 或明确声明无热度字段。因此 sortedLocally=true 是常态而非例外。
//
// 【措辞纪律】本地重排的结果只能称「相关结果中较热」，不得称「平台最热」——
// 重排样本是平台按相关性返回的前 N 条，平台上真正最高热的那条可能根本不在这 N 条里。
// searchWindowSize 因此几乎每条候选都必须填。

function rerank(cands, spec) {
  const keys = spec.metricColumns || [];
  const scoreOf = (c) => {
    for (const k of keys) if (typeof c.metrics[k] === 'number') return c.metrics[k];
    return -Infinity;
  };
  const sorted = [...cands].sort((a, b) => scoreOf(b) - scoreOf(a));
  return sorted;
}

export function parseBoundedInteger(raw, name, defaultValue, min, max) {
  if (raw === undefined) return defaultValue;
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}–${max} 的整数`);
  }
  return value;
}

export function parseTiers(raw) {
  const input = raw === undefined ? '1,2,3' : raw;
  if (typeof input !== 'string') {
    throw new Error('tiers 必须是 1、2、3 的不重复逗号分隔列表');
  }
  const parts = input.split(',').map((part) => part.trim());
  const values = parts.map(Number);
  if (!parts.length || parts.some((part) => !part)
    || values.some((value) => !Number.isInteger(value) || value < 1 || value > 3)
    || new Set(values).size !== values.length) {
    throw new Error('tiers 必须是 1、2、3 的不重复逗号分隔列表');
  }
  return new Set(values);
}

export function selectAdaptersForDimensions(adapters, dimensions, tiers) {
  const selected = adapters.filter(
    (adapter) => tiers.has(adapter.tier)
      && adapter.dimensions.some((dimension) => dimensions.includes(dimension)),
  );
  const covered = new Set(selected.flatMap((adapter) => adapter.dimensions));
  const uncovered = dimensions.filter((dimension) => !covered.has(dimension));
  const warnings = uncovered.length
    ? [`维度 [${uncovered.join(', ')}] 在所选 tiers 中无热度适配器覆盖`]
    : [];
  if (!selected.length) warnings.push('所选维度与 tiers 没有可运行的热度适配器');
  return { selected, warnings };
}

export function allSelectedAdaptersEmpty(selected, adapterStats) {
  return selected.length > 0
    && selected.every((adapter) => adapterStats[adapter.site]?.status === 'ok_empty');
}

// ──────────────────────────── search 子命令 ────────────────────────────

export async function searchHotDiscovery(argv, options = {}) {
  const query = argv.query;
  if (!query) fail('search 需要 --query');
  const requestedDims = (argv.dimensions || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!requestedDims.length) fail('search 需要 --dimensions（多维度取并集，不择一）');
  // general 是公共互联网的兜底召回面，即使调用方传入了其他维度，也必须补跑一次。
  const dims = [...new Set([...requestedDims, 'general'])];
  const limit = parseBoundedInteger(argv.limit, 'limit', 20, 1, 100);
  const tiers = parseTiers(argv.tiers);

  const decl = options.declarations || parseDeclarations(await readFile(ADAPTERS_MD, 'utf8'));
  const bycli = options.bycli || createBycliIntegration();

  // 维度取并集：各维度适配器的召回集本就不重叠（openalex 出论文、SO 出技术问答、
  // 虎扑出讨论帖），择一等于人为砍掉召回。
  const { selected, warnings } = selectAdaptersForDimensions(decl.adapters, dims, tiers);

  const adapterStats = {};
  const candidates = [];
  if (!selected.length) {
    return {
      channel: 'hot_discovery',
      query,
      dimensions: requestedDims,
      effectiveDimensions: dims,
      observedAt: new Date().toISOString(),
      bycliVersion: null,
      adaptersSelected: 0,
      candidates,
      adapterStats,
      warnings,
    };
  }
  const runtime = await bycli.loadRuntime({ baselineVersion: BYCLI_BASELINE_VERSION });
  const { catalog, compatibility } = runtime;
  if (compatibility.status !== 'compatible') {
    warnings.push(compatibility.status === 'version_drift'
      ? `bycli 版本 ${compatibility.currentVersion} 与声明基线 ${compatibility.baselineVersion} 不同；已按运行时目录校验，请复核策略和错误协议`
      : '无法读取 bycli 版本；已按运行时目录校验，但无法确认协议基线');
  }

  // ── 预校验：bycli list 能校验站点/命令存在，也能比对声明的列名是否出现在 columns 里。
  // 不一致即说明声明已过期，在跑 search 之前就告警 —— 比事后发现字段缺失更早。
  // 这不能替代运行时告警：columns 有该列仍可能返回 null（github 的 watchers 即是实例）。
  const runnable = [];
  for (const a of selected) {
    const meta = catalog.get(`${a.site}/${a.cmd}`);
    if (!meta) {
      adapterStats[a.site] = { tier: a.tier, status: 'not_in_catalog' };
      warnings.push(`${a.site}/${a.cmd} 不在 bycli list 中 —— 声明已过期或 bycli 版本变化`);
      continue;
    }
    const cols = new Set(meta.columns || []);
    const declaredCols = [a.urlColumn, a.titleColumn, ...(a.titleFrom || []),
      ...(a.metricColumns || []), ...(a.titleContextFrom || [])].filter(Boolean);
    const drifted = declaredCols.filter((c) => !cols.has(c));
    if (drifted.length) {
      warnings.push(`${a.site}: 声明的列 [${drifted.join(', ')}] 不在 bycli columns 中 —— 声明已漂移`);
    }
    // access tier 是本地的凭据/调用策略，浏览器传输方式必须以 bycli 运行时元数据为准。
    const execution = deriveExecutionProfile(meta);
    // 限量参数名校验：bycli list 的 args[].name 是不带 -- 的裸名。
    // 校验失败必须整条跳过而不是照发 —— 未知选项会让适配器以 exit 1 失败，
    // 掩盖真实的 auth_required / rate_limited 状态。
    const limitFlag = a.limitFlag || '--limit';
    const optNames = new Set((meta.args || []).filter((x) => !x.positional).map((x) => x.name));
    if (!optNames.has(limitFlag.replace(/^--/, ''))) {
      adapterStats[a.site] = { tier: a.tier, status: 'limit_flag_missing' };
      warnings.push(`${a.site}: 声明的限量参数 ${limitFlag} 不在该命令选项中（可用：${[...optNames].join(', ') || '无'}）—— 已跳过，请更正 adapters.md 的 limitFlag`);
      continue;
    }
    runnable.push({ ...a, limitFlag, meta, execution, driftedColumns: drifted });
  }

  const buildArgs = (a) => {
    const args = [a.site, a.cmd, query, '-f', 'json'];
    if (a.nativeSort) args.push(a.nativeSort.flag, String(a.nativeSort.value));
    for (const x of a.extraArgs || []) args.push(x);
    // github: --scan 默认 30 且「one API call each」，不传 --scan 以省配额
    // 限量参数名是开放集合（第四次复发：title 列、query 参数、url 列之后）。
    // weread-official 用 --count 而非 --limit；硬编码 --limit 会让它在触及
    // API key 校验之前就以 exit 1 失败，被误判成 command_failed 而非 auth_required。
    args.push(a.limitFlag || '--limit', String(limit));
    return args;
  };

  let requiresUserAction = null;
  const markSkippedForUserAction = (a) => {
    if (!adapterStats[a.site]) {
      adapterStats[a.site] = { tier: a.tier, transport: a.execution.transport, status: 'skipped_user_action' };
    }
  };
  const invoke = async (a) => {
    if (requiresUserAction) {
      markSkippedForUserAction(a);
      return;
    }
    const r = await bycli.invoke('bycli', buildArgs(a), a.tier === 1 ? 60_000 : 120_000);
    const st = { tier: a.tier, transport: a.execution.transport, exitCode: r.code };
    if (a.driftedColumns.length) st.driftedColumns = a.driftedColumns;

    if (r.code !== 0) {
      const errCode = parseBycliErrorCode(r.stderr);
      st.status = classifyFailure(r.code, errCode, r.timedOut);
      st.errorCode = errCode;
      if (r.killed) st.killed = true;
      if (r.rawErrorCode) st.rawErrorCode = r.rawErrorCode;
      // 不兜底、不重试、不降级、不改参数 —— 记入 adapterStats 后跳过。
      // 跳过时不得顺手清理该适配器的浏览器 session（可能停在 login/SSO/MFA 状态）。
      adapterStats[a.site] = st;
      if (['AUTH_REQUIRED', 'BROWSER_CONNECT', 'CAPTCHA', 'RATE_LIMITED', 'ENVIRONMENT_VALIDATION'].includes(errCode)) {
        requiresUserAction = {
          kind: st.status,
          source: a.site,
          errorCode: errCode,
          message: `${a.site} 需要人工处理；已保留已完成候选并停止未启动的适配器。`,
        };
      }
      return;
    }

    let rows;
    try {
      rows = JSON.parse(r.stdout);
    } catch {
      st.status = 'unparseable_stdout';
      adapterStats[a.site] = st;
      return;
    }
    if (!Array.isArray(rows)) { st.status = 'unexpected_shape'; adapterStats[a.site] = st; return; }

    const fieldStats = {};
    let picked = rows.map((row) => extractCandidate(row, a, fieldStats)).filter(Boolean);
    const windowSize = rows.length;   // 本地重排的样本量 = 平台按相关性返回的条数

    const sortedLocally = !a.nativeSort;
    if (sortedLocally && (a.metricColumns || []).length) picked = rerank(picked, a);

    picked.forEach((c, i) => {
      const metricNames = Object.keys(c.metrics);
      const primary = metricNames[0];
      candidates.push({
        url: c.url,
        title: c.title,
        ...(c.titleContext ? { titleContext: c.titleContext } : {}),
        discoveredBy: [`bycli:${a.site}`],
        relevance: null,
        popularity: primary ? {
          source: a.site,
          metric: primary,               // 原始字段名，不翻译不折算
          value: c.metrics[primary],
          allMetrics: c.metrics,
          rankInSource: i + 1,
          sortedLocally,
          searchWindowSize: windowSize,
          ...(Object.keys(c.secondary).length ? { secondary: c.secondary } : {}),
        } : null,
        acquisitionRoute: null,          // 发现阶段一律 null
      });
    });

    // exit 0 + 空数组 ≠ 「该平台没有热门内容」。cookie 档适配器在 session 失效时
    // 也会 exit 0 返回 []（bycli 只在 stderr 提示 empty result，不置错误码），
    // 与「关键词确实无结果」在退出码上不可区分。统一记 ok_empty 交由人判断，
    // 不得让它以 status=ok / candidates=0 冒充「已成功覆盖该平台」。
    st.status = rows.length === 0 ? 'ok_empty' : 'ok';
    st.rows = rows.length;
    st.candidates = picked.length;
    st.sortedLocally = sortedLocally;
    for (const [k, v] of Object.entries(fieldStats)) {
      st[k] = v instanceof Set ? [...v] : v;
    }
    if (st.status === 'ok_empty') {
      warnings.push(`${a.site}: exit 0 但返回 0 行 —— 可能是关键词无结果，也可能是${a.execution.needsBrowser ? '登录态失效' : '站点改版'}，两者在退出码上不可区分，需人工判断`);
    }
    if (fieldStats.metric_missing) {
      warnings.push(`${a.site}: ${fieldStats.metric_missing} 行取不到任何声明的热度列 —— 降级为普通候选`);
    }
    if (fieldStats.title_missing) {
      warnings.push(`${a.site}: ${fieldStats.title_missing} 行取不到 titleColumn —— 已丢弃`);
    }
    if (fieldStats.url_missing) {
      warnings.push(`${a.site}: ${fieldStats.url_missing} 行取不到 urlColumn —— 已丢弃`);
    }
    if (fieldStats.row_shape_unexpected) {
      warnings.push(`${a.site}: ${fieldStats.row_shape_unexpected} 行不是对象 —— 已丢弃`);
    }
    adapterStats[a.site] = st;
  };

  // access tier 只决定是否入选；真实浏览器门禁只看 bycli runtime metadata。
  // 直接传输档按声明顺序执行，确保认证/限流一旦出现就不会再启动后续 adapter。
  const direct = runnable.filter((a) => !a.execution.needsBrowser);
  const browser = runnable.filter((a) => a.execution.needsBrowser);
  for (const a of direct) await invoke(a);

  if (!requiresUserAction && browser.length) {
    const bridge = await bycli.ensureBridge();
    if (!bridge.ok) {
      requiresUserAction = bridge.requiresUserAction;
      for (const a of browser) markSkippedForUserAction(a);
      warnings.push('byCLI 浏览器桥接不可用；已停止浏览器适配器并等待人工恢复。');
    } else {
      for (const a of browser) await invoke(a); // TAB 租约串行，认证失败后不再启动后续 adapter
    }
  } else if (requiresUserAction) {
    for (const a of browser) markSkippedForUserAction(a);
  }
  if (allSelectedAdaptersEmpty(selected, adapterStats)) {
    warnings.push('热度通道无覆盖 —— 所有已选适配器均返回 0 行');
  }

  return {
    channel: 'hot_discovery',
    query,
    dimensions: requestedDims,
    effectiveDimensions: dims,
    // 热度值是时点观测，跨时间比较无意义。报告引用热度时须一并给出观测时间。
    observedAt: new Date().toISOString(),
    bycliVersion: compatibility.currentVersion,
    bycliCompatibility: compatibility,
    adaptersSelected: selected.length,
    candidates,
    adapterStats,
    warnings,
    ...(requiresUserAction ? { requiresUserAction } : {}),
  };
}

// ──────────────────────────── merge 子命令 ────────────────────────────
//
// 为什么 merge 必须在脚本里而非交给 Agent：URL 规范化与去重必须在同一处执行。分到两侧
// 各做一次，同一 URL 会得到两种规范化结果，去重直接失效 —— 而「双通道命中」
// (discoveredBy.length > 1) 这个核心判定完全依赖去重正确。
//
// merge 只读 searxng 的输出文件，不执行 searxng。

/**
 * searxng 的 content 原样保留，落为 searxngContent，不截断、不改名语义。
 *
 * 【为什么不与 titleContext 对齐截断】searxng 的 content 是既有能力，上一轮 42→7 的候选
 * 筛选正是靠它做的（排除 ai.ch 这个仅域名含 ai 的州官网、两篇无关医学论文，都依赖 snippet
 * 而非标题）。把它截到 100 字符等于为了通道间对称去砍一个已在用的东西。
 *
 * 【为什么这不违反白名单】白名单约束的对象是 bycli 支路，理由是 bycli 适配器的正文列能让
 * 发现通道变成事实上的取内容通道。searxng 不存在这个问题 —— 它本来就只返回引擎给的摘要，
 * 拿不到全文。两个通道的风险面不同，规则不必相同。
 *
 * 【但下游规则相同】searxngContent 与 titleContext 同样不得写入 collectionFilters、
 * 不得作为 citations 依据、不得进最终报告。它更长，泄漏后果更大。
 */
function fromSearxng(doc, queryVerified) {
  const candidates = [];
  let invalidRows = 0;
  const rows = isRecord(doc) && Array.isArray(doc.results) ? doc.results : [];
  for (const [i, r] of rows.entries()) {
    if (!isRecord(r) || typeof r.url !== 'string' || !r.url.trim()) {
      invalidRows += 1;
      continue;
    }
    const engines = typeof r.engine === 'string' ? r.engine.split(',') : ['searxng'];
    const parsedSources = engines.map((e) => e.trim()).filter(Boolean).map((e) => `searxng:${e}`);
    const discoveredBy = parsedSources.length ? parsedSources : ['searxng:searxng'];
    candidates.push({
      url: r.url,
      title: typeof r.title === 'string' ? r.title : '',
      ...(typeof r.content === 'string' && r.content ? { searxngContent: r.content } : {}),
      discoveredBy,
      _verifiedDiscoveredBy: queryVerified ? discoveredBy : [],
      relevance: {
        searxngScore: typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : null,
        searxngRank: i + 1,
      },
      popularity: null,
      acquisitionRoute: null,
    });
  }
  return { candidates, invalidRows };
}

function fromAgentReach(doc, queryVerified) {
  const rows = Array.isArray(doc) ? doc
    : (isRecord(doc) && Array.isArray(doc.results) ? doc.results
      : (isRecord(doc) && Array.isArray(doc.candidates) ? doc.candidates : []));
  const candidates = [];
  let invalidRows = 0;
  for (const r of rows) {
    if (!isRecord(r) || typeof r.url !== 'string' || !r.url.trim()) {
      invalidRows += 1;
      continue;
    }
    const discoveredBy = [typeof r.source === 'string' && r.source.trim()
      ? `agent-reach:${r.source.trim()}` : 'agent-reach'];
    candidates.push({
      url: r.url,
      title: typeof r.title === 'string' ? r.title : '',
      discoveredBy,
      _verifiedDiscoveredBy: queryVerified ? discoveredBy : [],
      relevance: null,
      popularity: null,
      acquisitionRoute: null,
    });
  }
  return { candidates, invalidRows };
}

const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function scalarMap(value, numbersOnly = false) {
  if (!isRecord(value)) return {};
  const entries = [];
  for (const [key, item] of Object.entries(value)) {
    if (!key || !isScalar(item) || item === null) continue;
    if (typeof item === 'number' && !Number.isFinite(item)) continue;
    if (numbersOnly && typeof item !== 'number') continue;
    entries.push([key, item]);
  }
  return Object.fromEntries(entries);
}

function sanitizeHotCandidate(candidate, normalizer, queryVerified) {
  if (!isRecord(candidate) || typeof candidate.url !== 'string' || !normalizer(candidate.url)) return null;
  if (typeof candidate.title !== 'string' || !candidate.title.trim()) return null;

  const discoveredBy = Array.isArray(candidate.discoveredBy)
    ? [...new Set(candidate.discoveredBy
      .filter((v) => typeof v === 'string' && /^bycli:[^:\s]+$/.test(v.trim()))
      .map((v) => v.trim()))]
    : [];
  if (!discoveredBy.length) return null;

  let popularity = null;
  if (candidate.popularity !== undefined && candidate.popularity !== null) {
    if (!isRecord(candidate.popularity)
      || typeof candidate.popularity.source !== 'string' || !candidate.popularity.source.trim()
      || !discoveredBy.includes(`bycli:${candidate.popularity.source.trim()}`)
      || typeof candidate.popularity.metric !== 'string' || !candidate.popularity.metric.trim()
      || typeof candidate.popularity.value !== 'number' || !Number.isFinite(candidate.popularity.value)
      || !Number.isInteger(candidate.popularity.rankInSource) || candidate.popularity.rankInSource < 1
      || !Number.isInteger(candidate.popularity.searchWindowSize) || candidate.popularity.searchWindowSize < 1
      || candidate.popularity.rankInSource > candidate.popularity.searchWindowSize
      || typeof candidate.popularity.sortedLocally !== 'boolean') {
      return null;
    }
    const metric = candidate.popularity.metric.trim();
    const allMetrics = Object.fromEntries([
      ...Object.entries(scalarMap(candidate.popularity.allMetrics, true)),
      [metric, candidate.popularity.value],
    ]);
    const secondary = scalarMap(candidate.popularity.secondary);
    popularity = {
      source: candidate.popularity.source.trim(),
      metric,
      value: candidate.popularity.value,
      allMetrics,
      rankInSource: candidate.popularity.rankInSource,
      sortedLocally: candidate.popularity.sortedLocally,
      searchWindowSize: candidate.popularity.searchWindowSize,
      ...(Object.keys(secondary).length ? { secondary } : {}),
    };
  }

  const titleContext = typeof candidate.titleContext === 'string'
    ? candidate.titleContext.trim().slice(0, TITLE_CONTEXT_MAX) : '';
  return {
    url: candidate.url,
    title: candidate.title.trim(),
    ...(titleContext ? { titleContext } : {}),
    discoveredBy,
    _verifiedDiscoveredBy: queryVerified ? discoveredBy : [],
    relevance: null,
    popularity,
    acquisitionRoute: null,
  };
}

const ADAPTER_STAT_SCALAR_KEYS = new Set([
  'tier', 'transport', 'status', 'exitCode', 'errorCode', 'rawErrorCode', 'rows', 'candidates',
  'sortedLocally', 'killed', 'shape_unexpected', 'row_shape_unexpected',
  'metric_missing', 'title_missing', 'url_missing',
]);
const ADAPTER_STAT_ARRAY_KEYS = new Set(['driftedColumns', 'shapeUnexpectedFields']);

function sanitizeAdapterStats(value) {
  if (!isRecord(value)) return {};
  const sites = [];
  for (const [site, rawStats] of Object.entries(value)) {
    if (!site || !isRecord(rawStats)) continue;
    const fields = [];
    for (const [key, item] of Object.entries(rawStats)) {
      if (ADAPTER_STAT_SCALAR_KEYS.has(key) && isScalar(item)) {
        if (typeof item === 'number' && !Number.isFinite(item)) continue;
        fields.push([key, typeof item === 'string' ? item.slice(0, 300) : item]);
      } else if (ADAPTER_STAT_ARRAY_KEYS.has(key) && Array.isArray(item)) {
        fields.push([key, item.filter((v) => typeof v === 'string').slice(0, 100).map((v) => v.slice(0, 200))]);
      }
    }
    sites.push([site, Object.fromEntries(fields)]);
  }
  return Object.fromEntries(sites);
}

export async function readJsonIfGiven(p, label) {
  if (!p) return { doc: null, warning: null };
  try {
    return { doc: JSON.parse(await readFile(p, 'utf8')), warning: null };
  } catch (e) {
    return { doc: null, warning: `${label} 读取或解析失败 —— 已忽略该输入：${e.message}` };
  }
}

export function mergeDocuments({
  hotDoc, sxDoc, arDoc, normalizer, identityNormalizer = normalizer,
  groupLimit = 5, searxngLimit = 20,
  agentReachLimit = 20, unverifiedLimit = 20, unrankedHotLimit = 20, inputWarnings = [],
}) {
  const hotProvided = hotDoc !== null && hotDoc !== undefined;
  const sxProvided = sxDoc !== null && sxDoc !== undefined;
  const arProvided = arDoc !== null && arDoc !== undefined;
  const invalidHotDoc = hotProvided && (!isRecord(hotDoc) || !Array.isArray(hotDoc.candidates));
  const invalidSearxngDoc = sxProvided && (!isRecord(sxDoc) || !Array.isArray(sxDoc.results));
  const invalidAgentReachDoc = arProvided && !Array.isArray(arDoc)
    && (!isRecord(arDoc) || (!Array.isArray(arDoc.results) && !Array.isArray(arDoc.candidates)));
  const hotQuery = !invalidHotDoc && typeof hotDoc?.query === 'string' ? hotDoc.query.trim() : '';
  const sxQuery = !invalidSearxngDoc && typeof sxDoc?.query === 'string' ? sxDoc.query.trim() : '';
  const arQuery = !invalidAgentReachDoc && typeof arDoc?.query === 'string' ? arDoc.query.trim() : '';
  const normalizeQuery = (q) => q.replace(/\s+/g, ' ').toLocaleLowerCase();
  const canonicalQuery = hotQuery || sxQuery || arQuery;
  const queryMatches = (query) => Boolean(query && canonicalQuery
    && normalizeQuery(query) === normalizeQuery(canonicalQuery));
  const hotQueryMismatch = Boolean(hotQuery && !queryMatches(hotQuery));
  const sxQueryMismatch = Boolean(sxQuery && !queryMatches(sxQuery));
  const arQueryMismatch = Boolean(arQuery && !queryMatches(arQuery));
  const observedAt = !invalidHotDoc && typeof hotDoc?.observedAt === 'string'
    && Number.isFinite(Date.parse(hotDoc.observedAt))
    ? hotDoc.observedAt : new Date().toISOString();
  const adapterStats = invalidHotDoc ? {} : sanitizeAdapterStats(hotDoc?.adapterStats);
  const hotWarnings = invalidHotDoc || !Array.isArray(hotDoc?.warnings) ? []
    : hotDoc.warnings.filter((w) => typeof w === 'string').slice(0, 500).map((w) => w.slice(0, 1000));
  const hotRows = hotDoc && Array.isArray(hotDoc.candidates) ? hotDoc.candidates : [];
  const hotCandidates = hotRows
    .map((candidate) => sanitizeHotCandidate(candidate, normalizer, queryMatches(hotQuery)))
    .filter(Boolean);
  const invalidHotCandidates = hotRows.length - hotCandidates.length;
  const sxConverted = !invalidSearxngDoc && sxProvided && !sxQueryMismatch
    ? fromSearxng(sxDoc, queryMatches(sxQuery)) : { candidates: [], invalidRows: 0 };
  const arConverted = !invalidAgentReachDoc && arProvided && !arQueryMismatch
    ? fromAgentReach(arDoc, queryMatches(arQuery)) : { candidates: [], invalidRows: 0 };
  const incoming = [
    ...(!hotQueryMismatch ? hotCandidates : []),
    ...sxConverted.candidates,
    ...arConverted.candidates,
  ];

  const byKey = new Map();
  let unnormalizable = 0;
  for (const c of incoming) {
    const key = identityNormalizer(c.url);
    const publicUrl = normalizer(c.url);
    if (!key || !publicUrl) { unnormalizable += 1; continue; }
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        ...c, url: publicUrl, _dedupKey: key, _popularities: c.popularity ? [c.popularity] : [],
      });
      continue;
    }
    // 合并 discoveredBy —— 这是「双通道命中」判定的唯一依据
    prev.discoveredBy = [...new Set([...prev.discoveredBy, ...c.discoveredBy])];
    prev._verifiedDiscoveredBy = [...new Set([
      ...(prev._verifiedDiscoveredBy || []), ...(c._verifiedDiscoveredBy || []),
    ])];
    if (c.popularity) prev._popularities.push(c.popularity);
    if (!prev.title && c.title) prev.title = c.title;
    // 两个通道各自的判断依据都保留：字段名不同，不互相覆盖
    if (c.titleContext && !prev.titleContext) prev.titleContext = c.titleContext;
    if (c.searxngContent && !prev.searxngContent) prev.searxngContent = c.searxngContent;
    if (c.relevance && !prev.relevance) prev.relevance = c.relevance;
  }

  const all = [...byKey.values()];
  for (const candidate of all) {
    candidate.discoveredBy.sort();
    candidate._verifiedDiscoveredBy.sort();
    const popularityBySourceMetric = new Map();
    for (const popularity of candidate._popularities) {
      const key = `${popularity.source}\u0000${popularity.metric}`;
      const previous = popularityBySourceMetric.get(key);
      if (!previous || popularity.rankInSource < previous.rankInSource) {
        popularityBySourceMetric.set(key, popularity);
      }
    }
    const popularities = [...popularityBySourceMetric.values()]
      .sort((a, b) => a.source.localeCompare(b.source) || a.metric.localeCompare(b.metric));
    candidate.popularity = popularities[0] || null;
    if (popularities.length > 1) candidate.popularities = popularities;
    delete candidate._popularities;
  }

  // ── 分组视图。不做跨平台加权 —— metric 不可比（downloads 8400000 与 citations 1284
  // 放在一起折算是无意义的），所以不造统一热度分。
  const bothChannels = all.filter((c) => {
    const sources = c._verifiedDiscoveredBy || [];
    const hasHot = sources.some((source) => source.startsWith('bycli:'));
    const hasRelevant = sources.some((source) => source.startsWith('searxng:')
      || source === 'agent-reach' || source.startsWith('agent-reach:'));
    return Boolean(c.popularity && hasHot && hasRelevant);
  });
  const bothSet = new Set(bothChannels.map((c) => c._dedupKey));
  for (const candidate of all) {
    const verified = [...new Set(candidate._verifiedDiscoveredBy || [])].sort();
    const verifiedSet = new Set(verified);
    const unverified = candidate.discoveredBy.filter((source) => !verifiedSet.has(source)).sort();
    candidate.discoveredBy = verified;
    if (unverified.length) candidate.unverifiedDiscoveredBy = unverified;
    delete candidate._verifiedDiscoveredBy;
  }

  const searxngTop = all
    .filter((c) => c.relevance && !bothSet.has(c._dedupKey)
      && c.discoveredBy.some((source) => source.startsWith('searxng:')))
    .sort((a, b) => (a.relevance.searxngRank || 1e9) - (b.relevance.searxngRank || 1e9));
  const agentReachTop = all.filter((c) => !bothSet.has(c._dedupKey)
    && !c.discoveredBy.some((source) => source.startsWith('searxng:'))
    && c.discoveredBy.some((source) => source === 'agent-reach' || source.startsWith('agent-reach:')));
  const hotWithoutPopularity = all.filter((c) => !bothSet.has(c._dedupKey) && !c.popularity
    && c.discoveredBy.some((source) => source.startsWith('bycli:'))
    && !c.discoveredBy.some((source) => source.startsWith('searxng:')
      || source === 'agent-reach' || source.startsWith('agent-reach:')));
  const unverified = all.filter((c) => c.discoveredBy.length === 0);

  const bySource = new Map();
  for (const c of all) {
    if (!c.popularity || bothSet.has(c._dedupKey)
      || !c.discoveredBy.some((source) => source.startsWith('bycli:'))) continue;
    const popularities = c.popularities || [c.popularity];
    const bestPopularityBySource = new Map();
    for (const popularity of popularities) {
      const previous = bestPopularityBySource.get(popularity.source);
      if (!previous || popularity.rankInSource < previous.rankInSource
        || (popularity.rankInSource === previous.rankInSource
          && popularity.metric.localeCompare(previous.metric) < 0)) {
        bestPopularityBySource.set(popularity.source, popularity);
      }
    }
    for (const popularity of bestPopularityBySource.values()) {
      if (!c.discoveredBy.includes(`bycli:${popularity.source}`)) continue;
      const sourceRows = bySource.get(popularity.source) || [];
      const groupedCandidate = { ...c, popularity };
      delete groupedCandidate._dedupKey;
      sourceRows.push(groupedCandidate);
      bySource.set(popularity.source, sourceRows);
    }
  }
  const hotBySource = Object.fromEntries([...bySource.entries()].map(([src, arr]) => [src, arr
      .sort((a, b) => (a.popularity.rankInSource || 1e9) - (b.popularity.rankInSource || 1e9))
      .slice(0, groupLimit)]));
  for (const candidate of all) delete candidate._dedupKey;

  return {
    observedAt,
    query: canonicalQuery || null,
    totals: {
      incoming: incoming.length,
      afterDedup: all.length,
      dedupedAway: incoming.length - all.length - unnormalizable,
      unnormalizable,
      bothChannels: bothChannels.length,
    },
    groups: {
      bothChannels,                      // 最高优先级：既被多引擎相关性捞到，又在垂直平台高热
      searxngTop: searxngTop.slice(0, searxngLimit),
      agentReachTop: agentReachTop.slice(0, agentReachLimit),
      hotBySource,
      hotWithoutPopularity: hotWithoutPopularity.slice(0, unrankedHotLimit),
      unverified: unverified.slice(0, unverifiedLimit),
    },
    adapterStats,
    warnings: [
      ...inputWarnings.filter((w) => typeof w === 'string'),
      ...hotWarnings,
      ...(sxProvided ? [] : ['searxng 通道缺失 —— 热度结果仍可用，但相关性通道未参与']),
      ...(invalidHotDoc ? ['hot-file 结构无效 —— 已忽略该通道'] : []),
      ...(invalidSearxngDoc ? ['searxng-file 结构无效 —— 已忽略该通道'] : []),
      ...(invalidAgentReachDoc ? ['agent-reach-file 结构无效 —— 已忽略该通道'] : []),
      ...(sxQueryMismatch ? ['查询不一致 —— 已隔离 searxng 通道，禁止跨快照合并'] : []),
      ...(arQueryMismatch ? ['查询不一致 —— 已隔离 agent-reach 通道，禁止跨快照合并'] : []),
      ...(!invalidHotDoc && hotDoc !== null && hotDoc !== undefined && !hotQuery
        ? ['hot-file 缺少 query —— 候选保留但不参与双通道命中'] : []),
      ...(!invalidSearxngDoc && sxDoc !== null && sxDoc !== undefined && !sxQuery
        ? ['searxng-file 缺少 query —— 候选保留但不参与双通道命中'] : []),
      ...(!invalidAgentReachDoc && arDoc !== null && arDoc !== undefined && !arQuery
        ? ['agent-reach-file 缺少 query —— 候选保留但不参与双通道命中'] : []),
      ...(invalidHotCandidates
        ? [`hot-file 有 ${invalidHotCandidates} 条候选不符合 schema，已丢弃`] : []),
      ...(sxConverted.invalidRows
        ? [`searxng-file 有 ${sxConverted.invalidRows} 行不符合 schema，已丢弃`] : []),
      ...(arConverted.invalidRows
        ? [`agent-reach-file 有 ${arConverted.invalidRows} 行不符合 schema，已丢弃`] : []),
      ...(unnormalizable ? [`${unnormalizable} 条 URL 无法规范化，已丢弃`] : []),
    ],
    // 已知缺口：等价路径变体（/tree/master 与仓库根）不对齐，无通用规则可判同一资源
    knownGaps: ['equivalent-path-variants-not-merged'],
  };
}

async function cmdMerge(argv) {
  const decl = parseDeclarations(await readFile(ADAPTERS_MD, 'utf8'));
  const normalizer = (u) => normalizeUrl(u, decl);
  const identityNormalizer = (u) => normalizeUrl(u, decl);
  const [hotInput, sxInput, arInput] = await Promise.all([
    readJsonIfGiven(argv['hot-file'], 'hot-file'),
    readJsonIfGiven(argv['searxng-file'], 'searxng-file'),
    readJsonIfGiven(argv['agent-reach-file'], 'agent-reach-file'),
  ]);
  const groupLimit = parseBoundedInteger(argv['group-limit'], 'group-limit', 5, 1, 100);
  const searxngLimit = parseBoundedInteger(argv['searxng-limit'], 'searxng-limit', 20, 1, 1000);
  const agentReachLimit = parseBoundedInteger(
    argv['agent-reach-limit'], 'agent-reach-limit', 20, 1, 1000,
  );
  const unverifiedLimit = parseBoundedInteger(
    argv['unverified-limit'], 'unverified-limit', 20, 1, 1000,
  );
  const unrankedHotLimit = parseBoundedInteger(
    argv['unranked-hot-limit'], 'unranked-hot-limit', 20, 1, 1000,
  );
  return mergeDocuments({
    hotDoc: hotInput.doc,
    sxDoc: sxInput.doc,
    arDoc: arInput.doc,
    normalizer,
    identityNormalizer,
    groupLimit,
    searxngLimit,
    agentReachLimit,
    unverifiedLimit,
    unrankedHotLimit,
    inputWarnings: [hotInput.warning, sxInput.warning, arInput.warning].filter(Boolean),
  });
}

// ──────────────────────────── CLI ────────────────────────────

function fail(msg) {
  process.stderr.write(`hot_discovery: ${msg}\n`);
  process.exit(2);
}

function parseArgv(list) {
  const out = { _: [] };
  for (let i = 0; i < list.length; i += 1) {
    const t = list[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const nxt = list[i + 1];
      if (nxt === undefined || nxt.startsWith('--')) out[k] = true;
      else { out[k] = nxt; i += 1; }
    } else out._.push(t);
  }
  return out;
}

const USAGE = `hot_discovery.mjs — 热度发现通道（只发现 URL 与热度字段，不取正文）

  search --query "<q>" --dimensions a,b [--limit 20] [--tiers 1,2,3]
  merge  --hot-file <f> [--searxng-file <f>] [--agent-reach-file <f>]
         [--group-limit 5] [--searxng-limit 20] [--agent-reach-limit 20]
         [--unverified-limit 20] [--unranked-hot-limit 20]
         [--group-limit 5] [--searxng-limit 20]

通用： [--out <file>]  结果同时写入该文件（供 .post-processing-inputs/ 快照）
`;

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const argv = parseArgv(rest);
  if (!sub || sub === '--help' || sub === '-h') { process.stdout.write(USAGE); return; }

  let result;
  if (sub === 'search') result = await searchHotDiscovery(argv);
  else if (sub === 'merge') result = await cmdMerge(argv);
  else fail(`未知子命令 "${sub}"\n${USAGE}`);

  const json = JSON.stringify(result, null, 2);
  process.stdout.write(`${json}\n`);
  // 快照落盘由编排层决定路径。注意：init 必须先于此步 —— init 要求目标目录不存在或为空，
  // 而 .post-processing-inputs/ 由 init 内部以 0700 创建。先写快照会让 init 直接失败。
  // 命名须避开 items.json / run.json / m.json，以免被误传给 collect --item-json-file。
  if (typeof argv.out === 'string') await writeFile(argv.out, `${json}\n`, 'utf8');
}

const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((e) => { process.stderr.write(`hot_discovery: ${e.message}\n`); process.exit(1); });
}
