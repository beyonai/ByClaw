#!/usr/bin/env node
/**
 * crawl-state.mjs — 站点爬取 frontier(待爬队列)状态管理。
 *
 * 解决的问题: knowledge-collection 原本只能单 URL 抓取(bycli web read),
 * 想覆盖一个文档站需要 Agent 在对话里手工维护队列、去重与深度,一次中断就得重来。
 * 本模块把 frontier 落到 session.json 的 crawl 子树,可断点续爬。
 *
 * 边界: 本模块**不取内容**。发现 URL 与取正文仍由来源执行器负责
 * (sitemap 与正文页一律 `bycli web read`),本模块只做入队、出队、去重与记账。
 *
 * 命令:
 *   crawl-seed  --session-dir <dir> --urls-file <file> [--scope-prefix <url>] [--max-pages N] [--depth N]
 *   crawl-next  --session-dir <dir> [--limit N]
 *   crawl-mark  --session-dir <dir> --mark-json-file <file>
 *   crawl-status --session-dir <dir>
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import {
  loadSession, persistSession, withSessionLock, requireString, readStandaloneJson,
  resolveCollectionInputFile, isInside,
} from './session.mjs';
import { assertSessionWorkflowAllowsCommand } from './probe-state.mjs';

export const CRAWL_SCHEMA_VERSION = '1.0';
const STATUSES = new Set(['pending', 'fetched', 'failed', 'skipped']);

function emptyCrawl() {
  return {
    schemaVersion: CRAWL_SCHEMA_VERSION,
    scopePrefix: null,
    maxPages: null,
    maxDepth: 1,
    seededAt: null,
    coverage: { discovered: 0, duplicate: 0, outOfScope: 0, overCap: 0 },
    overCapUrls: [],
    entries: [],
  };
}

function ensureCrawl(session) {
  if (!session.crawl || typeof session.crawl !== 'object' || Array.isArray(session.crawl)) {
    session.crawl = emptyCrawl();
    return session.crawl;
  }
  if (session.crawl.schemaVersion !== CRAWL_SCHEMA_VERSION) {
    throw new Error(`session.json crawl.schemaVersion 必须是 ${CRAWL_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(session.crawl.entries)) {
    throw new Error('session.json crawl.entries 必须是数组');
  }
  if (!session.crawl.coverage || typeof session.crawl.coverage !== 'object') {
    session.crawl.coverage = { discovered: 0, duplicate: 0, outOfScope: 0, overCap: 0 };
  }
  if (!Array.isArray(session.crawl.overCapUrls)) session.crawl.overCapUrls = [];
  return session.crawl;
}

/** 规范化 URL 用于去重: 去 fragment、去尾部 index.html、统一尾斜杠、排序 query。 */
export function canonicalizeUrl(raw, label = 'url') {
  const value = requireString(raw, label);
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} 不是合法 URL: ${value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} 只支持 http 或 https: ${value}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} 不得包含凭据`);
  }
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/index\.html?$/i, '/');
  if (!parsed.pathname) {
    parsed.pathname = '/';
  }
  if (parsed.search) {
    const params = [...new URLSearchParams(parsed.search).entries()].sort(
      (a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])),
    );
    parsed.search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  }
  return parsed.toString();
}

/** 从 sitemap 输出或链接清单里抽 URL。接受 XML <loc>、Markdown 链接与裸 URL 混排。 */
export function extractUrls(text) {
  const found = [];
  const push = (candidate) => {
    const trimmed = String(candidate).trim().replace(/[)>\],;'"]+$/, '');
    if (trimmed) found.push(trimmed);
  };
  const locPattern = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let match = locPattern.exec(text);
  while (match) {
    push(match[1]);
    match = locPattern.exec(text);
  }
  if (!found.length) {
    const bare = /https?:\/\/[^\s<>()\[\]"'`]+/gi;
    match = bare.exec(text);
    while (match) {
      push(match[0]);
      match = bare.exec(text);
    }
  }
  return found;
}

function inScope(url, scopePrefix) {
  if (!scopePrefix) return true;
  return url.startsWith(scopePrefix);
}

/** 取 URL 路径的前两段作为分组键,用于判断入队集合是否偏斜到少数目录。 */
function pathGroup(url) {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments.slice(0, 2).join('/') || '/';
  } catch {
    return '/';
  }
}

/**
 * --max-pages 是按 urls-file 的文件顺序截断,不按重要性。sitemap 通常按字母序排列,
 * 直接配一个小 cap 很可能整批落在同一个目录下(实测 Dify sitemap + --max-pages 24
 * 得到的 24 页全部来自 api-reference/annotations)。这里在入队集合过度集中时如实告警,
 * 让调用方回到"先按路径结构分层抽样再 seed"。
 */
function skewWarning(groups, added, overflow) {
  if (!overflow || added < 3) return null;
  const ranked = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const [topGroup, topCount] = ranked[0];
  if (topCount / added < 0.6) return null;
  return `--max-pages 按文件顺序截断,本次入队 ${added} 页中 ${topCount} 页集中在 /${topGroup}/`
    + `,另有 ${overflow} 页因超出容量被放弃。样本可能不具代表性:`
    + '先按 URL 路径结构分层抽样,再用抽样结果 seed。';
}

function positiveInt(value, label) {
  if (value === undefined || value === true) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正整数`);
  }
  return parsed;
}

/** crawl-seed: 用发现结果建立或扩充 frontier。已存在的 URL 保持原状态,不会被重置。 */
export function cmdCrawlSeed(paths, args) {
  const urlsFile = path.resolve(requireString(args['urls-file'], '--urls-file'));
  if (!isInside(paths.root, urlsFile) && !fs.existsSync(urlsFile)) {
    throw new Error(`--urls-file 不存在: ${urlsFile}`);
  }
  if (!fs.existsSync(urlsFile)) {
    throw new Error(`--urls-file 不存在: ${urlsFile}`);
  }
  const text = fs.readFileSync(urlsFile, 'utf8');
  const rawUrls = extractUrls(text);
  if (!rawUrls.length) {
    throw new Error('--urls-file 中没有解析到任何 http/https URL');
  }
  const scopePrefix = args['scope-prefix'] === undefined || args['scope-prefix'] === true
    ? null
    : canonicalizeUrl(args['scope-prefix'], '--scope-prefix');
  const maxPages = positiveInt(args['max-pages'], '--max-pages');
  const depth = positiveInt(args.depth, '--depth') ?? 1;

  return withSessionLock(paths, 'crawl-seed', () => {
    const { session } = loadSession(paths);
    assertSessionWorkflowAllowsCommand(session, 'crawl-seed');
    const crawl = ensureCrawl(session);
    if (scopePrefix) crawl.scopePrefix = scopePrefix;
    if (maxPages) crawl.maxPages = maxPages;
    crawl.maxDepth = Math.max(crawl.maxDepth || 1, depth);
    if (!crawl.seededAt) crawl.seededAt = new Date().toISOString();

    const known = new Set(crawl.entries.map((entry) => entry.url));
    const overCapUrls = new Set(crawl.overCapUrls);
    let added = 0;
    let outOfScope = 0;
    let duplicate = 0;
    const capacity = crawl.maxPages ? crawl.maxPages - crawl.entries.length : Infinity;
    let overflow = 0;
    const addedGroups = {};

    for (const raw of rawUrls) {
      let url;
      try {
        url = canonicalizeUrl(raw, 'sitemap url');
      } catch {
        continue;
      }
      if (!inScope(url, crawl.scopePrefix)) {
        overCapUrls.delete(url);
        outOfScope += 1;
        continue;
      }
      if (known.has(url)) {
        overCapUrls.delete(url);
        duplicate += 1;
        continue;
      }
      if (added >= capacity) {
        overCapUrls.add(url);
        overflow += 1;
        continue;
      }
      overCapUrls.delete(url);
      known.add(url);
      crawl.entries.push({ url, status: 'pending', depth: 0, itemId: null, reason: null });
      const group = pathGroup(url);
      addedGroups[group] = (addedGroups[group] || 0) + 1;
      added += 1;
    }

    crawl.coverage.discovered = (Number(crawl.coverage.discovered) || 0) + rawUrls.length;
    crawl.coverage.duplicate = (Number(crawl.coverage.duplicate) || 0) + duplicate;
    crawl.coverage.outOfScope = (Number(crawl.coverage.outOfScope) || 0) + outOfScope;
    crawl.overCapUrls = [...overCapUrls].sort();
    crawl.coverage.overCap = crawl.overCapUrls.length;

    persistSession(paths, session);
    const warning = skewWarning(addedGroups, added, overflow);
    return {
      ok: true,
      command: 'crawl-seed',
      discovered: rawUrls.length,
      added,
      skipped: { duplicate, outOfScope, overCap: overflow },
      frontier: summarize(crawl),
      ...(warning ? { warnings: [warning] } : {}),
      next: added
        ? 'crawl-next 取待抓 URL,交由 bycli web read 抓取(本脚本不取内容)'
        : 'frontier 未新增;检查 --scope-prefix 或 --max-pages',
    };
  });
}

/** crawl-next: 取出待抓 URL 交给来源执行器。只读,不改状态(抓完用 crawl-mark 登记)。 */
export function cmdCrawlNext(paths, args) {
  const limit = positiveInt(args.limit, '--limit') ?? 10;
  const { session } = loadSession(paths);
  const crawl = ensureCrawl(session);
  const pending = crawl.entries.filter((entry) => entry.status === 'pending');
  const batch = pending.slice(0, limit).map((entry) => entry.url);
  return {
    ok: true,
    command: 'crawl-next',
    urls: batch,
    remaining: pending.length - batch.length,
    frontier: summarize(crawl),
    next: batch.length
      ? '对每个 URL 执行 `bycli web read --url <URL> --stdout`,再用 crawl-mark 登记结果'
      : 'frontier 已无 pending;由来源执行器转换并净化正文后用 collect 登记',
  };
}

/** crawl-mark: 登记一批抓取结果。payload: {results:[{url,status,itemId?,reason?}]} */
export function cmdCrawlMark(paths, args) {
  const markFile = resolveCollectionInputFile(paths, args['mark-json-file'], '--mark-json-file');
  const payload = readStandaloneJson(markFile, 'crawl mark payload');
  const results = Array.isArray(payload?.results) ? payload.results : null;
  if (!results || !results.length) {
    throw new Error('crawl mark payload.results 必须是非空数组');
  }

  return withSessionLock(paths, 'crawl-mark', () => {
    const { session } = loadSession(paths);
    assertSessionWorkflowAllowsCommand(session, 'crawl-mark');
    const crawl = ensureCrawl(session);
    const index = new Map(crawl.entries.map((entry) => [entry.url, entry]));
    const applied = [];
    const unknown = [];

    for (const result of results) {
      const url = canonicalizeUrl(result?.url, 'crawl mark url');
      const status = requireString(result?.status, 'crawl mark status');
      if (!STATUSES.has(status)) {
        throw new Error(`crawl mark status 非法: ${status}(允许 ${[...STATUSES].join('/')})`);
      }
      if (status === 'failed' && !result?.reason) {
        throw new Error(`status=failed 必须给出 reason: ${url}`);
      }
      const entry = index.get(url);
      if (!entry) { unknown.push(url); continue; }
      entry.status = status;
      entry.itemId = typeof result?.itemId === 'string' && result.itemId ? result.itemId : entry.itemId;
      entry.reason = result?.reason ? String(result.reason) : null;
      applied.push({ url, status });
    }

    if (unknown.length) {
      throw new Error(`以下 URL 不在 frontier 中,请先 crawl-seed: ${unknown.slice(0, 3).join(', ')}`);
    }

    persistSession(paths, session);
    try { fs.unlinkSync(markFile); } catch {}
    return {
      ok: true,
      command: 'crawl-mark',
      applied: applied.length,
      frontier: summarize(crawl),
      next: 'fetched 条目由来源执行器转换并净化为 sanitized/items/*.md 后用 collect 登记 inventory',
    };
  });
}

export function cmdCrawlStatus(paths) {
  const { session } = loadSession(paths);
  const crawl = ensureCrawl(session);
  return { ok: true, command: 'crawl-status', ...summarize(crawl) };
}

function summarize(crawl) {
  const counts = { pending: 0, fetched: 0, failed: 0, skipped: 0 };
  for (const entry of crawl.entries) {
    if (counts[entry.status] !== undefined) counts[entry.status] += 1;
  }
  return {
    total: crawl.entries.length,
    ...counts,
    scopePrefix: crawl.scopePrefix,
    maxPages: crawl.maxPages,
    seededAt: crawl.seededAt,
    coverage: {
      discovered: Number(crawl.coverage?.discovered) || 0,
      duplicate: Number(crawl.coverage?.duplicate) || 0,
      outOfScope: Number(crawl.coverage?.outOfScope) || 0,
      overCap: Number(crawl.coverage?.overCap) || 0,
    },
  };
}
