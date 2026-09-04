'use strict';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { createDiscoveryAuthorization } from './discovery-authorization.mjs';
import { runPublicDiscover } from './public-discovery.mjs';
import { createCloudKnowledgeAdapter } from './enterprise/adapters/cloud-knowledge.mjs';
import { createArtifactWriter } from './enterprise/shared/artifact-writer.mjs';
import { runWebAcquire } from './web-acquirer.mjs';
import { runWebMaterialize } from './web-materializer.mjs';
import {
  ensureSessionSkeleton, loadSession, newSession, persistSession, sessionPaths,
} from './session.mjs';
import { mergeUnifiedCandidates } from './unified-candidates.mjs';

const execFileAsync = promisify(execFile);

async function resolveCloudResourceIdFromProject(projectId, dependencies = {}) {
  if (dependencies.resolveCloudResourceId) {
    return dependencies.resolveCloudResourceId(projectId);
  }
  const script = process.env.PROJECT_CONTEXT_SCRIPT || '/app/skills/project-context/scripts/project-context.mjs';
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
    title: candidate.title || sourceUrl,
    sourceUrl,
    sourceItemId: null,
    sourceSkill: 'public-internet',
    backend: candidate.provider || 'public-discovery',
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
  const query = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : parent.task?.query;
  if (!query) throw new Error('--query is required for unified-search');
  const sourceScope = ['public-internet', 'cloud-knowledge'];
  if (!sourceScope.includes('public-internet')) throw new Error('unified-search requires public-internet in task.sourceScope');

  const scratch = await mkdtemp(join(dirname(paths.root), '.knowledge-unified-'));
  const publicRoot = join(scratch, 'public');
  const cloudRoot = join(scratch, 'cloud');
  let publicResult = null;
  let cloudOutcome = null;
  let cloudMetadata = null;
  try {
    const publicPaths = await childSession(parent, publicRoot, 'public-internet');
    let cloudResourceId = Number(args['cloud-resource-id'] || process.env.BYCLAW_CLOUD_RESOURCE_ID);
    if (!(Number.isSafeInteger(cloudResourceId) && cloudResourceId > 0)) {
      const projectId = Number(args['project-id']);
      if (Number.isSafeInteger(projectId) && projectId > 0) {
        cloudResourceId = await resolveCloudResourceIdFromProject(projectId, dependencies) || 0;
      }
    }
    const explicitScope = parent.task?.cloudDiscoveryScope;
    const cloudScope = explicitScope?.resources?.length
      ? explicitScope
      : Number.isSafeInteger(cloudResourceId) && cloudResourceId > 0
        ? { schemaVersion: '1.0', resources: [{ resourceId: cloudResourceId, directoryPath: '/', origin: 'user-input' }] }
        : null;
    const cloudAvailable = Boolean(cloudScope?.resources?.length);
    const cloudPaths = cloudAvailable
      ? await childSession(parent, cloudRoot, 'cloud-knowledge', cloudScope) : null;
    const cloudAdapter = cloudAvailable
      ? (dependencies.createCloudKnowledgeAdapter || createCloudKnowledgeAdapter)(dependencies)
      : null;
    const [publicSettled, cloudSettled] = await Promise.all([
      (dependencies.runPublicDiscover || runPublicDiscover)(publicPaths, { query, category: args.category || 'general' }, dependencies.publicDiscoverOptions || {})
        .then((value) => ({ ok: true, value }))
        .catch((error) => ({ ok: false, error })),
      cloudAdapter && cloudPaths
        ? cloudAdapter.search({ outputDir: cloudRoot, query, limit: Number(args.limit) || 50 })
          .then((value) => ({ ok: true, value }))
          .catch((error) => ({ ok: false, error }))
        : Promise.resolve({ ok: false, error: new Error('cloud context unavailable') }),
    ]);
    if (publicSettled.ok) {
      publicResult = publicSettled.value;
      const discovered = loadSession(publicPaths, { persistMigration: false }).session;
      const parentWithDiscovery = loadSession(paths, { persistMigration: false }).session;
      if (discovered.task?.discoveryGate) {
        parentWithDiscovery.task.discoveryGate = discovered.task.discoveryGate;
        persistSession(paths, parentWithDiscovery);
      }
    }
    if (cloudSettled.ok) cloudOutcome = cloudSettled.value;
    if (cloudPaths) {
      try {
        cloudMetadata = JSON.parse(await readFile(join(cloudRoot, 'sanitized/metadata.json'), 'utf8'));
      } catch {
        cloudMetadata = null;
      }
    }
    const publicItems = publicCandidates(publicResult).map((item) => sourceCandidate(item, 'public-internet'));
    const cloudItems = cloudMetadata?.collection?.items || [];
    const candidates = mergeUnifiedCandidates(query, {
      publicCandidates: publicItems,
      cloudCandidates: cloudItems,
    });
    const inventory = candidates.map((candidate) => candidate.source === 'cloud-knowledge'
      ? { ...candidate, itemId: candidate.candidateId, sourceSkill: 'project-cloud-knowledge', backend: 'project-cloud-knowledge', sourceUrl: candidate.sourceUrl, rawArtifacts: [], media: { coverStatus: 'not-present', coverCount: 0, materializedCoverCount: 0, reason: null }, materialization: { status: 'pending', markdownPath: null, sanitizedPath: null, pendingArtifactCleanup: [], reason: 'unified discovery; materialization is deferred', contentGranularity: 'unknown' } }
      : publicInventory(candidate));
    const writer = await createArtifactWriter(paths.root, { allowExistingSession: true, allowFailed: true });
    try {
      const sourceMetadata = {
        operation: 'unified-search', query,
        sources: {
          publicInternet: { status: publicResult ? 'complete' : 'failed', error: publicResult ? null : 'PUBLIC_SEARCH_FAILED' },
          cloudKnowledge: { status: cloudOutcome ? cloudOutcome.status : 'unavailable', error: cloudOutcome ? null : 'CLOUD_CONTEXT_UNAVAILABLE' },
        },
        ranking: { schemaVersion: '1.0', candidateCount: candidates.length },
      };
      await writer.writeCollectionBundle({
        title: `Unified search: ${query}`,
        source: 'multi-source', backend: 'knowledge-collection', url: `unified-search:${encodeURIComponent(query)}`,
        filters: { query, sources: ['public-internet', 'cloud-knowledge'] }, inventory, canonicalItems: [],
        sourceMetadata, sourceScope: ['public-internet', ...(cloudAvailable ? ['cloud-knowledge'] : [])],
        materializationTarget: 'selected', metadataOnly: true,
        paginationFailed: !publicResult || (cloudAvailable && !cloudOutcome),
        discoverySucceeded: Boolean(publicResult || cloudOutcome),
      });
      return {
        ok: true, action: 'unified-search', outputDir: paths.root, query,
        sources: sourceMetadata.sources, candidates, inventory: inventory.length,
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
  const requestedIds = Array.isArray(args['item-ids'])
    ? args['item-ids'] : String(args['item-ids'] || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!requestedIds.length) throw new Error('--item-ids is required for unified-materialize');
  const selected = requestedIds.map((itemId) => inventory.find((item) => item?.itemId === itemId));
  if (selected.some((item) => !item)) throw new Error('one or more --item-ids are not unified candidates');
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
      const executorResultFile = acquired.executorResult || `raw/bycli/web/${item.itemId}/executor-result.json`;
      results.push(await materialize(paths, {
        'item-id': item.itemId,
        'executor-result-file': executorResultFile,
      }, publicMaterializeOptions));
    } catch (error) {
      results.push({ ok: false, itemId: item.itemId, source: item.source, error: error.message });
    }
  }
  const cloudIds = selected.filter((candidate) => candidate.source === 'cloud-knowledge').map((item) => item.itemId);
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
  return { ok: results.every((result) => result.ok !== false), action: 'unified-materialize', results };
}
