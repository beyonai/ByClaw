#!/usr/bin/env node
/**
 * research-state.mjs — 深化研究方法的状态机(deep_research.py 的 JS 等价平替)。
 *
 * 本模块不做研究,只管理持久状态: 初始化任务、记录计划、登记分支(learnings/citations)、
 * 聚合去重、标记报告完成并渲染研究树。研究判断(搜什么、什么相关、学到什么、怎么写报告)
 * 全部由 Agent 负责,与上游 deep-research 技能语义一致。
 *
 * 防编造护栏:
 * - branch 的 sources 必须已登记在 collection inventory(sourceUrl)或此前的 visitedUrls;
 * - citations 的 value 必须是 inventory itemId 或 sourceUrl;
 * - report 要求至少一个 branch;未达到配置 depth 时必须显式给出 stop-reason;
 * - init 校验所有数值参数,拒绝 NaN/负数/越界。
 */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  requireString,
  readJson,
  atomicWriteJson,
  sessionPaths,
  loadSession,
  persistSession,
  assertNoSensitiveKeys,
  withSessionLock,
  ensureSessionSkeleton,
  isInside,
} from './session.mjs';

export const DEFAULTS = {
  breadth: 3,
  depth: 2,
  concurrency: 2,
  maxContextWords: 25000,
};
export const TREE_FILENAME = 'research-tree.md';
export const REPORT_FILENAME = 'report.md';
const BRANCH_STATUSES = new Set(['done', 'pending', 'failed']);
const TASK_MODES = new Set(['research', 'collection']);

function parseJsonArg(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`无效 JSON 参数: ${error.message}`);
  }
}

function asList(value, name) {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  throw new Error(`${name} 必须是 JSON 数组`);
}

function asDict(value, name) {
  if (value === undefined || value === null) {
    return {};
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  throw new Error(`${name} 必须是 JSON 对象`);
}

function positiveInt(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = typeof value === 'string' ? value.trim() : value;
  let parsed;
  if (typeof raw === 'number') {
    parsed = raw;
  } else if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    parsed = Number(raw);
  } else {
    throw new Error(`${label} 必须是正整数`);
  }
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} 必须在 ${min} 到 ${max} 之间`);
  }
  return parsed;
}

function optionalPositiveInt(value, label, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return positiveInt(value, label, { min: 1, max });
}

function asBool(value, label) {
  if (value === undefined || value === null || value === true || value === false) {
    return Boolean(value);
  }
  if (value === 'true' || value === '1') {
    return true;
  }
  if (value === 'false' || value === '0') {
    return false;
  }
  throw new Error(`${label} 必须是布尔值`);
}

function nonEmptyStringList(value, label) {
  const items = asList(value, label);
  for (const item of items) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${label} 必须是非空字符串数组`);
    }
  }
  return items;
}

/** 深化研究的三个发现通道；plan 必须为每个通道显式表态。 */
const DISCOVERY_CHANNELS = ['builtin-routing', 'searxng', 'hot-discovery'];
const CHANNEL_STATES = ['used', 'unavailable', 'not-applicable'];
/** 「命令跑通了所以不用读文档」这类自我豁免的常见措辞，一律拒收。 */
const VAGUE_REASON_PATTERN = /^(skip|skipped|n\/?a|none|no|未用|没用|跳过|不需要|无需|不适用|忽略|略)$/i;

/**
 * 校验 plan 的通道覆盖表。三通道各自必须是 used，或给出 unavailable/not-applicable + 具体 reason。
 * 目的：让「漏跑某个发现通道」在 plan 阶段就报错，而不是等到报告写完才在覆盖缺口里补一句。
 *
 * **先验证再排除原则**: non-`used` 的 reason 必须基于实际验证(已通读完整 SKILL.md 或已尝试调用),
 * 而非主观推测。错误示例："B2B SaaS 不会出现在热度平台"(未验证 hot_discovery 是否有 HN/Reddit/PH)；
 * 正确示例："hot_discovery --query 'Lightfield' 返回 0 results,三维度均无命中"。
 */
function validateChannels(value) {
  const dict = asDict(value, 'channels');
  const missing = DISCOVERY_CHANNELS.filter((name) => dict[name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `plan --channels 缺少通道: ${missing.join(', ')}。三个发现通道必须逐个表态：`
      + `{"builtin-routing":{"state":"used"},"searxng":{"state":"used"},"hot-discovery":{"state":"unavailable","reason":"..."}}。`
      + 'state 取值 used | unavailable | not-applicable；后两者必须带具体 reason。'
      + '若尚未确认某通道能力边界，先通读其 SKILL.md（hot-discovery 见 online_search/references/hot_discovery/SKILL.md），'
      + '或尝试调用并用实际结果作为排除依据，而非基于推测',
    );
  }
  const unknown = Object.keys(dict).filter((name) => !DISCOVERY_CHANNELS.includes(name));
  if (unknown.length > 0) {
    throw new Error(`plan --channels 含未知通道: ${unknown.join(', ')}；合法通道为 ${DISCOVERY_CHANNELS.join(', ')}`);
  }
  const normalized = {};
  for (const name of DISCOVERY_CHANNELS) {
    const entry = asDict(dict[name], `channels.${name}`);
    const state = typeof entry.state === 'string' ? entry.state.trim() : '';
    if (!CHANNEL_STATES.includes(state)) {
      throw new Error(`channels.${name}.state 必须是 ${CHANNEL_STATES.join(' | ')}，实际: ${JSON.stringify(entry.state)}`);
    }
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    if (state !== 'used') {
      if (!reason) {
        throw new Error(
          `channels.${name}.state=${state} 必须带 reason，说明是「环境不可用」还是「本主题不适用」。`
          + '**先验证再排除**: reason 必须基于实际调用结果或完整 SKILL.md 验证，而非主观推测。'
          + '错误示例: "不适合本主题"(未说明如何确认)；正确示例: "已通读 SKILL.md,9 个维度均不覆盖本主题" 或 "调用返回 0 results"',
        );
      }
      if (VAGUE_REASON_PATTERN.test(reason) || reason.length < 8) {
        throw new Error(
          `channels.${name}.reason 过于笼统: ${JSON.stringify(reason)}；需写明具体原因。`
          + '环境限制示例: "mcporter 未安装，Exa 通道不可用"；主题不适用示例: "已通读 hot_discovery SKILL.md，'
          + '9 个维度(packages/science/...)均不覆盖本主题，且调用返回 0 results"。'
          + '禁止仅凭片面认知就排除(如"只看到 apps 维度有 flathub/steam,认为 B2B SaaS 不适用"——未验证是否有 HN/Reddit/PH 讨论)',
        );
      }
    }
    normalized[name] = state === 'used' ? { state } : { state, reason };
  }
  return normalized;
}

function validateLevel(session, level) {
  const depth = session.task.depth ?? DEFAULTS.depth;
  if (!Number.isInteger(level) || level < 1) {
    throw new Error('level 必须是 >= 1 的整数');
  }
  if (level > depth) {
    throw new Error(`level ${level} 超过配置深度 ${depth}`);
  }
}

function appendUnique(items, newItems) {
  const seen = new Set();
  const result = [];
  for (const item of [...items, ...newItems]) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function mergeCitations(oldCitations, newCitations) {
  const merged = { ...oldCitations };
  for (const [key, value] of Object.entries(newCitations)) {
    if (!(key in merged)) {
      merged[key] = value;
    }
  }
  return merged;
}

function segmentWords(text) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      return [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(text)]
        .filter((segment) => segment.isWordLike).length;
    } catch {
      // fall through to whitespace count
    }
  }
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function wordCount(text) {
  if (Array.isArray(text)) {
    text = text.join(' ');
  }
  return segmentWords(String(text ?? '').trim());
}

function trimContext(context, maxWords) {
  let total = 0;
  const trimmed = [];
  for (const item of [...context].reverse()) {
    const count = wordCount(item);
    if (total + count <= maxWords) {
      trimmed.unshift(item);
      total += count;
    } else if (!trimmed.length) {
      const text = String(item);
      const words = [];
      if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        for (const segment of new Intl.Segmenter('zh', { granularity: 'word' }).segment(text)) {
          if (segment.isWordLike) {
            words.push(segment.segment);
            if (words.length >= maxWords) {
              break;
            }
          }
        }
      }
      trimmed.unshift(words.length ? words.join('') : text.trim().split(/\s+/).slice(0, maxWords).join(' '));
      break;
    } else {
      break;
    }
  }
  return trimmed;
}

function knownSourceUrls(session) {
  const known = new Set();
  for (const item of session?.collection?.collection?.items || []) {
    if (typeof item?.sourceUrl === 'string' && item.sourceUrl.trim()) {
      known.add(item.sourceUrl.trim());
    }
  }
  for (const source of session?.research?.visitedUrls || []) {
    if (typeof source === 'string' && source.trim()) {
      known.add(source.trim());
    }
  }
  return known;
}

function knownItemIds(session) {
  return new Set((session?.collection?.collection?.items || [])
    .map((item) => item?.itemId)
    .filter((itemId) => typeof itemId === 'string' && itemId));
}

function validateCitations(session, citations, status) {
  const keys = Object.keys(citations || {});
  if (status === 'done' && keys.length === 0) {
    throw new Error('status=done 的分支必须至少提供一个 citation');
  }
  const itemIds = knownItemIds(session);
  const sourceUrls = knownSourceUrls(session);
  for (const [key, value] of Object.entries(citations || {})) {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('citation key 必须是非空字符串');
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`citation ${key} 的值必须是非空 itemId 或 sourceUrl`);
    }
    if (!itemIds.has(value) && !sourceUrls.has(value)) {
      throw new Error(`citation ${key} 指向未登记的来源: ${value}。请先经 collect 登记该来源`);
    }
  }
}

function validateSources(session, sources, status) {
  if (status === 'done' && sources.length === 0) {
    throw new Error('status=done 的分支必须至少登记一个已采集 source');
  }
  const sourceUrls = knownSourceUrls(session);
  for (const source of sources) {
    if (typeof source !== 'string' || !source.trim()) {
      throw new Error('sources 必须是非空字符串数组');
    }
    if (!sourceUrls.has(source.trim())) {
      throw new Error(`source 未登记在 inventory: ${source}。请先经 collect 登记该来源`);
    }
  }
}

function validateSearchQueries(session, searchQueries) {
  for (const entry of searchQueries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('searchQueries 每项必须是对象');
    }
    if (typeof entry.query !== 'string' || !entry.query.trim()) {
      throw new Error('searchQueries[].query 必须是非空字符串');
    }
    for (const field of ['skill', 'engine', 'status']) {
      if (entry[field] !== undefined && (typeof entry[field] !== 'string' || !entry[field].trim())) {
        throw new Error(`searchQueries[].${field} 必须是非空字符串`);
      }
    }
    if (entry.resultCount !== undefined && (!Number.isInteger(entry.resultCount) || entry.resultCount < 0)) {
      throw new Error('searchQueries[].resultCount 必须是非负整数');
    }
  }
}

function assertWithinBudget(session, { branchCount = session.research.branches.length } = {}) {
  const maxBranches = session.task.maxBranches;
  if (maxBranches !== null && maxBranches !== undefined && branchCount >= maxBranches) {
    throw new Error(`研究分支预算已用尽: maxBranches=${maxBranches}`);
  }
  const deadline = session.task.deadlineMinutes;
  if (deadline !== null && deadline !== undefined) {
    const startedAt = Date.parse(session.task.startedAt || '');
    if (Number.isFinite(startedAt)) {
      const remaining = deadline * 60 * 1000 - (Date.now() - startedAt);
      if (remaining <= 0) {
        throw new Error(`研究时间预算已用尽: deadlineMinutes=${deadline}。请 aggregate 并 report`);
      }
    }
  }
}

function renderTree(session) {
  const lines = [];
  lines.push('# Research Tree');
  lines.push('');
  lines.push(`研究问题：${session.task.query || ''}`);
  lines.push(
    `参数：breadth=${session.task.breadth}，depth=${session.task.depth}，`
    + `concurrency=${session.task.concurrency}，max_context_words=${session.task.maxContextWords}`
    + `${session.task.deadlineMinutes ? `，deadline_minutes=${session.task.deadlineMinutes}` : ''}`
    + `${session.task.maxBranches ? `，max_branches=${session.task.maxBranches}` : ''}`,
  );
  if (session.task.combinedQuery) {
    lines.push('');
    lines.push('## Combined Starting Query');
    lines.push('');
    lines.push(String(session.task.combinedQuery));
  }
  const byLevel = new Map();
  for (const branch of session.research.branches) {
    if (branch && typeof branch === 'object') {
      const level = Number(branch.level ?? 1);
      if (!byLevel.has(level)) {
        byLevel.set(level, []);
      }
      byLevel.get(level).push(branch);
    }
  }
  for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
    lines.push('');
    lines.push(`## Level ${level}`);
    for (const branch of byLevel.get(level)) {
      lines.push('');
      lines.push(`### ${branch.id || 'branch'}`);
      if (branch.parentId) {
        lines.push(`- parent: ${branch.parentId}`);
      }
      if (branch.query) {
        lines.push(`- Query: ${branch.query}`);
      }
      if (branch.researchGoal) {
        lines.push(`- researchGoal: ${branch.researchGoal}`);
      }
      if (Array.isArray(branch.learnings) && branch.learnings.length) {
        lines.push('- Learnings:');
        for (const item of branch.learnings) {
          lines.push(`  - ${item}`);
        }
      }
      if (branch.citations && Object.keys(branch.citations).length) {
        lines.push('- Citations:');
        for (const [key, value] of Object.entries(branch.citations)) {
          lines.push(`  - ${key} -> ${value}`);
        }
      }
      if (Array.isArray(branch.followups) && branch.followups.length) {
        lines.push('- followUpQuestions:');
        for (const item of branch.followups) {
          lines.push(`  - ${item}`);
        }
      }
      if (Array.isArray(branch.sources) && branch.sources.length) {
        lines.push('- sources:');
        for (const item of branch.sources) {
          lines.push(`  - ${item}`);
        }
      }
      if (Array.isArray(branch.searchQueries) && branch.searchQueries.length) {
        lines.push('- searchQueries:');
        for (const item of branch.searchQueries) {
          lines.push(`  - ${item.skill || item.engine || 'search'}: ${item.query} (${item.resultCount ?? 'n/a'})`);
        }
      }
      lines.push(`- status: ${branch.status || 'done'}`);
      if (branch.reason) {
        lines.push(`- reason: ${branch.reason}`);
      }
    }
  }
  lines.push('');
  lines.push('## Recursion stop reason');
  if (session.task.stopReason) {
    lines.push(`- ${session.task.stopReason}`);
  } else if (session.task.status === 'complete') {
    const maxLevel = byLevel.size ? Math.max(...byLevel.keys()) : 0;
    if (maxLevel >= Number(session.task.depth ?? DEFAULTS.depth)) {
      const deepest = byLevel.get(maxLevel) || [];
      const allFailed = deepest.length > 0 && deepest.every((branch) => branch.status === 'failed');
      lines.push(allFailed
        ? `- Reached configured depth ${session.task.depth};deepest level contains only failed branches.`
        : `- Reached configured depth ${session.task.depth}.`);
    } else {
      lines.push('- Research complete (explicitly allowed incomplete).');
    }
  } else {
    lines.push('- Not yet complete.');
  }
  return lines.join('\n') + '\n';
}

// ── 命令实现 ──

/** init: 创建会话骨架 + session.json(研究任务参数;可选 --collection-result-input-file 预置采集清单)。 */
export function cmdInit(args) {
  const root = path.resolve(requireString(args['session-dir'], '--session-dir'));
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query.trim()) {
    throw new Error('--query 是必填项');
  }
  const mode = typeof args.mode === 'string' ? args.mode.trim().toLowerCase() : 'collection';
  if (!TASK_MODES.has(mode)) {
    throw new Error(`--mode 必须是 ${[...TASK_MODES].join(' 或 ')}`);
  }
  const breadth = positiveInt(args.breadth ?? DEFAULTS.breadth, '--breadth', { max: 10 });
  const depth = positiveInt(args.depth ?? DEFAULTS.depth, '--depth', { max: 5 });
  const concurrency = positiveInt(args.concurrency ?? DEFAULTS.concurrency, '--concurrency', { max: 8 });
  const maxContextWords = positiveInt(args['max-context-words'] ?? DEFAULTS.maxContextWords, '--max-context-words', { min: 100, max: 1_000_000 });
  const deadlineMinutes = optionalPositiveInt(args['deadline-minutes'], '--deadline-minutes', { max: 60 * 24 });
  const maxBranches = optionalPositiveInt(args['max-branches'], '--max-branches', { max: 1000 });
  const maxSourcesPerBranch = optionalPositiveInt(args['max-sources-per-branch'], '--max-sources-per-branch', { max: 1000 });
  const maxSearchRounds = optionalPositiveInt(args['max-search-rounds'], '--max-search-rounds', { max: 1000 });
  const startedAt = typeof args['started-at'] === 'string' && args['started-at'].trim()
    ? args['started-at'].trim()
    : new Date().toISOString();
  if (!Number.isFinite(Date.parse(startedAt))) {
    throw new Error('--started-at 必须是合法时间字符串');
  }

  const sessionFile = path.join(root, 'session.json');
  if (fs.existsSync(sessionFile)) {
    throw new Error(`任务已初始化: ${root}`);
  }
  if (fs.existsSync(root)) {
    if (!fs.statSync(root).isDirectory() || fs.readdirSync(root).length > 0) {
      throw new Error(`目标 session 目录必须不存在或为空: ${root}`);
    }
  }
  ensureSessionSkeleton(root);
  const session = {
    schemaVersion: '2.0',
    task: {
      query,
      mode,
      breadth,
      depth,
      concurrency,
      maxContextWords,
      deadlineMinutes,
      maxBranches,
      maxSourcesPerBranch,
      maxSearchRounds,
      startedAt,
      initialSearch: [],
      followups: [],
      combinedQuery: null,
      stopReason: null,
      status: 'initialized',
    },
    research: { branches: [], learnings: [], citations: {}, context: [], visitedUrls: [], reportPath: null },
    collection: {
      schemaVersion: '1.0',
      storage: { fallback: false },
      collection: { status: 'complete', items: [] },
      retention: { auditRequired: false, userRequested: false },
      postProcessing: { runs: [] },
    },
  };
  const collectionResultInput = args['collection-result-input-file'];
  if (collectionResultInput) {
    const collectionResult = readJson(path.resolve(collectionResultInput), '--collection-result-input-file');
    assertNoSensitiveKeys(collectionResult, '--collection-result-input-file');
    seedItemsFromCollectionResult(session, collectionResult, root);
    atomicWriteJson(path.join(root, 'collection-result.json'), collectionResult);
  }
  const metadataInput = args['metadata-input-file'];
  if (metadataInput) {
    const metadata = readJson(path.resolve(metadataInput), '--metadata-input-file');
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error('--metadata-input-file 必须是 JSON 对象');
    }
    assertNoSensitiveKeys(metadata, '--metadata-input-file');
    session.collection = metadata;
  }
  persistSession({ root, session: sessionFile }, session);
  return {
    ok: true,
    action: 'init',
    sessionDir: root,
    task: session.task,
    collectionItems: session.collection.collection.items.length,
  };
}

function seedItemsFromCollectionResult(session, collectionResult, root) {
  if (!collectionResult || typeof collectionResult !== 'object' || Array.isArray(collectionResult)) {
    throw new Error('collection-result.json 根节点必须是对象');
  }
  if (!Array.isArray(collectionResult.items)) {
    throw new Error('collection-result.json items 必须是数组');
  }
  const backend = String(collectionResult.backend || '');
  if (collectionResult.items.length && !backend) {
    throw new Error('collection-result.json 有 items 时 backend 必须非空');
  }
  const filters = collectionResult.filters && typeof collectionResult.filters === 'object' ? collectionResult.filters : {};
  const items = [];
  for (const item of collectionResult.items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const sanitizedPath = typeof item.fileName === 'string' ? item.fileName : null;
    const markdownPath = sanitizedPath ? path.posix.join('markdown', path.posix.basename(sanitizedPath)) : null;
    const materialized = Boolean(sanitizedPath && fs.existsSync(path.join(root, sanitizedPath)));
    items.push({
      itemId: stableItemId(item),
      title: String(item.title || ''),
      sourceUrl: String(item.url || ''),
      sourceItemId: null,
      sourceSkill: backend,
      backend,
      collectionFilters: filters,
      rawArtifacts: [],
      materialization: {
        status: materialized ? 'materialized' : 'pending',
        markdownPath: materialized ? markdownPath : null,
        sanitizedPath: materialized ? sanitizedPath : null,
        pendingArtifactCleanup: [],
        reason: null,
      },
    });
  }
  session.collection.collection = {
    status: 'complete',
    items,
  };
}

function stableItemId(item) {
  const identity = [item.url, item.title, item.fileName].filter(Boolean).join('\n');
  return `item-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
}

/** plan: 记录初始搜索与合并起始查询。 */
export function cmdPlan(args) {
  const paths = sessionPaths(args['session-dir']);
  return withSessionLock(paths, 'plan', () => {
    const { session } = loadSession(paths);
    const initialSearch = nonEmptyStringList(parseJsonArg(args['initial-search'], []), 'initialSearch');
    const followups = nonEmptyStringList(parseJsonArg(args.followups, []), 'followups');
    if (initialSearch.length === 0 && !(typeof args['combined-query'] === 'string' && args['combined-query'].trim())) {
      throw new Error('plan 必须提供 --initial-search 非空数组或 --combined-query');
    }
    if (args.channels === undefined) {
      throw new Error(
        'plan 必须提供 --channels：三个发现通道(builtin-routing / searxng / hot-discovery)逐个表态。'
        + '例: --channels \'{"builtin-routing":{"state":"used"},"searxng":{"state":"used"},'
        + '"hot-discovery":{"state":"used"}}\'。'
        + '这道校验存在的原因：三通道并行此前只写在散文里，会被「命令已跑通」的错觉跳过',
      );
    }
    const channels = validateChannels(parseJsonArg(args.channels, {}));
    session.task.initialSearch = initialSearch;
    session.task.followups = followups;
    session.task.discoveryChannels = channels;
    if (args['combined-query'] !== undefined && args['combined-query'] !== null) {
      session.task.combinedQuery = String(args['combined-query']);
    }
    session.task.status = 'planned';
    persistSession(paths, session);
    return {
      ok: true, action: 'plan', status: session.task.status, initialSearch, combinedQuery: session.task.combinedQuery, channels,
    };
  });
}

/** branch: 登记一层研究分支(原 add-branch)。 */
export function cmdBranch(args) {
  const paths = sessionPaths(args['session-dir']);
  return withSessionLock(paths, 'branch', () => {
    const { session } = loadSession(paths);
    const level = Number(args.level);
    if (!Number.isInteger(level)) {
      throw new Error('--level 必须是整数');
    }
    validateLevel(session, level);
    const status = typeof args.status === 'string' ? args.status : 'done';
    if (!BRANCH_STATUSES.has(status)) {
      throw new Error(`--status 必须是 ${[...BRANCH_STATUSES].join(' 或 ')}`);
    }
    if (status !== 'failed') {
      assertWithinBudget(session);
    }
    const branchId = typeof args.id === 'string' && args.id.trim() ? args.id : `L${level}-B${session.research.branches.length + 1}`;
    if (session.research.branches.some((branch) => branch?.id === branchId)) {
      throw new Error(`分支 id 已存在: ${branchId}`);
    }
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      throw new Error('--query 是必填项');
    }
    const researchGoal = typeof args['research-goal'] === 'string' ? args['research-goal'].trim() : '';
    if (status !== 'failed' && !researchGoal) {
      throw new Error('status 非 failed 时 --research-goal 必填');
    }
    const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
    if (status === 'failed' && !reason) {
      throw new Error('status=failed 时 --reason 必填');
    }
    const parentId = typeof args['parent-id'] === 'string' && args['parent-id'].trim() ? args['parent-id'].trim() : null;
    if (parentId && !session.research.branches.some((branch) => branch?.id === parentId)) {
      throw new Error(`parent-id 不存在: ${parentId}`);
    }
    const learnings = nonEmptyStringList(parseJsonArg(args.learnings, []), 'learnings');
    const citations = asDict(parseJsonArg(args.citations, {}), 'citations');
    const followups = nonEmptyStringList(parseJsonArg(args.followups, []), 'followups');
    const sources = nonEmptyStringList(parseJsonArg(args.sources, []), 'sources');
    const context = nonEmptyStringList(parseJsonArg(args.context, []), 'context');
    const searchQueries = asList(parseJsonArg(args['search-queries'], []), 'searchQueries');
    if (status === 'done' && learnings.length === 0) {
      throw new Error('status=done 时 --learnings 至少包含一条');
    }
    validateSources(session, sources, status);
    validateCitations(session, citations, status);
    validateSearchQueries(session, searchQueries);
    if (session.task.maxSourcesPerBranch !== null && session.task.maxSourcesPerBranch !== undefined
      && sources.length > session.task.maxSourcesPerBranch) {
      throw new Error(`分支来源数 ${sources.length} 超过预算 maxSourcesPerBranch=${session.task.maxSourcesPerBranch}`);
    }
    const previousRounds = session.research.branches.reduce((sum, item) => sum + (Array.isArray(item.searchQueries) ? item.searchQueries.length : 0), 0);
    if (session.task.maxSearchRounds !== null && session.task.maxSearchRounds !== undefined
      && previousRounds + searchQueries.length > session.task.maxSearchRounds) {
      throw new Error(`检索轮数 ${previousRounds + searchQueries.length} 超过预算 maxSearchRounds=${session.task.maxSearchRounds}`);
    }
    const branch = {
      level,
      id: branchId,
      parentId,
      query,
      researchGoal,
      learnings,
      citations,
      followups,
      sources,
      context,
      searchQueries,
      status,
      reason: reason || null,
      createdAt: new Date().toISOString(),
    };
    session.research.branches.push(branch);
    session.research.learnings = appendUnique(session.research.learnings, learnings);
    session.research.citations = mergeCitations(session.research.citations, citations);
    session.research.visitedUrls = appendUnique(session.research.visitedUrls, sources);
    session.research.context = appendUnique(session.research.context, context);
    session.task.status = 'researching';
    persistSession(paths, session);
    return { ok: true, action: 'branch', id: branchId, level, status, budget: budgetSummary(session) };
  });
}

function budgetSummary(session) {
  return {
    branches: session.research.branches.length,
    maxBranches: session.task.maxBranches,
    deadlineMinutes: session.task.deadlineMinutes,
    startedAt: session.task.startedAt,
  };
}

/** aggregate: 去重并裁剪 context。 */
export function cmdAggregate(args) {
  const paths = sessionPaths(args['session-dir']);
  return withSessionLock(paths, 'aggregate', () => {
    const { session } = loadSession(paths);
    if (!session.research.branches.length) {
      throw new Error('aggregate 前必须至少登记一个 branch');
    }
    session.research.learnings = appendUnique(session.research.learnings, []);
    session.research.visitedUrls = appendUnique(session.research.visitedUrls, []);
    session.research.context = trimContext(session.research.context, Number(session.task.maxContextWords ?? DEFAULTS.maxContextWords));
    session.task.status = 'aggregated';
    persistSession(paths, session);
    return {
      ok: true,
      action: 'aggregate',
      learnings: session.research.learnings.length,
      visitedUrls: session.research.visitedUrls.length,
      contextItems: session.research.context.length,
    };
  });
}

/** report: 校验报告文件存在、非空且在会话目录内,标记完成并渲染研究树。 */
export function cmdReport(args) {
  const paths = sessionPaths(args['session-dir']);
  return withSessionLock(paths, 'report', () => {
    const { session } = loadSession(paths);
    if (!session.research.branches.length) {
      throw new Error('report 前必须至少登记一个 branch;禁止零分支报告');
    }
    if (session.task.status === 'initialized') {
      throw new Error('report 前必须完成 plan 或至少一次 branch 登记');
    }
    const maxLevel = Math.max(...session.research.branches.map((branch) => Number(branch.level || 1)));
    const depth = Number(session.task.depth ?? DEFAULTS.depth);
    const allowIncomplete = asBool(args['allow-incomplete'], '--allow-incomplete');
    const stopReason = typeof args['stop-reason'] === 'string' ? args['stop-reason'].trim() : '';
    if (maxLevel < depth && !allowIncomplete && !stopReason) {
      throw new Error(
        `研究未达到配置深度 depth=${depth},当前最大层级=${maxLevel}。`
        + '请继续递归,或提供 --stop-reason / --allow-incomplete 明确提前停止',
      );
    }
    const reportPath = typeof args['report-path'] === 'string' && args['report-path'].trim()
      ? path.resolve(args['report-path'])
      : path.join(paths.root, REPORT_FILENAME);
    if (!isInside(paths.root, reportPath)) {
      throw new Error(`报告文件必须在会话目录内: ${paths.root}`);
    }
    let stat;
    try {
      stat = fs.lstatSync(reportPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`报告文件不存在: ${reportPath}`);
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`报告文件必须是普通文件且不能是符号链接: ${reportPath}`);
    }
    if (stat.size === 0) {
      throw new Error(`报告文件不能为空: ${reportPath}`);
    }
    session.research.reportPath = reportPath;
    session.task.stopReason = stopReason || null;
    session.task.status = 'complete';
    persistSession(paths, session);
    fs.writeFileSync(path.join(paths.root, TREE_FILENAME), renderTree(session), { encoding: 'utf8', mode: 0o600 });
    return { ok: true, action: 'report', reportPath, treePath: path.join(paths.root, TREE_FILENAME), complete: maxLevel >= depth || allowIncomplete };
  });
}

/** status: 研究维度摘要。 */
export function cmdResearchStatus(args) {
  const paths = sessionPaths(args['session-dir']);
  const { session } = loadSession(paths);
  const warnings = [];
  const deadline = session.task.deadlineMinutes;
  if (deadline !== null && deadline !== undefined) {
    const startedAt = Date.parse(session.task.startedAt || '');
    if (Number.isFinite(startedAt)) {
      const remainingMs = deadline * 60 * 1000 - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        warnings.push('研究时间预算已用尽,请 aggregate 并 report');
      } else {
        warnings.push(`研究剩余时间约 ${Math.ceil(remainingMs / 60000)} 分钟`);
      }
    }
  }
  return {
    task: session.task,
    research: {
      branches: session.research.branches.length,
      learnings: session.research.learnings.length,
      citations: Object.keys(session.research.citations).length,
      visitedUrls: session.research.visitedUrls.length,
      contextItems: session.research.context.length,
      reportPath: session.research.reportPath,
    },
    warnings,
  };
}
