#!/usr/bin/env node
/**
 * research-state.mjs — 深化研究方法的状态机(deep_research.py 的 JS 等价平替)。
 *
 * 本模块不做研究,只管理持久状态: 初始化任务、记录计划、登记分支(learnings/citations)、
 * 聚合去重、标记报告完成并渲染研究树。研究判断(搜什么、什么相关、学到什么、怎么写报告)
 * 全部由 Agent 负责,与上游 deep-research 技能语义一致。
 *
 * 状态存放于 <session-dir>/session.json 的 task / research 子树;与采集状态(collection
 * 子树)共用一个会话、一个锁、一个文件 —— 即"一体化"单状态文件。
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
  withSessionLock,
  ensureSessionSkeleton,
} from './session.mjs';

export const DEFAULTS = { breadth: 3, depth: 2, concurrency: 2, maxContextWords: 25000 };
export const TREE_FILENAME = 'research-tree.md';
export const REPORT_FILENAME = 'report.md';

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

function validateLevel(session, level) {
  const depth = Number(session.task.depth ?? DEFAULTS.depth);
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

function wordCount(text) {
  if (Array.isArray(text)) {
    text = text.join(' ');
  }
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
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
      const words = text.trim().split(/\s+/);
      trimmed.unshift(words.slice(0, maxWords).join(' '));
      break;
    } else {
      break;
    }
  }
  return trimmed;
}

function renderTree(session) {
  const lines = [];
  lines.push('# Research Tree');
  lines.push('');
  lines.push(`研究问题：${session.task.query || ''}`);
  lines.push(
    `参数：breadth=${session.task.breadth}，depth=${session.task.depth}，`
    + `concurrency=${session.task.concurrency}，max_context_words=${session.task.maxContextWords}`,
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
      lines.push(`- status: ${branch.status || 'done'}`);
    }
  }
  lines.push('');
  lines.push('## Recursion stop reason');
  if (session.task.status === 'complete') {
    lines.push('- Research complete.');
  } else {
    const maxLevel = byLevel.size ? Math.max(...byLevel.keys()) : 0;
    if (maxLevel >= Number(session.task.depth ?? DEFAULTS.depth)) {
      lines.push(`- Reached configured depth ${session.task.depth}.`);
    } else {
      lines.push('- Not yet complete.');
    }
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
      breadth: Number(args.breadth ?? DEFAULTS.breadth),
      depth: Number(args.depth ?? DEFAULTS.depth),
      concurrency: Number(args.concurrency ?? DEFAULTS.concurrency),
      maxContextWords: Number(args['max-context-words'] ?? DEFAULTS.maxContextWords),
      startedAt: typeof args['started-at'] === 'string' ? args['started-at'] : null,
      initialSearch: [],
      followups: [],
      combinedQuery: null,
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
    seedItemsFromCollectionResult(session, collectionResult, root);
    atomicWriteJson(path.join(root, 'collection-result.json'), collectionResult);
  }
  const metadataInput = args['metadata-input-file'];
  if (metadataInput) {
    const metadata = readJson(path.resolve(metadataInput), '--metadata-input-file');
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error('--metadata-input-file 必须是 JSON 对象');
    }
    session.collection = metadata;
  }
  atomicWriteJson(sessionFile, session);
  return { ok: true, action: 'init', sessionDir: root, task: session.task, collectionItems: session.collection.collection.items.length };
}

function seedItemsFromCollectionResult(session, collectionResult, root) {
  if (!collectionResult || typeof collectionResult !== 'object' || Array.isArray(collectionResult)) {
    throw new Error('collection-result.json 根节点必须是对象');
  }
  if (!Array.isArray(collectionResult.items)) {
    throw new Error('collection-result.json items 必须是数组');
  }
  const backend = String(collectionResult.backend || '');
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
    session.task.initialSearch = asList(parseJsonArg(args['initial-search'], []), 'initialSearch');
    session.task.followups = asList(parseJsonArg(args.followups, []), 'followups');
    if (args['combined-query'] !== undefined && args['combined-query'] !== null) {
      session.task.combinedQuery = String(args['combined-query']);
    }
    session.task.status = 'planned';
    persistSession(paths, session);
    return { ok: true, action: 'plan', status: session.task.status };
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
    const branchId = typeof args.id === 'string' && args.id.trim() ? args.id : `L${level}-B${session.research.branches.length + 1}`;
    if (session.research.branches.some((branch) => branch?.id === branchId)) {
      throw new Error(`分支 id 已存在: ${branchId}`);
    }
    const learnings = asList(parseJsonArg(args.learnings, []), 'learnings');
    const citations = asDict(parseJsonArg(args.citations, {}), 'citations');
    const followups = asList(parseJsonArg(args.followups, []), 'followups');
    const sources = asList(parseJsonArg(args.sources, []), 'sources');
    const context = asList(parseJsonArg(args.context, []), 'context');
    const branch = {
      level,
      id: branchId,
      query: typeof args.query === 'string' ? args.query : '',
      researchGoal: typeof args['research-goal'] === 'string' ? args['research-goal'] : '',
      learnings,
      citations,
      followups,
      sources,
      context,
      status: typeof args.status === 'string' ? args.status : 'done',
    };
    session.research.branches.push(branch);
    session.research.learnings = appendUnique(session.research.learnings, learnings);
    session.research.citations = mergeCitations(session.research.citations, citations);
    session.research.visitedUrls = appendUnique(session.research.visitedUrls, sources);
    session.research.context = appendUnique(session.research.context, context);
    session.task.status = 'researching';
    persistSession(paths, session);
    return { ok: true, action: 'branch', id: branchId, level };
  });
}

/** aggregate: 去重并裁剪 context。 */
export function cmdAggregate(args) {
  const paths = sessionPaths(args['session-dir']);
  return withSessionLock(paths, 'aggregate', () => {
    const { session } = loadSession(paths);
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

/** report: 校验报告文件存在,标记完成并渲染研究树。 */
export function cmdReport(args) {
  const paths = sessionPaths(args['session-dir']);
  return withSessionLock(paths, 'report', () => {
    const { session } = loadSession(paths);
    const reportPath = typeof args['report-path'] === 'string' && args['report-path'].trim()
      ? path.resolve(args['report-path'])
      : path.join(paths.root, REPORT_FILENAME);
    if (!fs.existsSync(reportPath) || !fs.statSync(reportPath).isFile()) {
      throw new Error(`报告文件不存在: ${reportPath}`);
    }
    session.research.reportPath = reportPath;
    session.task.status = 'complete';
    persistSession(paths, session);
    fs.writeFileSync(path.join(paths.root, TREE_FILENAME), renderTree(session), { encoding: 'utf8', mode: 0o600 });
    return { ok: true, action: 'report', reportPath, treePath: path.join(paths.root, TREE_FILENAME) };
  });
}

/** status: 研究维度摘要。 */
export function cmdResearchStatus(args) {
  const paths = sessionPaths(args['session-dir']);
  const { session } = loadSession(paths);
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
  };
}

export function researchHelp() {
  return {
    commands: {
      init: '创建会话骨架与 session.json(研究任务参数,可选 --collection-result-input-file 预置清单)',
      plan: '记录初始搜索、follow-up 与合并起始查询',
      branch: '登记一层研究分支(learnings/citations/sources/context)',
      aggregate: '去重并裁剪 context',
      report: '校验报告文件、标记完成并渲染 research-tree.md',
    },
  };
}
