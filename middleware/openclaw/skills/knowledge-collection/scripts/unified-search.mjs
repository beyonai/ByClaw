'use strict';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { createDiscoveryAuthorization } from './discovery-authorization.mjs';
import { mergedCandidates } from './candidate-quality.mjs';
import { runPublicDiscover } from './public-discovery.mjs';
import { assertCloudMaterializationScope, createCloudKnowledgeAdapter } from './enterprise/adapters/cloud-knowledge.mjs';
import { createArtifactWriter } from './enterprise/shared/artifact-writer.mjs';
import { runWebAcquire } from './web-acquirer.mjs';
import { runWebMaterialize } from './web-materializer.mjs';
import { cmdCollect } from './collection-state.mjs';
import { selectedItemSource, validateSelectedRequest } from './selected-delivery.mjs';
import { deliveryCompleteForSession } from './delivery-state.mjs';
import {
  ensureSessionSkeleton, loadSession, newSession, persistSession, sessionPaths,
} from './session.mjs';
import { mergeUnifiedCandidates, prioritizeUnifiedCandidates } from './unified-candidates.mjs';
import { enterpriseInferenceAllowed } from './jev/safe-call.mjs';

const execFileAsync = promisify(execFile);
const TIME_RANGE_MILLISECONDS = Object.freeze({
  day: 24 * 60 * 60 * 1_000,
  week: 7 * 24 * 60 * 60 * 1_000,
  month: 31 * 24 * 60 * 60 * 1_000,
  year: 366 * 24 * 60 * 60 * 1_000,
});

function inferredTimeRange(query, explicitTimeRange) {
  const explicit = typeof explicitTimeRange === 'string' ? explicitTimeRange.trim() : '';
  if (explicit) return explicit;
  const normalized = typeof query === 'string' ? query.normalize('NFKC').toLocaleLowerCase('und') : '';
  if (/(?:近|过去|最近)\s*(?:一|1)\s*(?:周|星期)|\b(?:past|last)\s+week\b/u.test(normalized)) return 'week';
  if (/(?:近|过去|最近)\s*(?:一|1)\s*(?:天|日)|\b(?:past|last)\s+day\b/u.test(normalized)) return 'day';
  if (/(?:近|过去|最近)\s*(?:一|1)\s*(?:月|个月)|\b(?:past|last)\s+month\b/u.test(normalized)) return 'month';
  if (/(?:近|过去|最近)\s*(?:一|1)\s*年|\b(?:past|last)\s+year\b/u.test(normalized)) return 'year';
  return null;
}

function filterCandidatesByTimeRange(candidates, timeRange, dateField, now = () => new Date()) {
  const duration = TIME_RANGE_MILLISECONDS[timeRange];
  if (!duration) {
    return { candidates, excludedKnownOutOfRange: 0, unknownPublicationDate: 0 };
  }
  const current = now();
  const currentTime = current instanceof Date ? current.getTime() : new Date(current).getTime();
  const minimumTime = currentTime - duration;
  let excludedKnownOutOfRange = 0;
  let unknownPublicationDate = 0;
  const retained = candidates.flatMap((candidate) => {
    const candidateTime = Date.parse(candidate?.[dateField] || '');
    if (!Number.isFinite(candidateTime)) {
      unknownPublicationDate += 1;
      return [];
    }
    const inRange = candidateTime >= minimumTime && candidateTime <= currentTime;
    if (!inRange) excludedKnownOutOfRange += 1;
    return inRange ? [{ ...candidate, freshnessStatus: 'in-range', timeRange }] : [];
  });
  return { candidates: retained, excludedKnownOutOfRange, unknownPublicationDate };
}

export function resolveProjectContextScript({
  env = process.env,
  fileExists = existsSync,
  localScript = fileURLToPath(new URL('../../project-context/scripts/project-context.mjs', import.meta.url)),
} = {}) {
  const candidates = [
    env.PROJECT_CONTEXT_SCRIPT,
    localScript,
    '/app/skills/project-context/scripts/project-context.mjs',
    '/opt/byclaw/dsh-managed/skills/project-context/scripts/project-context.mjs',
  ].filter((candidate) => typeof candidate === 'string' && candidate.trim());
  return candidates.find((candidate) => fileExists(candidate)) || candidates[0];
}

async function resolveCloudResourceIdFromProject(projectId, dependencies = {}) {
  if (dependencies.resolveCloudResourceId) {
    return dependencies.resolveCloudResourceId(projectId);
  }
  const script = resolveProjectContextScript();
  try {
    const { stdout } = await execFileAsync(process.execPath, [script, 'basic', '--project-id', String(projectId)], {
      timeout: 30_000,
      maxBuffer: 1_000_000,
    });
    const result = JSON.parse(stdout);
    const resourceId = result?.project?.cloudResourceId;
    return Number.isSafeInteger(Number(resourceId)) && Number(resourceId) > 0 ? Number(resourceId) : null;
  } catch {
    return null;
  }
}

function sourceCandidate(item, source) {
  if (source === 'cloud-knowledge') return item;
  return {
    ...item,
    url: item.url || item.sourceUrl,
    title: item.title || item.name || item.url || item.sourceUrl,
    content: item.content || item.passage || item.snippet || '',
  };
}

function publicCandidates(result) {
  const merged = result?.merged || {};
  const grouped = mergedCandidates(merged);
  if (grouped.length) return grouped;
  return Array.isArray(merged.results)
    ? merged.results
    : Array.isArray(merged.candidates)
      ? merged.candidates
      : Array.isArray(result?.results) ? result.results : [];
}

async function childSession(parent, root, source, cloudDiscoveryScope) {
  ensureSessionSkeleton(root);
  const task = {
    ...parent.task,
    sourceScope: [source],
    status: 'initialized',
    publicationStatus: undefined,
    ...(source === 'public-internet'
      ? { discoveryGate: createDiscoveryAuthorization({ query: parent.task.query, topicRequired: false }) }
      : { cloudDiscoveryScope }),
  };
  persistSession({ root, session: join(root, 'session.json') }, newSession(task));
  return sessionPaths(root);
}

function publicInventory(candidate) {
  const sourceUrl = candidate.url || candidate.sourceUrl;
  return {
    itemId: candidate.candidateId || `public-${Buffer.from(sourceUrl).toString('hex').slice(0, 16)}`,
    source: 'public-internet',
    title: candidate.title || sourceUrl,
    sourceUrl,
    sourceItemId: null,
    sourceSkill: 'bycli',
    backend: candidate.provider || 'public-discovery',
    provider: candidate.provider || '',
    providerVersion: candidate.providerVersion || '',
    requestId: candidate.requestId || '',
    publishedAt: candidate.publishedAt || '',
    site: candidate.site || '',
    evidenceLevel: candidate.evidenceLevel || '',
    freshnessStatus: candidate.freshnessStatus || '',
    timeRange: candidate.timeRange || '',
    duplicateGroupKey: `source:public-internet\n${sourceUrl}`,
    duplicateOf: null,
    rawArtifacts: [],
    media: { coverStatus: 'not-present', coverCount: 0, materializedCoverCount: 0, reason: null },
    materialization: {
      status: 'pending', markdownPath: null, sanitizedPath: null,
      pendingArtifactCleanup: [], reason: 'unified discovery; materialization is deferred', contentGranularity: 'unknown',
    },
  };
}

export async function runUnifiedSearch(paths, args = {}, dependencies = {}) {
  const parent = loadSession(paths, { persistMigration: false }).session;
  if (parent.task?.materializationTarget !== 'selected'
    || parent.task?.requiredContentGranularity !== 'full-text') {
    throw new Error('UNIFIED_SEARCH_REQUIRES_FULL_TEXT: unified-search requires selected + full-text initialization');
  }
  const query = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : parent.task?.query;
  if (!query) throw new Error('--query is required for unified-search');
  const sourceScope = Array.isArray(parent.task?.sourceScope) ? parent.task.sourceScope : [];
  if (!sourceScope.includes('public-internet')) {
    throw new Error('UNIFIED_SEARCH_SOURCE_NOT_AUTHORIZED: unified-search requires public-internet in task.sourceScope');
  }
  const cloudAuthorized = sourceScope.includes('cloud-knowledge');
  const authorizedSources = ['public-internet', ...(cloudAuthorized ? ['cloud-knowledge'] : [])];

  const scratch = await mkdtemp(join(dirname(paths.root), '.knowledge-unified-'));
  const publicRoot = join(scratch, 'public');
  const cloudRoot = join(scratch, 'cloud');
  let publicResult = null;
  let cloudOutcome = null;
  let cloudMetadata = null;
  const timeRange = inferredTimeRange(query, args['time-range']);
  const jevOptions = { ...dependencies.jevOptions, environment: dependencies.jevOptions?.environment || process.env };
  try {
    const publicPaths = await childSession(parent, publicRoot, 'public-internet');
    let cloudResourceId = cloudAuthorized
      ? Number(args['cloud-resource-id'] || process.env.BYCLAW_CLOUD_RESOURCE_ID) : 0;
    if (cloudAuthorized && !(Number.isSafeInteger(cloudResourceId) && cloudResourceId > 0)) {
      const projectId = Number(args['project-id']);
      if (Number.isSafeInteger(projectId) && projectId > 0) {
        cloudResourceId = await resolveCloudResourceIdFromProject(projectId, dependencies) || 0;
      }
    }
    const explicitScope = cloudAuthorized ? parent.task?.cloudDiscoveryScope : null;
    const cloudScope = explicitScope?.resources?.length
      ? explicitScope
      : Number.isSafeInteger(cloudResourceId) && cloudResourceId > 0
        ? { schemaVersion: '1.0', resources: [{ resourceId: cloudResourceId, directoryPath: '/', origin: 'user-input' }] }
        : null;
    const cloudAvailable = Boolean(cloudScope?.resources?.length);
    const finalRankingAllowed = !cloudAvailable || enterpriseInferenceAllowed(jevOptions.environment);
    const cloudPaths = cloudAvailable
      ? await childSession(parent, cloudRoot, 'cloud-knowledge', cloudScope) : null;
    const cloudAdapter = cloudAvailable
      ? (dependencies.createCloudKnowledgeAdapter || createCloudKnowledgeAdapter)({ ...dependencies, deferJevRanking: true })
      : null;
    const [publicSettled, cloudSettled] = await Promise.all([
      (dependencies.runPublicDiscover || runPublicDiscover)(publicPaths, {
        query,
        category: args.category || 'general',
        ...(timeRange ? { 'time-range': timeRange } : {}),
      }, { ...dependencies.publicDiscoverOptions, deferCandidateRanking: finalRankingAllowed })
        .then((value) => ({ ok: true, value }))
        .catch((error) => ({ ok: false, error })),
      cloudAdapter && cloudPaths
        ? cloudAdapter.search({ outputDir: cloudRoot, query, limit: Number(args.limit) || 50 })
          .then((value) => ({ ok: true, value }))
          .catch((error) => ({ ok: false, error }))
        : Promise.resolve({ ok: false, error: new Error('cloud context unavailable') }),
    ]);
    const parentWithDiscovery = loadSession(paths, { persistMigration: false }).session;
    let parentChanged = false;
    if (publicSettled.ok) {
      publicResult = publicSettled.value;
      const discovered = loadSession(publicPaths, { persistMigration: false }).session;
      if (discovered.task?.discoveryGate) {
        parentWithDiscovery.task.discoveryGate = discovered.task.discoveryGate;
        parentChanged = true;
      }
    }
    if (cloudAvailable && !explicitScope?.resources?.length) {
      parentWithDiscovery.task.cloudDiscoveryScope = cloudScope;
      parentChanged = true;
    }
    if (parentChanged) persistSession(paths, parentWithDiscovery);
    if (cloudSettled.ok) cloudOutcome = cloudSettled.value;
    if (cloudPaths) {
      try {
        cloudMetadata = JSON.parse(await readFile(join(cloudRoot, 'sanitized/metadata.json'), 'utf8'));
      } catch {
        cloudMetadata = null;
      }
    }
    const publicItemsWithDates = publicCandidates(publicResult)
      .map((item) => sourceCandidate(item, 'public-internet'));
    const freshness = filterCandidatesByTimeRange(
      publicItemsWithDates,
      timeRange,
      'publishedAt',
      dependencies.now || (() => new Date()),
    );
    const publicItems = freshness.candidates;
    const cloudFreshness = filterCandidatesByTimeRange(
      cloudMetadata?.collection?.items || [],
      timeRange,
      'updatedAt',
      dependencies.now || (() => new Date()),
    );
    const cloudItems = cloudFreshness.candidates;
    const legacyCandidates = mergeUnifiedCandidates(query, {
      publicCandidates: publicItems,
      cloudCandidates: cloudItems,
    });
    const ranked = await prioritizeUnifiedCandidates(query, legacyCandidates, jevOptions);
    const candidates = ranked.items;
    const inventory = candidates.map((candidate) => candidate.source === 'cloud-knowledge'
      ? { ...candidate, itemId: candidate.candidateId, sourceSkill: 'project-cloud-knowledge', backend: 'project-cloud-knowledge', sourceUrl: candidate.sourceUrl, rawArtifacts: [], media: { coverStatus: 'not-present', coverCount: 0, materializedCoverCount: 0, reason: null }, materialization: { status: 'pending', markdownPath: null, sanitizedPath: null, pendingArtifactCleanup: [], reason: 'unified discovery; materialization is deferred', contentGranularity: 'unknown' } }
      : publicInventory(candidate));
    const writer = await createArtifactWriter(paths.root, { allowExistingSession: true, allowFailed: true });
    try {
      const cloudStatus = cloudOutcome ? cloudOutcome.status : 'unavailable';
      const cloudError = cloudOutcome?.reasonCode
        ? cloudOutcome.reasonCode
        : cloudOutcome?.reason
          ? cloudOutcome.reason
          : cloudOutcome
            ? null
            : 'CLOUD_CONTEXT_UNAVAILABLE';
      const sourceMetadata = {
        operation: 'unified-search', query, metadataOnly: true,
        sources: {
          publicInternet: { status: publicResult ? 'complete' : 'failed', error: publicResult ? null : 'PUBLIC_SEARCH_FAILED' },
          cloudKnowledge: {
            status: cloudStatus,
            error: cloudError,
            ...(cloudOutcome?.reasonCode ? { reasonCode: cloudOutcome.reasonCode } : {}),
            ...(cloudOutcome?.reason ? { reason: cloudOutcome.reason } : {}),
          },
        },
        ranking: { schemaVersion: '1.0', candidateCount: candidates.length, jev: ranked.diagnostic },
        freshness: {
          timeRange,
          excludedKnownOutOfRange: freshness.excludedKnownOutOfRange,
          unknownPublicationDate: freshness.unknownPublicationDate,
          cloudExcludedKnownOutOfRange: cloudFreshness.excludedKnownOutOfRange,
          cloudUnknownUpdatedAt: cloudFreshness.unknownPublicationDate,
        },
      };
      await writer.writeCollectionBundle({
        title: `Unified search: ${query}`,
        source: 'multi-source', backend: 'knowledge-collection', url: `unified-search:${encodeURIComponent(query)}`,
        filters: { query, sources: authorizedSources }, inventory, canonicalItems: [],
        sourceMetadata, sourceScope: authorizedSources,
        materializationTarget: 'selected', metadataOnly: true,
        paginationFailed: !publicResult || (cloudAvailable && !cloudOutcome),
        discoverySucceeded: Boolean(publicResult || cloudOutcome),
      });
      return {
        ok: true, action: 'unified-search', outputDir: paths.root, query,
        sources: sourceMetadata.sources, candidates, inventory: inventory.length,
        freshness: sourceMetadata.freshness,
      };
    } finally {
      await writer.abort().catch(() => {});
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function runUnifiedMaterialize(paths, args = {}, dependencies = {}) {
  const current = loadSession(paths, { persistMigration: false }).session;
  const inventory = Array.isArray(current.collection?.collection?.items)
    ? current.collection.collection.items : [];
  if (current.task?.materializationTarget !== 'selected'
    || current.task?.requiredContentGranularity !== 'full-text'
    || current.task?.workflow === 'public-collect'
    || !['unified-search', 'materialize'].includes(current.collection?.sourceMetadata?.operation)
    || (current.collection?.sourceMetadata?.operation === 'materialize'
      && current.collection?.sourceMetadata?.selectionWorkflow !== 'unified')) {
    throw new Error('UNIFIED_MATERIALIZE_REQUIRES_SELECTED_DISCOVERY');
  }
  const selection = validateSelectedRequest(args['item-ids'], inventory,
    current.task.sourceScope || [], current.task.selectedDelivery || null);
  const requestedIds = Array.isArray(args['item-ids'])
    ? args['item-ids'].map((id) => id.trim()) : args['item-ids'].split(',').map((id) => id.trim());
  const selected = requestedIds.map((itemId) => inventory.find((item) => item?.itemId === itemId));
  if (selected.some((item) => item.timeRange && item.freshnessStatus !== 'in-range')) {
    throw new Error('PUBLICATION_DATE_NOT_VERIFIED: time-bounded candidates require a verified in-range date');
  }
  const selectedCloudItems = selected.filter((candidate) => selectedItemSource(candidate) === 'cloud-knowledge');
  if (selectedCloudItems.length) {
    assertCloudMaterializationScope(current.task.cloudDiscoveryScope, selectedCloudItems);
  }
  current.task.selectedDelivery = selection;
  persistSession(paths, current);
  const results = [];
  const acquire = dependencies.runWebAcquire || runWebAcquire;
  const materialize = dependencies.runWebMaterialize || runWebMaterialize;
  const publicAcquireOptions = dependencies.publicAcquireOptions || {};
  const publicMaterializeOptions = dependencies.publicMaterializeOptions || {};
  for (const item of selected.filter((candidate) => candidate.source === 'public-internet')) {
    try {
      const acquired = await acquire(paths, {
        'item-id': item.itemId,
        'source-url': item.sourceUrl,
      }, publicAcquireOptions);
      if (acquired.status !== 'saved') {
        results.push({ ok: false, itemId: item.itemId, source: item.source,
          error: acquired.errorCode || acquired.status || 'ACQUISITION_FAILED' });
        continue;
      }
      const executorResultFile = acquired.executorResult || `raw/bycli/web/${item.itemId}/executor-result.json`;
      const materialized = await materialize(paths, {
        'item-id': item.itemId,
        'executor-result-file': join(paths.root, executorResultFile),
      }, publicMaterializeOptions);
      if (materialized?.collectPayloadPath) {
        cmdCollect(paths, { 'item-json-file': materialized.collectPayloadPath });
      }
      results.push(materialized?.materialization?.status === 'materialized'
        ? materialized : { ...materialized, ok: false, itemId: item.itemId });
    } catch (error) {
      results.push({ ok: false, itemId: item.itemId, source: item.source, error: error.message });
    }
  }
  const cloudIds = selectedCloudItems.map((item) => item.itemId);
  if (cloudIds.length) {
    const cloudAdapter = (dependencies.createCloudKnowledgeAdapter || createCloudKnowledgeAdapter)(dependencies);
    try {
      results.push(await cloudAdapter.materialize({
        sessionDir: paths.root, outputDir: paths.root, itemIds: cloudIds,
      }));
    } catch (error) {
      results.push({ ok: false, itemIds: cloudIds, source: 'cloud-knowledge', error: error.message });
    }
  }
  const latest = loadSession(paths, { persistMigration: false }).session;
  return { ok: results.every((result) => result.ok !== false && result.status !== 'failed')
    && deliveryCompleteForSession(latest), action: 'unified-materialize', results };
}
