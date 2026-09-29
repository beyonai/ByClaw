import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mergeDocuments,
  normalizeUrl,
  parseDeclarations,
  selectAdaptersForDimensions,
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
  finalizeOpenDiscoveryAttempt,
} from './discovery-authorization.mjs';
import { loadSession, persistSession, withSessionLock } from './session.mjs';
import { assertSessionWorkflowAllowsCommand } from './probe-state.mjs';
import { runCli } from './enterprise/shared/cli-runner.mjs';
import { runOnlineSearch as defaultRunOnlineSearch } from './online-search/provider.mjs';
import { planDiscovery as defaultPlanDiscovery } from './jev/query-planner.mjs';
import { rankCandidates as defaultRankCandidates } from './jev/candidate-ranker.mjs';
import { collectionFeedback, collectedPublicCandidates } from './jev/delivery-policy.mjs';
import { runHotDiscoveryWave } from './hot-discovery-runtime.mjs';
import { planSourceWaves, sourcePlanIdentity } from './jev/source-plan.mjs';
import { researchEvidenceContext } from './jev/research-evidence.mjs';
import { resolveTypeSafeCapability } from './jev/typesafe.mjs';

export { resolveSearxngRuntime } from './online-search/searxng.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const onlineSearchRoot = resolve(scriptDir, '../references/online-search');
const hotDiscoveryScript = join(onlineSearchRoot, 'references/hot_discovery/scripts/hot_discovery.mjs');
const adaptersPath = join(onlineSearchRoot, 'references/hot_discovery/adapters.md');
const MAX_DIAGNOSTIC_STDERR_CHARS = 2_000;
const DEFAULT_SEARXNG_PROCESS_TIMEOUT_SECONDS = 60;
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
    status: document ? (document.status === 'partial' ? 'partial' : 'success') : 'failed',
    exitCode: Number.isInteger(outcome?.code) ? outcome.code : 1,
    durationMs,
  };
  if (document?.recoveredFromCheckpoint) {
    summary.recoveredFromCheckpoint = true;
    summary.exitCode = document.processDiagnostic?.exitCode ?? summary.exitCode;
    summary.timedOut = Boolean(document.processDiagnostic?.timedOut);
  }
  if (document?.stopReason) summary.stopReason = document.stopReason;
  if (document?.timing) summary.timing = document.timing;
  if (!document) {
    summary.timedOut = Boolean(outcome?.timedOut);
    const stderr = safeDiagnosticStderr(outcome?.stderr);
    if (stderr) summary.stderr = stderr;
  }
  if (typeof outcome?.provider === 'string') summary.provider = outcome.provider;
  if (typeof outcome?.fallbackUsed === 'boolean') summary.fallbackUsed = outcome.fallbackUsed;
  if (outcome?.providerDiagnostics && typeof outcome.providerDiagnostics === 'object') {
    summary.providerDiagnostics = outcome.providerDiagnostics;
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
    status: valid.some((document) => document.status === 'partial') ? 'partial' : 'complete',
    stopReason: valid.find((document) => document.status === 'partial')?.stopReason
      || valid.at(-1).stopReason || 'sources_exhausted',
    timing: {
      runtimeMs: valid.reduce((total, doc) => total + (doc.timing?.runtimeMs || 0), 0),
      bridgeMs: valid.reduce((total, doc) => total + (doc.timing?.bridgeMs || 0), 0),
      runtimeCacheHits: valid.filter((doc) => doc.timing?.runtimeCacheHit).length,
      waves: valid.length,
    },
    ...(valid.some((doc) => doc.recoveredFromCheckpoint) ? {
      recoveredFromCheckpoint: true,
      processDiagnostic: valid.find((doc) => doc.recoveredFromCheckpoint).processDiagnostic,
    } : {}),
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

function applyCandidateRanking(document, rankedCandidates) {
  const order = new Map();
  const ranking = new Map();
  rankedCandidates.forEach((candidate, index) => {
    if (typeof candidate?.url !== 'string') return;
    order.set(candidate.url, index);
    if (candidate.ranking) ranking.set(candidate.url, candidate.ranking);
  });
  const decorate = (candidates) => (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ranking.has(candidate?.url)
      ? { ...candidate, ranking: ranking.get(candidate.url) }
      : candidate)
    .sort((a, b) => (order.get(a?.url) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(b?.url) ?? Number.MAX_SAFE_INTEGER));
  const groups = document?.groups && typeof document.groups === 'object' ? document.groups : {};
  return {
    ...document,
    groups: {
      ...groups,
      bothChannels: decorate(groups.bothChannels),
      searxngTop: decorate(groups.searxngTop),
      agentReachTop: decorate(groups.agentReachTop),
      hotBySource: Object.fromEntries(Object.entries(groups.hotBySource || {})
        .map(([source, candidates]) => [source, decorate(candidates)])),
      hotWithoutPopularity: decorate(groups.hotWithoutPopularity),
      unverified: decorate(groups.unverified),
    },
  };
}

function validSourcePlan(plan, sources) {
  if (plan?.diagnostic?.status !== 'used' || !Array.isArray(plan.waves) || !plan.waves.length
    || !Number.isInteger(plan.cursor) || plan.cursor < 0 || plan.cursor > plan.waves.length
    || plan.waves.some((wave) => !Array.isArray(wave) || wave.length < 1 || wave.length > 3)) return false;
  const values = plan.waves.flat();
  return values.length === sources.length && new Set(values).size === values.length
    && values.every((value) => sources.includes(value));
}

export async function runPublicDiscover(paths, args, options = {}) {
  const now = options.now || (() => performance.now());
  const totalStartedAt = now();
  const { session } = loadSession(paths, { persistMigration: false });
  const sourceScope = Array.isArray(session.task?.sourceScope) ? session.task.sourceScope : [];
  if (!sourceScope.includes('public-internet')) {
    throw new Error('session task.sourceScope 必须包含 public-internet 才能执行公共发现');
  }
  let query = requireText(args?.query, '--query');
  let category = typeof args?.category === 'string' && args.category.trim() ? args.category.trim() : 'general';
  // Search planning must never change the parent workflow's reservation identity.
  const reservationIdentity = { query, category };
  const budgetNow = options.budgetNow || (() => performance.now());
  const budgetStartedAt = budgetNow();
  const discoveryBudgetMs = Math.max(1, Number(args?.timeout || DEFAULT_SEARXNG_PROCESS_TIMEOUT_SECONDS) * 1_000);
  const remainingBudgetMs = () => Math.max(0, Math.min(
    discoveryBudgetMs - (budgetNow() - budgetStartedAt),
    options.remainingBudgetMs ? options.remainingBudgetMs() : Infinity,
  ));
  // Optional inference leaves most of the remaining budget for discovery and verification.
  const enhancementBudget = () => {
    const deadline = budgetNow() + Math.min(10_000, remainingBudgetMs() / 10);
    return () => Math.max(0, Math.min(deadline - budgetNow(), remainingBudgetMs()));
  };
  withSessionLock(paths, 'public-discover-reserve', () => {
    const current = loadSession(paths, { persistMigration: false }).session;
    if (!current.task.discoveryGate) {
      throw new Error('DISCOVERY_RELEVANCE_MIGRATION_REQUIRED: 缺少公共发现 gate 的旧会话必须新建内部 run');
    }
    const ownedOrchestration = options.orchestrationRunId !== undefined;
    if (!ownedOrchestration) assertSessionWorkflowAllowsCommand(current, 'public-discover');
    if (ownedOrchestration && (current.task.activeOrchestrationRunId !== options.orchestrationRunId
      || current.task.publicCollectRun?.runId !== options.orchestrationRunId
      || current.task.discoveryGate.schemaVersion !== '2.0')) {
      throw new Error(`ORCHESTRATION_OWNER_MISMATCH: ${options.orchestrationRunId}`);
    }
    const openAttempt = current.task.discoveryGate.runs?.at(-1);
    const reservation = current.task.publicCollectRun?.discoveryReservation;
    const continueOwnedChannel = ownedOrchestration
      && openAttempt?.status === 'running' && openAttempt.query === query
      && openAttempt.category === category && reservation?.query === query
      && reservation?.channel === options.channelMode;
    if (!continueOwnedChannel) {
      reserveDiscoveryAttempt(current.task.discoveryGate, {
        query, category, allowCandidateRetry: ownedOrchestration,
      });
    }
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
  const effectiveMaxResults = profileEnabled ? String(profileStopAfter)
    : (options.orchestrationRunId !== undefined ? maxResults : (requestedCount || maxResults));
  const processTimeout = String(args?.timeout || DEFAULT_SEARXNG_PROCESS_TIMEOUT_SECONDS);
  let timeRange = typeof args?.['time-range'] === 'string' && args['time-range'].trim()
    ? args['time-range'].trim() : null;
  const planner = options.planDiscovery || defaultPlanDiscovery;
  const planningInput = {
    request: session.task?.query || query,
    query,
    category,
    language,
    timeRange,
    queryCandidates: [...new Set([query, session.task?.query].filter((value) => typeof value === 'string' && value.trim()))],
    categoryCandidates: args?.category?.trim() ? [category] : [...new Set([category, 'general', 'news', 'it', 'science'])],
    timeRangeCandidates: timeRange ? [timeRange] : [null, 'day', 'week', 'month', 'year'],
    sourceCandidates: ['automatic', 'github', 'arxiv'],
    ...(profileEnabled ? { hotSourceCandidates: [...CHINESE_ARTICLE_SOURCES] } : {}),
  };
  const capability = resolveTypeSafeCapability(options.environment || process.env);
  const tiers = typeof args?.tiers === 'string' && args.tiers.trim() ? args.tiers.trim() : '1,2,3';
  const channelMode = options.channelMode || 'all';
  const executionIdentity = sourcePlanIdentity({ ...reservationIdentity, language, tiers, requestedCount,
    sources: args.sources || null, limit: args.limit || '20', profileEnabled,
    round: session.task.publicCollectRun?.discoveryRounds.length });
  const previousExecution = channelMode === 'hot'
    && session.task.publicCollectRun?.hotDiscoveryExecution?.identity === executionIdentity
    ? session.task.publicCollectRun.hotDiscoveryExecution : null;
  const recovery = options.orchestrationRunId !== undefined
    ? session.task.publicCollectRun?.discoveryReservation?.recovery : null;
  const onlineReservation = session.task.publicCollectRun?.discoveryReservation;
  const ownsOnlineReservation = options.orchestrationRunId !== undefined && channelMode === 'online'
    && onlineReservation?.channel === 'online' && onlineReservation.phase === 'reserved'
    && onlineReservation.query === reservationIdentity.query
    && onlineReservation.round === session.task.publicCollectRun.discoveryRounds.length + 1;
  const onlineIdentity = sourcePlanIdentity({ runId: options.orchestrationRunId,
    round: onlineReservation?.round, planningInput, sourceScope, topicContract,
    pageno, effectiveMaxResults, requestedCount, profileEnabled });
  const validOnlineEffective = (effective) => effective
    && planningInput.queryCandidates.includes(effective.query)
    && planningInput.categoryCandidates.includes(effective.category)
    && planningInput.timeRangeCandidates.includes(effective.timeRange)
    && planningInput.sourceCandidates.includes(effective.source)
    && effective.language === language;
  const savedOnlineExecution = ownsOnlineReservation && recovery === 'resume'
    ? session.task.publicCollectRun.onlineDiscoveryExecution : null;
  if (savedOnlineExecution && (savedOnlineExecution.identity !== onlineIdentity
    || !validOnlineEffective(savedOnlineExecution.effective))) {
    throw new Error('ONLINE_DISCOVERY_EXECUTION_INVALID: continuation does not match the authorized request');
  }
  const sourcePlanEligible = channelMode !== 'online' && requestedCount !== null
    && session.task.materializationTarget !== 'all';
  let sourcePlan = null;
  let sourcePlanning = { status: 'skipped', code: 'SOURCE_PLAN_NOT_REQUIRED' };
  let sourcePlanInput = null;
  let sourcePlanInputForCategory = null;
  let authorizedSources = null;
  let sourceMetadata = null;
  const previous = session.task.publicCollectRun?.hotSourcePlan;
  // A dispatched legacy wave is authoritative too: new advice cannot replace its
  // checkpoint identity, source progress, skip target, or remaining budget.
  const freshSourcePlanning = !previousExecution && capability.status !== 'disabled'
    && (capability.status === 'configured' || options.planSourceWaves || options.callJev);
  if (sourcePlanEligible && (previous || freshSourcePlanning)) {
    const declarations = parseDeclarations(await readFile(adaptersPath, 'utf8'));
    sourceMetadata = declarations.adapters;
    const explicit = typeof args.sources === 'string' ? args.sources.split(',').map((value) => value.trim()) : null;
    // An admitted source plan is execution state. Its identity excludes later
    // optional answers and the current model. The admitted category determines
    // complete source membership, while the original request remains immutable.
    const sourcesForCategory = (selectedCategory) => {
      const dimensions = [...new Set([...(profileEnabled ? ['general', 'news', 'blogs'] : [selectedCategory]), 'general'])];
      const allowed = selectAdaptersForDimensions(declarations.adapters, dimensions,
        new Set(tiers.split(',').map((value) => Number(value.trim())))).selected.map((adapter) => adapter.site);
      return (explicit || (profileEnabled ? [...CHINESE_ARTICLE_SOURCES] : allowed))
        .filter((source) => allowed.includes(source));
    };
    sourcePlanInputForCategory = (selectedCategory) => ({
      query: reservationIdentity.query,
      effectiveCategory: selectedCategory,
      sources: sourcesForCategory(selectedCategory),
      constraints: {
        category: reservationIdentity.category, tiers, explicit, language, requestedCount,
        taskQuery: session.task.query, sourceScope, topicContract,
        declarationIdentity: sourcePlanIdentity(declarations),
      },
    });
    if (previous && planningInput.categoryCandidates.includes(previous.effective?.category)) {
      sourcePlanInput = sourcePlanInputForCategory(previous.effective.category);
      authorizedSources = sourcePlanInput.sources;
    }
    if (sourcePlanInput && previous?.identity === sourcePlanIdentity(sourcePlanInput)
      && validSourcePlan(previous, authorizedSources)
      && planningInput.queryCandidates.includes(previous.effective?.query)
      && planningInput.timeRangeCandidates.includes(previous.effective?.timeRange)
      && planningInput.sourceCandidates.includes(previous.effective?.source || 'automatic')
      && (!previous.effective?.hotSource || planningInput.hotSourceCandidates?.includes(previous.effective.hotSource))
      && Array.isArray(previous.waveIds) && previous.waveIds.length === previous.waves.length
      && new Set(previous.waveIds).size === previous.waveIds.length
      && previous.waveIds.every((id) => typeof id === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      sourcePlan = previous;
    }
  }
  if (sourcePlanEligible && previous && !sourcePlan) {
    sourcePlanning = { status: 'fallback', code: 'SOURCE_PLAN_INVALID' };
  }
  let planned = savedOnlineExecution
    ? { effective: savedOnlineExecution.effective, jev: { status: 'skipped', code: 'ONLINE_DISCOVERY_RESUMED' } }
    : sourcePlan
    ? { effective: sourcePlan.effective, jev: { status: 'skipped', code: 'SOURCE_PLAN_RESUMED' } }
    : previousExecution
      ? { effective: previousExecution.effective, jev: { status: 'skipped', code: 'HOT_DISCOVERY_RESUMED' } }
    : sourcePlanEligible && previous
      ? { effective: { query: planningInput.query, category: planningInput.category,
        language, timeRange, source: 'automatic' },
      jev: { status: 'fallback', code: 'SOURCE_PLAN_INVALID' } }
      : await planner(planningInput, { environment: options.environment || process.env,
        signal: options.signal, callJev: options.callJev, remainingBudgetMs: enhancementBudget(),
        deferHotSource: (channelMode === 'online' && profileEnabled)
          || Boolean(sourcePlanEligible && freshSourcePlanning) });
  query = planned.effective.query;
  category = planned.effective.category;
  timeRange = planned.effective.timeRange;
  if (sourcePlanEligible && !sourcePlan && !previous && freshSourcePlanning) {
      sourcePlanInput = sourcePlanInputForCategory(category);
      authorizedSources = sourcePlanInput.sources;
      const selected = await (options.planSourceWaves || planSourceWaves)(sourcePlanInput, {
        environment: options.environment || process.env, signal: options.signal,
        callJev: options.callJev, remainingBudgetMs,
        sourceMetadata: sourceMetadata.filter((adapter) => authorizedSources.includes(adapter.site))
          .map(({ site, tier, dimensions }) => ({ site, tier, dimensions })),
      });
      sourcePlanning = selected.diagnostic;
      if (selected.identity === sourcePlanIdentity(sourcePlanInput)
        && validSourcePlan({ ...selected, cursor: 0 }, authorizedSources)) {
        sourcePlan = { ...selected, cursor: 0, nextWave: true, createdAt: Date.now(),
          effective: { query, category, timeRange, source: planned.effective.source,
            ...(planned.effective.hotSource ? { hotSource: planned.effective.hotSource } : {}) },
          waveIds: selected.waves.map(() => randomUUID()) };
        if (options.orchestrationRunId !== undefined) withSessionLock(paths, 'public-discover-source-plan', () => {
          const current = loadSession(paths, { persistMigration: false }).session;
          if (current.task.activeOrchestrationRunId !== options.orchestrationRunId) throw new Error('ORCHESTRATION_OWNER_MISMATCH');
          current.task.publicCollectRun.hotSourcePlan = sourcePlan;
          persistSession(paths, current);
        });
      }
  }
  if (!sourcePlan && sourcePlanEligible && !previous && freshSourcePlanning
    && profileEnabled && !planned.effective.hotSource) {
    const hotOnlyInput = { ...planningInput, query, category, timeRange,
      queryCandidates: [query], categoryCandidates: [category], timeRangeCandidates: [timeRange],
      sourceCandidates: [planned.effective.source] };
    const hotOnly = await planner(hotOnlyInput, { environment: options.environment || process.env,
      signal: options.signal, callJev: options.callJev, remainingBudgetMs: enhancementBudget() });
    if (planningInput.hotSourceCandidates.includes(hotOnly.effective?.hotSource)) {
      planned = { ...planned, effective: { ...planned.effective, hotSource: hotOnly.effective.hotSource } };
    }
  }
  if (sourcePlan) {
    ({ query, category, timeRange } = sourcePlan.effective);
    sourcePlanning = sourcePlan.diagnostic;
  }
  const hotSources = [...CHINESE_ARTICLE_SOURCES];
  if (hotSources.includes(planned.effective.hotSource)) {
    hotSources.splice(hotSources.indexOf(planned.effective.hotSource), 1);
    hotSources.unshift(planned.effective.hotSource);
  }
  const limit = String(args?.limit || '20');
  const inputDir = requireText(paths?.inputDir, '会话 inputDir');
  const prefix = `public-discovery-${Date.now()}-${randomUUID()}`;
  const runtimeRunId = options.orchestrationRunId || prefix;
  const searxngSnapshot = snapshotPath(inputDir, `${prefix}-searxng.json`);
  const hotSnapshot = snapshotPath(inputDir, `${prefix}-hot-discovery.json`);
  const mergedSnapshot = snapshotPath(inputDir, `${prefix}-merged.json`);
  const runOnlineSearch = options.runOnlineSearch || defaultRunOnlineSearch;
  const runHotDiscoveryProcess = (spec, runOptions) => runHotDiscoveryWave(
    spec, options.runProcess || runPublicProcess, { ...runOptions, recovery },
  );
  const processTimeoutMs = Math.max(1, Math.ceil(Number(processTimeout) * 1_000));

  const onlineSearchArgs = {
    query,
    category,
    language,
    pageno,
    'max-results': effectiveMaxResults,
    ...(planned.effective.source !== 'automatic' ? { source: planned.effective.source } : {}),
    ...(requestedCount && options.orchestrationRunId === undefined
      ? { 'requested-count': requestedCount } : {}),
    ...(timeRange ? { 'time-range': timeRange } : {}),
  };
  if (ownsOnlineReservation) {
    if (!validOnlineEffective(planned.effective)) {
      throw new Error('ONLINE_DISCOVERY_EXECUTION_INVALID: effective parameters exceed the authorized request');
    }
    withSessionLock(paths, 'public-discover-online-execution', () => {
      const current = loadSession(paths, { persistMigration: false }).session;
      const run = current.task.publicCollectRun;
      const reservation = run?.discoveryReservation;
      if (current.task.activeOrchestrationRunId !== options.orchestrationRunId
        || run?.runId !== options.orchestrationRunId || run.status !== 'running'
        || reservation?.channel !== 'online' || reservation.phase !== 'reserved'
        || reservation.query !== reservationIdentity.query
        || reservation.round !== onlineReservation.round
        || reservation.round !== run.discoveryRounds.length + 1) {
        throw new Error('ORCHESTRATION_OWNER_MISMATCH');
      }
      run.onlineDiscoveryExecution = { identity: onlineIdentity, effective: {
        query, category, language, timeRange, source: planned.effective.source,
      } };
      persistSession(paths, current);
    });
  }
  const runOnlineSearchChannel = async (_spec, { timeoutMs }) => {
    const result = await runOnlineSearch(onlineSearchArgs, {
      timeoutMs,
      signal: options.signal,
      environment: options.environment || process.env,
      runProcess: options.runProcess || runPublicProcess,
      pythonExecutable: options.pythonExecutable,
      searxngScript: options.searxngScript,
      wsaClient: options.wsaClient,
      wsaCapabilities: options.wsaCapabilities,
      coverageRequired: session.task.materializationTarget === 'all',
    });
    return result?.ok && result.document
      ? { code: 0, stdout: JSON.stringify(result.document), stderr: '' }
      : {
        code: 1,
        stdout: '',
        stderr: result?.providerDiagnostics?.searxng?.message
          || JSON.stringify(result?.error || { code: 'ONLINE_SEARCH_FAILED' }),
        provider: result?.provider,
        fallbackUsed: result?.fallbackUsed,
        providerDiagnostics: result?.providerDiagnostics,
      };
  };
  const onlineSearchSpec = { channel: 'online-search' };
  const hotExecution = previousExecution || { identity: executionIdentity, effective: planned.effective, waveIds: {} };
  const hotDiscoverySpec = (sources = null, minimumAttempts = null, totalBudgetMs = null, waveId = null) => {
    if (!waveId && options.orchestrationRunId !== undefined) {
      const key = sourcePlanIdentity({ sources, minimumAttempts });
      waveId = hotExecution.waveIds[key] ||= randomUUID();
      withSessionLock(paths, 'public-discover-hot-execution', () => {
        const current = loadSession(paths, { persistMigration: false }).session;
        if (current.task.activeOrchestrationRunId !== options.orchestrationRunId) throw new Error('ORCHESTRATION_OWNER_MISMATCH');
        current.task.publicCollectRun.hotDiscoveryExecution = hotExecution;
        persistSession(paths, current);
      });
    }
    return {
      channel: 'hot-discovery',
      executable: process.execPath,
      args: [hotDiscoveryScript, 'search', '--query', query, '--tiers', tiers,
        '--limit', requestedCount || limit,
        '--dimensions', profileEnabled ? 'general,news,blogs' : category,
        ...(sources ? ['--sources', sources.join(',')] : args.sources ? ['--sources', args.sources] : []),
        '--state-dir', inputDir, '--run-id', runtimeRunId, '--wave-id', waveId || randomUUID(),
        '--adapter-timeout-ms', '10000',
        ...(minimumAttempts ? ['--minimum-attempts', String(minimumAttempts)] : []),
        '--total-budget-ms', String(Math.max(1, Math.floor(Math.min(
          totalBudgetMs ?? 90_000,
          processTimeoutMs * 0.75,
          remainingBudgetMs() * 0.75,
        ))))],
    };
  };
  let searxngOutcome;
  let hotOutcome;
  let searxngMs = 0;
  let hotDiscoveryMs = 0;
  let nextHotWave = false;
  let completedSourceCursor = sourcePlan?.cursor || 0;
  const runTimed = async (runner, spec, timeoutMs = processTimeoutMs) => {
    const startedAt = now();
    let outcome;
    try {
      const remaining = remainingBudgetMs();
      const boundedTimeout = Math.floor(Math.min(timeoutMs, remaining - Math.min(250, remaining * 0.05)));
      outcome = boundedTimeout < 1
        ? { skipped: true, skipReason: 'budget_exhausted' }
        : await runner(spec, {
        timeoutMs: boundedTimeout,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      outcome = { code: 1, stdout: '', stderr: error.message };
    }
    return { outcome, durationMs: elapsedMilliseconds(startedAt, now()) };
  };
  if (channelMode === 'online') {
    const onlineRun = await runTimed(runOnlineSearchChannel, onlineSearchSpec);
    searxngOutcome = onlineRun.outcome;
    searxngMs = onlineRun.durationMs;
    hotOutcome = { skipped: true, skipReason: 'channel_mode_online' };
  } else if (sourcePlan) {
    const onlineRun = channelMode === 'hot'
      ? { outcome: { skipped: true, skipReason: 'channel_mode_hot' }, durationMs: 0 }
      : await runTimed(runOnlineSearchChannel, onlineSearchSpec);
    searxngOutcome = onlineRun.outcome;
    searxngMs = onlineRun.durationMs;
    const documents = [];
    const onlineEnough = channelMode !== 'hot' && !options.forceHotDiscovery
      && countUniqueEligibleArticles(parseSuccess(searxngOutcome)?.results || [], topicContract) >= Number(requestedCount);
    if (onlineEnough) hotOutcome = { skipped: true, skipReason: 'sufficient_article_candidates' };
    for (let cursor = sourcePlan.cursor; !onlineEnough && cursor < sourcePlan.waves.length; cursor++) {
      const wave = await runTimed(runHotDiscoveryProcess,
        hotDiscoverySpec(sourcePlan.waves[cursor], sourcePlan.waves[cursor].length, null, sourcePlan.waveIds[cursor]));
      hotDiscoveryMs += wave.durationMs;
      hotOutcome = wave.outcome;
      const document = parseSuccess(wave.outcome);
      if (!document) break;
      documents.push(document);
      const interrupted = ['in_progress', 'process_interrupted'].includes(document.stopReason);
      completedSourceCursor = document.requiresUserAction || interrupted ? cursor : cursor + 1;
      nextHotWave = completedSourceCursor < sourcePlan.waves.length
        && document.status !== 'partial' && !document.requiresUserAction && remainingBudgetMs() > 0;
      if (options.orchestrationRunId !== undefined || !nextHotWave) break;
      const candidates = [...(parseSuccess(searxngOutcome)?.results || []), ...documents.flatMap((doc) => doc.candidates || [])];
      if (countUniqueEligibleArticles(candidates, topicContract) >= Number(requestedCount)) { nextHotWave = false; break; }
    }
    const combined = mergeHotWaves(documents, query);
    if (combined) hotOutcome = { code: 0, stdout: JSON.stringify(combined), stderr: '' };
    if (sourcePlan.cursor === sourcePlan.waves.length) hotOutcome = { code: 0, stdout: JSON.stringify({ candidates: [] }), stderr: '' };
  } else if (channelMode === 'hot' && !profileEnabled) {
    searxngOutcome = { skipped: true, skipReason: 'channel_mode_hot' };
    const hotRun = await runTimed(runHotDiscoveryProcess, hotDiscoverySpec());
    hotOutcome = hotRun.outcome;
    hotDiscoveryMs = hotRun.durationMs;
  } else if (profileEnabled) {
    const remainingHardMs = Math.max(
      1,
      HARD_DISCOVERY_BUDGET_MS - elapsedMilliseconds(totalStartedAt, now()),
    );
    const firstWaveSources = hotSources.slice(0, 3);
    const firstWaveSpec = hotDiscoverySpec(
      firstWaveSources,
      3,
      Math.max(1, SOFT_DISCOVERY_BUDGET_MS - elapsedMilliseconds(totalStartedAt, now())),
    );
    const [searxngRun, hotRun] = await Promise.all([
      channelMode === 'hot'
        ? Promise.resolve({ outcome: { skipped: true, skipReason: 'channel_mode_hot' }, durationMs: 0 })
        : runTimed(runOnlineSearchChannel, onlineSearchSpec, remainingHardMs),
      runTimed(runHotDiscoveryProcess, firstWaveSpec, remainingHardMs),
    ]);
    searxngOutcome = searxngRun.outcome;
    searxngMs = searxngRun.durationMs;
    hotDiscoveryMs = hotRun.durationMs;
    const waveDocuments = [parseSuccess(hotRun.outcome)].filter(Boolean);
    for (const source of hotSources.slice(3)) {
      const combined = mergeHotWaves(waveDocuments, query);
      if (combined?.requiresUserAction || combined?.status === 'partial') break;
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
      runTimed(runOnlineSearchChannel, onlineSearchSpec),
      runTimed(runHotDiscoveryProcess, hotDiscoverySpec()),
    ]);
    searxngOutcome = searxngRun.outcome;
    searxngMs = searxngRun.durationMs;
    hotOutcome = hotRun.outcome;
    hotDiscoveryMs = hotRun.durationMs;
  } else {
    const searxngRun = await runTimed(runOnlineSearchChannel, onlineSearchSpec);
    searxngOutcome = searxngRun.outcome;
    searxngMs = searxngRun.durationMs;
    const requestedSxDoc = parseSuccess(searxngOutcome);
    const requestedCandidates = Array.isArray(requestedSxDoc?.results) ? requestedSxDoc.results : [];
    if (!options.forceHotDiscovery
      && countUniqueEligibleArticles(requestedCandidates, topicContract) >= Number(requestedCount)) {
      hotOutcome = { skipped: true, skipReason: 'sufficient_article_candidates' };
    } else {
      const hotRun = await runTimed(runHotDiscoveryProcess, hotDiscoverySpec());
      hotOutcome = hotRun.outcome;
      hotDiscoveryMs = hotRun.durationMs;
    }
  }

  const sxDoc = parseSuccess(searxngOutcome);
  const hotDoc = parseSuccess(hotOutcome);
  const requiresUserAction = hotDoc?.requiresUserAction || sxDoc?.requiresUserAction;
  const infrastructureBlocked = options.orchestrationRunId !== undefined
    && ['in_progress', 'process_interrupted'].includes(hotDoc?.stopReason);
  if (!sxDoc && !hotDoc) {
    const failure = hotOutcome?.skipped
      ? 'SearXNG 未返回有效结果'
      : 'SearXNG 与 hot-discovery 均未返回有效结果';
    if (options.orchestrationRunId === undefined) {
      withSessionLock(paths, 'public-discover-failed', () => {
        const current = loadSession(paths, { persistMigration: false }).session;
        recordDiscoveryResult(current.task.discoveryGate, { ...reservationIdentity, candidates: [], error: failure });
        persistSession(paths, current);
      });
    }
    throw new Error(failure);
  }

  const onlineSearchDiagnostic = {
    ...summarize(searxngOutcome, sxDoc, searxngMs),
    ...(sxDoc?.provider ? { provider: sxDoc.provider } : {}),
    ...(typeof sxDoc?.fallbackUsed === 'boolean' ? { fallbackUsed: sxDoc.fallbackUsed } : {}),
    ...(sxDoc?.providerDiagnostics ? { providerDiagnostics: sxDoc.providerDiagnostics } : {}),
  };
  const channelDiagnostics = {
    searxng: onlineSearchDiagnostic,
    onlineSearch: onlineSearchDiagnostic,
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
  const ranker = options.rankCandidates || defaultRankCandidates;
  const ranked = options.deferCandidateRanking
    ? { candidates: mergedCandidates(annotatedMerged), diagnostic: { status: 'skipped', code: 'RANKING_OWNED_BY_UNIFIED_SEARCH' } }
    : await ranker(session.task?.query || query, mergedCandidates(annotatedMerged), {
    optimizeDelivery: true,
    feedback: collectionFeedback(session, session.task.publicCollectRun),
    collectedCandidates: collectedPublicCandidates(session),
    evidenceContext: researchEvidenceContext(session, options.environment || process.env),
    environment: options.environment || process.env,
    signal: options.signal,
    remainingBudgetMs: enhancementBudget(),
  });
  const rankedMerged = ranked.diagnostic?.status === 'used'
    ? applyCandidateRanking(annotatedMerged, ranked.candidates) : annotatedMerged;
  const candidateQuality = {
    searxng: classifyCandidates(Array.isArray(sxDoc?.results) ? sxDoc.results : [], topicContract),
    merged: summarizeMergedQuality(rankedMerged),
  };
  candidateQuality.onlineSearch = candidateQuality.searxng;
  const mergeAndClassifyMs = elapsedMilliseconds(mergeStartedAt, now());
  const timing = {
    searxngMs,
    onlineSearchMs: searxngMs,
    hotDiscoveryMs,
    mergeAndClassifyMs,
    totalMs: elapsedMilliseconds(totalStartedAt, now()),
  };
  const authorization = withSessionLock(paths, 'public-discover-record', () => {
    const current = loadSession(paths, { persistMigration: false }).session;
    const result = recordDiscoveryResult(current.task.discoveryGate, {
      ...reservationIdentity,
      candidates: ranked.diagnostic?.status === 'used' ? ranked.candidates : mergedCandidates(annotatedMerged),
      keepOpen: options.orchestrationRunId !== undefined
        && (options.channelMode === 'online' || nextHotWave || Boolean(requiresUserAction) || infrastructureBlocked),
    });
    if (sourcePlan && options.orchestrationRunId !== undefined) {
      current.task.publicCollectRun.hotSourcePlan = { ...sourcePlan, cursor: completedSourceCursor, nextWave: nextHotWave };
    }
    persistSession(paths, current);
    return { state: current.task.discoveryGate, result };
  });
  const discoveryProfile = profileEnabled ? {
    name: 'chinese-article',
    sources: hotSources,
    stopAfter: profileStopAfter,
    minimumAttempts: 3,
    budget: { softMs: SOFT_DISCOVERY_BUDGET_MS, hardMs: HARD_DISCOVERY_BUDGET_MS },
  } : null;
  const selectedCandidate = authorization.result.articleCandidates[0] || null;
  const merged = {
    ...rankedMerged,
    channelDiagnostics,
    candidateQuality,
    queryPlanning: planned.jev,
    candidateRanking: ranked.diagnostic,
    sourcePlanning,
    timing,
    selectedCandidate,
    ...(discoveryProfile ? { discoveryProfile } : {}),
  };
  await writeFile(mergedSnapshot, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

    return {
    ok: true,
    action: 'public-discover',
    nextHotWave: options.orchestrationRunId !== undefined && nextHotWave,
    sourcePlanning,
    query,
    category,
    requestedDimensions: [category],
    hotDiscovery: hotDoc ? {
      requestedDimensions: Array.isArray(hotDoc.dimensions) ? hotDoc.dimensions : [category],
      effectiveDimensions: Array.isArray(hotDoc.effectiveDimensions) ? hotDoc.effectiveDimensions : [category],
    } : null,
    channels: channelDiagnostics,
    candidateQuality,
    queryPlanning: planned.jev,
    candidateRanking: ranked.diagnostic,
    discoveryAuthorization: {
      attemptCount: authorization.state.attemptCount,
      maxAttempts: authorization.state.maxAttempts,
      exhausted: authorization.state.exhausted,
      stopReason: authorization.state.stopReason,
      stopDetail: authorization.state.stopDetail,
      probeCandidateIds: authorization.result.probeCandidates.map((candidate) => candidate.candidateId),
      probeCandidateCount: authorization.result.probeCandidates.length,
      verificationRequired: true,
      articleCandidateIds: authorization.result.articleCandidates.map((candidate) => candidate.candidateId),
      structuralArticleCandidateIds: authorization.result.structuralArticleCandidates
        .map((candidate) => candidate.candidateId),
    },
    selectedCandidate,
    timing,
    ...(discoveryProfile ? { discoveryProfile } : {}),
    snapshots: {
      searxng: sxDoc ? searxngSnapshot : null,
      onlineSearch: sxDoc ? searxngSnapshot : null,
      hotDiscovery: hotDoc ? hotSnapshot : null,
      merged: mergedSnapshot,
    },
    merged,
    ...(requiresUserAction ? { requiresUserAction: merged.requiresUserAction || requiresUserAction } : {}),
    ...(infrastructureBlocked ? { infrastructureBlocked: true } : {}),
    warnings,
    };
  } catch (error) {
    withSessionLock(paths, 'public-discover-error', () => {
      const current = loadSession(paths, { persistMigration: false }).session;
      const running = current.task.discoveryGate?.runs?.at(-1)?.status === 'running';
      if (running && options.orchestrationRunId === undefined) {
        recordDiscoveryResult(current.task.discoveryGate, {
          ...reservationIdentity,
          candidates: [],
          error: error instanceof Error ? error.message : String(error),
        });
        persistSession(paths, current);
      }
    });
    throw error;
  }
}

export function finalizePublicDiscoveryRound(paths, { orchestrationRunId, query, category }) {
  return withSessionLock(paths, 'public-discover-finalize-round', () => {
    const current = loadSession(paths, { persistMigration: false }).session;
    if (current.task.activeOrchestrationRunId !== orchestrationRunId) {
      throw new Error(`ORCHESTRATION_OWNER_MISMATCH: ${orchestrationRunId}`);
    }
    const last = current.task.discoveryGate?.runs?.at(-1);
    const result = last?.status === 'complete' && last.query === String(query)
      && last.category === String(category)
      ? last : finalizeOpenDiscoveryAttempt(current.task.discoveryGate, { query, category });
    persistSession(paths, current);
    return result;
  });
}
