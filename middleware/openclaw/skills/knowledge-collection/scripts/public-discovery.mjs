import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mergeDocuments,
  normalizeUrl,
  parseDeclarations,
} from '../references/online-search/references/hot_discovery/scripts/hot_discovery.mjs';
import {
  annotateMergedCandidates,
  classifyCandidates,
  countUniqueEligibleArticles,
  mergedCandidates,
  summarizeMergedQuality,
} from './candidate-quality.mjs';
import {
  recordDiscoveryResult,
  reserveDiscoveryAttempt,
} from './discovery-authorization.mjs';
import { loadSession, persistSession, withSessionLock } from './session.mjs';
import { runCli } from './enterprise/shared/cli-runner.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const onlineSearchRoot = resolve(scriptDir, '../references/online-search');
const searxngRuntimeScript = '/opt/searxng-cli/searxng_cli.py';
const hotDiscoveryScript = join(onlineSearchRoot, 'references/hot_discovery/scripts/hot_discovery.mjs');
const adaptersPath = join(onlineSearchRoot, 'references/hot_discovery/adapters.md');
const MAX_DIAGNOSTIC_STDERR_CHARS = 2_000;
const DEFAULT_SEARXNG_PROCESS_TIMEOUT_SECONDS = 60;
const SEARXNG_REQUEST_TIMEOUT_SECONDS = 10;
export const SOFT_DISCOVERY_BUDGET_MS = 60_000;
export const HARD_DISCOVERY_BUDGET_MS = 90_000;
const CHINESE_ARTICLE_SOURCES = Object.freeze(['36kr', 'weixin', 'sogou', 'baidu', 'bing']);
const ARTICLE_INTENT = /(?:文章|报道|访谈|专访)/u;
const CJK_TEXT = /\p{Script=Han}/u;
const PROFILE_CATEGORIES = new Set(['general', 'news', 'blogs']);

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} 必须是非空字符串`);
  }
  return value.trim();
}

function snapshotPath(inputDir, name) {
  const root = resolve(inputDir);
  const target = resolve(root, name);
  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error('发现快照必须位于会话 .collection-inputs 目录内');
  }
  return target;
}

export function isChineseArticleProfile(session, args = {}) {
  const task = session?.task || {};
  const requestedCount = args['requested-count'];
  const category = typeof args.category === 'string' && args.category.trim()
    ? args.category.trim() : 'general';
  const language = typeof args.language === 'string' ? args.language.trim() : 'all';
  const query = typeof args.query === 'string' ? args.query : '';
  const topic = task.discoveryGate?.topicContract;
  return task.mode === 'collection'
    && Array.isArray(task.sourceScope) && task.sourceScope.includes('public-internet')
    && requestedCount !== undefined && requestedCount !== null
    && PROFILE_CATEGORIES.has(category)
    && (/^zh(?:[-_]|$)/i.test(language) || CJK_TEXT.test(`${query}\n${task.query || ''}`))
    && ARTICLE_INTENT.test(String(task.query || ''))
    && topic?.required === true
    && typeof topic.normalizedSubject === 'string' && Boolean(topic.normalizedSubject.trim());
}

export function resolveSearxngRuntime(options = {}, environment = process.env) {
  const pythonExecutable = options.pythonExecutable || environment.ONLINE_SEARCH_PYTHON;
  if (pythonExecutable) {
    const script = options.searxngScript || environment.ONLINE_SEARCH_SCRIPT || searxngRuntimeScript;
    return { executable: pythonExecutable, argsPrefix: [script] };
  }
  return { executable: 'searxng-cli', argsPrefix: [] };
}

export async function runBoundedProcess({ bin, executable, args }, options = {}) {
  const outcome = await runCli(bin || executable, args, options);
  return {
    code: Number.isInteger(outcome.exitCode) ? outcome.exitCode : 1,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
  };
}

export async function runPublicProcess(spec, options = {}) {
  try {
    return await runBoundedProcess(spec, options);
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error);
    return { code: 1, stdout: '', stderr, timedOut: /timeout after \d+ms/i.test(stderr) };
  }
}

function parseSuccess(outcome) {
  if (!outcome || outcome.code !== 0 || typeof outcome.stdout !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(outcome.stdout);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeDiagnosticStderr(stderr) {
  if (typeof stderr !== 'string' || !stderr.trim()) return '';
  return stderr
    .replace(/((?:authorization|cookie|credential|password|secret|token)\s*(?:=|:)\s*)(?:Bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, MAX_DIAGNOSTIC_STDERR_CHARS);
}

function elapsedMilliseconds(start, end) {
  const value = Number(end) - Number(start);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function summarize(outcome, document, durationMs = 0) {
  if (outcome?.skipped) {
    return {
      status: 'skipped',
      durationMs: 0,
      ...(typeof outcome.skipReason === 'string' ? { skipReason: outcome.skipReason } : {}),
    };
  }
  const summary = {
    status: document ? 'success' : 'failed',
    exitCode: Number.isInteger(outcome?.code) ? outcome.code : 1,
    durationMs,
  };
  if (!document) {
    summary.timedOut = Boolean(outcome?.timedOut);
    const stderr = safeDiagnosticStderr(outcome?.stderr);
    if (stderr) summary.stderr = stderr;
  }
  return summary;
}

async function defaultMerge({ hotDoc, sxDoc, warnings }) {
  const declarations = parseDeclarations(await readFile(adaptersPath, 'utf8'));
  const publicUrlNormalizer = (url) => normalizeUrl(url, declarations, { preserveHostname: true });
  const identityNormalizer = (url) => normalizeUrl(url, declarations);
  return mergeDocuments({
    hotDoc,
    sxDoc,
    arDoc: null,
    normalizer: publicUrlNormalizer,
    identityNormalizer,
    inputWarnings: warnings,
  });
}

function mergeHotWaves(documents, query) {
  const valid = documents.filter((document) => document && typeof document === 'object');
  if (!valid.length) return null;
  return {
    channel: 'hot_discovery',
    query,
    dimensions: [...new Set(valid.flatMap((document) => document.dimensions || []))],
    effectiveDimensions: [...new Set(valid.flatMap((document) => document.effectiveDimensions || []))],
    observedAt: valid[0].observedAt,
    bycliVersion: valid.find((document) => document.bycliVersion)?.bycliVersion || null,
    adaptersSelected: valid.reduce((total, document) => total + (document.adaptersSelected || 0), 0),
    candidates: valid.flatMap((document) => Array.isArray(document.candidates) ? document.candidates : []),
    adapterStats: Object.assign({}, ...valid.map((document) => document.adapterStats || {})),
    warnings: valid.flatMap((document) => Array.isArray(document.warnings) ? document.warnings : []),
    ...(valid.find((document) => document.requiresUserAction)?.requiresUserAction
      ? { requiresUserAction: valid.find((document) => document.requiresUserAction).requiresUserAction }
      : {}),
  };
}

function attemptedAdapterCount(hotDoc) {
  const skipped = new Set([
    'not_in_declarations', 'not_in_catalog', 'unavailable', 'limit_flag_missing',
    'skipped_after_sufficient_candidates', 'skipped_total_budget', 'skipped_user_action',
  ]);
  return Object.values(hotDoc?.adapterStats || {})
    .filter((stats) => stats?.status && !skipped.has(stats.status)).length;
}

export async function runPublicDiscover(paths, args, options = {}) {
  const now = options.now || (() => performance.now());
  const totalStartedAt = now();
  const { session } = loadSession(paths, { persistMigration: false });
  const sourceScope = Array.isArray(session.task?.sourceScope) ? session.task.sourceScope : [];
  if (!sourceScope.includes('public-internet')) {
    throw new Error('session task.sourceScope 必须包含 public-internet 才能执行公共发现');
  }
  const query = requireText(args?.query, '--query');
  const category = typeof args?.category === 'string' && args.category.trim() ? args.category.trim() : 'general';
  withSessionLock(paths, 'public-discover-reserve', () => {
    const current = loadSession(paths, { persistMigration: false }).session;
    if (!current.task.discoveryGate) {
      throw new Error('DISCOVERY_RELEVANCE_MIGRATION_REQUIRED: 缺少公共发现 gate 的旧会话必须新建内部 run');
    }
    reserveDiscoveryAttempt(current.task.discoveryGate, { query, category });
    persistSession(paths, current);
  });
  const topicContract = loadSession(paths, { persistMigration: false }).session.task.discoveryGate.topicContract;
  try {
  const language = typeof args?.language === 'string' && args.language.trim() ? args.language.trim() : 'all';
  const pageno = String(args?.pageno || '1');
  const maxResults = String(args?.['max-results'] || '20');
  const requestedCount = args?.['requested-count'] === undefined ? null : String(args['requested-count']);
  const profileEnabled = isChineseArticleProfile(session, args);
  const profileStopAfter = requestedCount === null ? null
    : Math.max(Number(requestedCount) * 3, 5);
  const effectiveMaxResults = profileEnabled ? String(profileStopAfter) : (requestedCount || maxResults);
  const processTimeout = String(args?.timeout || DEFAULT_SEARXNG_PROCESS_TIMEOUT_SECONDS);
  const timeRange = typeof args?.['time-range'] === 'string' && args['time-range'].trim()
    ? args['time-range'].trim() : null;
  const tiers = typeof args?.tiers === 'string' && args.tiers.trim() ? args.tiers.trim() : '1,2,3';
  const limit = String(args?.limit || '20');
  const inputDir = requireText(paths?.inputDir, '会话 inputDir');
  const prefix = `public-discovery-${Date.now()}-${randomUUID()}`;
  const searxngSnapshot = snapshotPath(inputDir, `${prefix}-searxng.json`);
  const hotSnapshot = snapshotPath(inputDir, `${prefix}-hot-discovery.json`);
  const mergedSnapshot = snapshotPath(inputDir, `${prefix}-merged.json`);
  const searxngRuntime = resolveSearxngRuntime(options);
  const runSearxngProcess = options.runProcess || runPublicProcess;
  const runHotDiscoveryProcess = options.runProcess || runPublicProcess;
  const processTimeoutMs = Math.max(1, Math.ceil(Number(processTimeout) * 1_000));

  const searxngSpec = {
    channel: 'searxng',
    executable: searxngRuntime.executable,
    args: [...searxngRuntime.argsPrefix, query, '--category', category, '--language', language,
      '--pageno', pageno, '--max-results', effectiveMaxResults,
      '--timeout', String(SEARXNG_REQUEST_TIMEOUT_SECONDS),
      ...(timeRange ? ['--time-range', timeRange] : [])],
  };
  const hotDiscoverySpec = (sources = null, minimumAttempts = null, totalBudgetMs = null) => ({
    channel: 'hot-discovery',
    executable: process.execPath,
    args: [hotDiscoveryScript, 'search', '--query', query, '--tiers', tiers,
      '--limit', requestedCount || limit,
      '--dimensions', profileEnabled ? 'general,news,blogs' : category,
      ...(sources ? [
        '--sources', sources.join(','),
        '--adapter-timeout-ms', '10000',
        ...(minimumAttempts ? ['--minimum-attempts', String(minimumAttempts)] : []),
        ...(totalBudgetMs ? ['--total-budget-ms', String(totalBudgetMs)] : []),
      ] : [])],
  });
  let searxngOutcome;
  let hotOutcome;
  let searxngMs = 0;
  let hotDiscoveryMs = 0;
  const runTimed = async (runner, spec, timeoutMs = processTimeoutMs) => {
    const startedAt = now();
    let outcome;
    try {
      outcome = await runner(spec, { timeoutMs });
    } catch (error) {
      outcome = { code: 1, stdout: '', stderr: error.message };
    }
    return { outcome, durationMs: elapsedMilliseconds(startedAt, now()) };
  };
  if (profileEnabled) {
    const remainingHardMs = Math.max(
      1,
      HARD_DISCOVERY_BUDGET_MS - elapsedMilliseconds(totalStartedAt, now()),
    );
    const firstWaveSources = CHINESE_ARTICLE_SOURCES.slice(0, 3);
    const firstWaveSpec = hotDiscoverySpec(
      firstWaveSources,
      3,
      Math.max(1, SOFT_DISCOVERY_BUDGET_MS - elapsedMilliseconds(totalStartedAt, now())),
    );
    const [searxngRun, hotRun] = await Promise.all([
      runTimed(runSearxngProcess, searxngSpec, remainingHardMs),
      runTimed(runHotDiscoveryProcess, firstWaveSpec, remainingHardMs),
    ]);
    searxngOutcome = searxngRun.outcome;
    searxngMs = searxngRun.durationMs;
    hotDiscoveryMs = hotRun.durationMs;
    const waveDocuments = [parseSuccess(hotRun.outcome)].filter(Boolean);
    for (const source of CHINESE_ARTICLE_SOURCES.slice(3)) {
      const combined = mergeHotWaves(waveDocuments, query);
      if (combined?.requiresUserAction) break;
      const candidates = [
        ...(Array.isArray(parseSuccess(searxngOutcome)?.results) ? parseSuccess(searxngOutcome).results : []),
        ...(Array.isArray(combined?.candidates) ? combined.candidates : []),
      ];
      if (attemptedAdapterCount(combined) >= 3
        && countUniqueEligibleArticles(candidates, topicContract) >= profileStopAfter) break;
      const elapsed = elapsedMilliseconds(totalStartedAt, now());
      if (elapsed >= SOFT_DISCOVERY_BUDGET_MS) break;
      const hardRemaining = Math.max(1, HARD_DISCOVERY_BUDGET_MS - elapsed);
      const wave = await runTimed(
        runHotDiscoveryProcess,
        hotDiscoverySpec([source], 1, SOFT_DISCOVERY_BUDGET_MS - elapsed),
        hardRemaining,
      );
      hotDiscoveryMs += wave.durationMs;
      const document = parseSuccess(wave.outcome);
      if (document) waveDocuments.push(document);
    }
    const combinedHot = mergeHotWaves(waveDocuments, query);
    hotOutcome = combinedHot
      ? { code: 0, stdout: JSON.stringify(combinedHot), stderr: '' }
      : hotRun.outcome;
  } else if (requestedCount === null) {
    const [searxngRun, hotRun] = await Promise.all([
      runTimed(runSearxngProcess, searxngSpec),
      runTimed(runHotDiscoveryProcess, hotDiscoverySpec()),
    ]);
    searxngOutcome = searxngRun.outcome;
    searxngMs = searxngRun.durationMs;
    hotOutcome = hotRun.outcome;
    hotDiscoveryMs = hotRun.durationMs;
  } else {
    const searxngRun = await runTimed(runSearxngProcess, searxngSpec);
    searxngOutcome = searxngRun.outcome;
    searxngMs = searxngRun.durationMs;
    const requestedSxDoc = parseSuccess(searxngOutcome);
    const requestedCandidates = Array.isArray(requestedSxDoc?.results) ? requestedSxDoc.results : [];
    if (countUniqueEligibleArticles(requestedCandidates, topicContract) >= Number(requestedCount)) {
      hotOutcome = { skipped: true, skipReason: 'sufficient_article_candidates' };
    } else {
      const hotRun = await runTimed(runHotDiscoveryProcess, hotDiscoverySpec());
      hotOutcome = hotRun.outcome;
      hotDiscoveryMs = hotRun.durationMs;
    }
  }

  const sxDoc = parseSuccess(searxngOutcome);
  const hotDoc = parseSuccess(hotOutcome);
  if (!sxDoc && !hotDoc) {
    const failure = hotOutcome?.skipped
      ? 'SearXNG 未返回有效结果'
      : 'SearXNG 与 hot-discovery 均未返回有效结果';
    withSessionLock(paths, 'public-discover-failed', () => {
      const current = loadSession(paths, { persistMigration: false }).session;
      recordDiscoveryResult(current.task.discoveryGate, { query, category, candidates: [], error: failure });
      persistSession(paths, current);
    });
    throw new Error(failure);
  }

  const channelDiagnostics = {
    searxng: summarize(searxngOutcome, sxDoc, searxngMs),
    hotDiscovery: summarize(hotOutcome, hotDoc, hotDiscoveryMs),
  };
  const warnings = [];
  if (!sxDoc) warnings.push(`SearXNG 发现失败（exit ${channelDiagnostics.searxng.exitCode}）`);
  if (!hotDoc && !hotOutcome?.skipped) {
    warnings.push(`hot-discovery 发现失败（exit ${channelDiagnostics.hotDiscovery.exitCode}）`);
  }
  if (sxDoc) await writeFile(searxngSnapshot, `${JSON.stringify(sxDoc, null, 2)}\n`, 'utf8');
  if (hotDoc) await writeFile(hotSnapshot, `${JSON.stringify(hotDoc, null, 2)}\n`, 'utf8');

  const merge = options.merge || defaultMerge;
  const mergeStartedAt = now();
  const mergedDocument = await merge({ hotDoc, sxDoc, warnings });
  const annotatedMerged = annotateMergedCandidates(mergedDocument, topicContract);
  const candidateQuality = {
    searxng: classifyCandidates(Array.isArray(sxDoc?.results) ? sxDoc.results : [], topicContract),
    merged: summarizeMergedQuality(annotatedMerged),
  };
  const mergeAndClassifyMs = elapsedMilliseconds(mergeStartedAt, now());
  const timing = {
    searxngMs,
    hotDiscoveryMs,
    mergeAndClassifyMs,
    totalMs: elapsedMilliseconds(totalStartedAt, now()),
  };
  const authorization = withSessionLock(paths, 'public-discover-record', () => {
    const current = loadSession(paths, { persistMigration: false }).session;
    const result = recordDiscoveryResult(current.task.discoveryGate, {
      query,
      category,
      candidates: mergedCandidates(annotatedMerged),
    });
    persistSession(paths, current);
    return { state: current.task.discoveryGate, result };
  });
  const discoveryProfile = profileEnabled ? {
    name: 'chinese-article',
    sources: [...CHINESE_ARTICLE_SOURCES],
    stopAfter: profileStopAfter,
    minimumAttempts: 3,
    budget: { softMs: SOFT_DISCOVERY_BUDGET_MS, hardMs: HARD_DISCOVERY_BUDGET_MS },
  } : null;
  const selectedCandidate = authorization.result.articleCandidates[0] || null;
  const merged = {
    ...annotatedMerged,
    channelDiagnostics,
    candidateQuality,
    timing,
    selectedCandidate,
    ...(discoveryProfile ? { discoveryProfile } : {}),
  };
  await writeFile(mergedSnapshot, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

    return {
    ok: true,
    action: 'public-discover',
    query,
    category,
    requestedDimensions: [category],
    hotDiscovery: hotDoc ? {
      requestedDimensions: Array.isArray(hotDoc.dimensions) ? hotDoc.dimensions : [category],
      effectiveDimensions: Array.isArray(hotDoc.effectiveDimensions) ? hotDoc.effectiveDimensions : [category],
    } : null,
    channels: channelDiagnostics,
    candidateQuality,
    discoveryAuthorization: {
      attemptCount: authorization.state.attemptCount,
      maxAttempts: authorization.state.maxAttempts,
      exhausted: authorization.state.exhausted,
      stopReason: authorization.state.stopReason,
      stopDetail: authorization.state.stopDetail,
      articleCandidateIds: authorization.result.articleCandidates.map((candidate) => candidate.candidateId),
      structuralArticleCandidateIds: authorization.result.structuralArticleCandidates
        .map((candidate) => candidate.candidateId),
    },
    selectedCandidate,
    timing,
    ...(discoveryProfile ? { discoveryProfile } : {}),
    snapshots: {
      searxng: sxDoc ? searxngSnapshot : null,
      hotDiscovery: hotDoc ? hotSnapshot : null,
      merged: mergedSnapshot,
    },
    merged,
    ...(merged.requiresUserAction ? { requiresUserAction: merged.requiresUserAction } : {}),
    warnings,
    };
  } catch (error) {
    withSessionLock(paths, 'public-discover-error', () => {
      const current = loadSession(paths, { persistMigration: false }).session;
      const running = current.task.discoveryGate?.runs?.at(-1)?.status === 'running';
      if (running) {
        recordDiscoveryResult(current.task.discoveryGate, {
          query,
          category,
          candidates: [],
          error: error instanceof Error ? error.message : String(error),
        });
        persistSession(paths, current);
      }
    });
    throw error;
  }
}
