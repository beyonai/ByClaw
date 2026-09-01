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

export async function runPublicDiscover(paths, args, options = {}) {
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
  const effectiveMaxResults = requestedCount || maxResults;
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
  const now = options.now || (() => performance.now());
  const totalStartedAt = now();
  const processTimeoutMs = Math.max(1, Math.ceil(Number(processTimeout) * 1_000));

  const searxngSpec = {
    channel: 'searxng',
    executable: searxngRuntime.executable,
    args: [...searxngRuntime.argsPrefix, query, '--category', category, '--language', language,
      '--pageno', pageno, '--max-results', effectiveMaxResults,
      '--timeout', String(SEARXNG_REQUEST_TIMEOUT_SECONDS),
      ...(timeRange ? ['--time-range', timeRange] : [])],
  };
  const hotDiscoverySpec = {
    channel: 'hot-discovery',
    executable: process.execPath,
    args: [hotDiscoveryScript, 'search', '--query', query, '--tiers', tiers,
      '--limit', requestedCount || limit, '--dimensions', category],
  };
  let searxngOutcome;
  let hotOutcome;
  let searxngMs = 0;
  let hotDiscoveryMs = 0;
  const runTimed = async (runner, spec) => {
    const startedAt = now();
    let outcome;
    try {
      outcome = await runner(spec, { timeoutMs: processTimeoutMs });
    } catch (error) {
      outcome = { code: 1, stdout: '', stderr: error.message };
    }
    return { outcome, durationMs: elapsedMilliseconds(startedAt, now()) };
  };
  if (requestedCount === null) {
    const [searxngRun, hotRun] = await Promise.all([
      runTimed(runSearxngProcess, searxngSpec),
      runTimed(runHotDiscoveryProcess, hotDiscoverySpec),
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
      const hotRun = await runTimed(runHotDiscoveryProcess, hotDiscoverySpec);
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
  const merged = { ...annotatedMerged, channelDiagnostics, candidateQuality, timing };
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
    timing,
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
