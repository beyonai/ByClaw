import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureSessionSkeleton, newSession, persistSession } from './session.mjs';
import { mergeUnifiedCandidates } from './unified-candidates.mjs';
import { resolveProjectContextScript, runUnifiedMaterialize, runUnifiedSearch } from './unified-search.mjs';

test('project context resolves beside deployed skills without an app mount', () => {
  const localScript = '/opt/byclaw/dsh-managed/skills/project-context/scripts/project-context.mjs';
  assert.equal(resolveProjectContextScript({
    env: {}, localScript, fileExists: (candidate) => candidate === localScript,
  }), localScript);
});

test('project context prefers an existing override and falls back from a missing override', () => {
  const localScript = '/skills with spaces/project-context/scripts/project-context.mjs';
  const env = { PROJECT_CONTEXT_SCRIPT: '/custom/project-context.mjs' };
  assert.equal(resolveProjectContextScript({ env, localScript, fileExists: () => true }), env.PROJECT_CONTEXT_SCRIPT);
  assert.equal(resolveProjectContextScript({
    env, localScript, fileExists: (candidate) => candidate === localScript,
  }), localScript);
});

test('project context supports container and managed fallback layouts', () => {
  for (const expected of [
    '/app/skills/project-context/scripts/project-context.mjs',
    '/opt/byclaw/dsh-managed/skills/project-context/scripts/project-context.mjs',
  ]) {
    assert.equal(resolveProjectContextScript({
      env: {}, localScript: '/missing/context.mjs', fileExists: (candidate) => candidate === expected,
    }), expected);
  }
});

function unifiedTask(query, extra = {}) {
  return {
    query,
    sourceScope: ['public-internet', 'cloud-knowledge'],
    materializationTarget: 'selected',
    requiredContentGranularity: 'full-text',
    ...extra,
  };
}

test('unified candidate ranking puts the best public/cloud match first and preserves source records', () => {
  const result = mergeUnifiedCandidates('巡检流程', {
    publicCandidates: [{ url: 'https://example.test/a', title: '巡检流程', content: '正文' }],
    cloudCandidates: [{
      itemId: 'cloud-1', title: '巡检流程手册', sourceUrl: 'cloud-knowledge://1/docs/a.md',
      resourceId: 1, filePath: '/docs/a.md', fileType: 'md', fileSize: 20,
      materialization: { contentGranularity: 'full-text' },
    }],
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].source, 'cloud-knowledge');
  assert.deepEqual(new Set(result.map((item) => item.source)), new Set(['public-internet', 'cloud-knowledge']));
});

test('public candidate normalization preserves discovery provenance and publication time', () => {
  const [candidate] = mergeUnifiedCandidates('AI 热点新闻', {
    publicCandidates: [{
      url: 'https://example.test/ai-news',
      title: 'AI 热点新闻',
      passage: '新闻摘要',
      provider: 'tencent-wsa',
      providerVersion: 'flagship',
      requestId: 'request-1',
      publishedAt: '2026-09-20T08:00:00Z',
      site: 'example.test',
      evidenceLevel: 'search-summary',
    }],
  });

  assert.equal(candidate.provider, 'tencent-wsa');
  assert.equal(candidate.providerVersion, 'flagship');
  assert.equal(candidate.requestId, 'request-1');
  assert.equal(candidate.publishedAt, '2026-09-20T08:00:00Z');
  assert.equal(candidate.site, 'example.test');
  assert.equal(candidate.evidenceLevel, 'search-summary');
});

test('unified search rejects a session that was not initialized for selected full text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-invalid-granularity-'));
  try {
    ensureSessionSkeleton(root);
    const paths = {
      root,
      session: join(root, 'session.json'),
      collectionResult: join(root, 'collection-result.json'),
      metadata: join(root, 'sanitized/metadata.json'),
      inputDir: join(root, '.collection-inputs'),
      lock: join(root, '.knowledge-collection.lock'),
    };
    persistSession(paths, newSession({
      query: 'AI 热点新闻',
      sourceScope: ['public-internet', 'cloud-knowledge'],
      materializationTarget: 'selected',
      requiredContentGranularity: 'any',
    }));
    let discoveryCalled = false;

    await assert.rejects(
      runUnifiedSearch(paths, { query: 'AI 热点新闻' }, {
        runPublicDiscover: async () => {
          discoveryCalled = true;
          return { merged: { groups: {} } };
        },
      }),
      /UNIFIED_SEARCH_REQUIRES_FULL_TEXT/,
    );
    assert.equal(discoveryCalled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unified search rejects sessions that did not authorize public internet', async () => {
  for (const sourceScope of [[], ['cloud-knowledge']]) {
    const root = await mkdtemp(join(tmpdir(), 'unified-invalid-scope-'));
    try {
      ensureSessionSkeleton(root);
      const paths = {
        root,
        session: join(root, 'session.json'),
        collectionResult: join(root, 'collection-result.json'),
        metadata: join(root, 'sanitized/metadata.json'),
        inputDir: join(root, '.collection-inputs'),
        lock: join(root, '.knowledge-collection.lock'),
      };
      persistSession(paths, newSession(unifiedTask('AI 热点新闻', { sourceScope })));
      let discoveryCalled = false;

      await assert.rejects(
        runUnifiedSearch(paths, { query: 'AI 热点新闻' }, {
          runPublicDiscover: async () => {
            discoveryCalled = true;
            return { merged: { groups: {} } };
          },
        }),
        /UNIFIED_SEARCH_SOURCE_NOT_AUTHORIZED/,
      );
      assert.equal(discoveryCalled, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('unified search supports an authorized public-only fallback when cloud is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-public-only-'));
  try {
    ensureSessionSkeleton(root);
    const paths = {
      root,
      session: join(root, 'session.json'),
      collectionResult: join(root, 'collection-result.json'),
      metadata: join(root, 'sanitized/metadata.json'),
      inputDir: join(root, '.collection-inputs'),
      lock: join(root, '.knowledge-collection.lock'),
    };
    persistSession(paths, newSession(unifiedTask('AI 热点新闻', { sourceScope: ['public-internet'] })));
    let cloudAdapterCreated = false;
    const result = await runUnifiedSearch(paths, { query: 'AI 热点新闻' }, {
      runPublicDiscover: async () => ({ merged: { groups: {} } }),
      createCloudKnowledgeAdapter: () => {
        cloudAdapterCreated = true;
        throw new Error('cloud adapter must not be created');
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sources.publicInternet.status, 'complete');
    assert.equal(result.sources.cloudKnowledge.status, 'unavailable');
    assert.equal(cloudAdapterCreated, false);
    const collectionResult = JSON.parse(await readFile(paths.collectionResult, 'utf8'));
    assert.deepEqual(collectionResult.filters.sources, ['public-internet']);
    const session = JSON.parse(await readFile(paths.session, 'utf8'));
    assert.deepEqual(session.task.sourceScope, ['public-internet']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unified search continues with cloud results when public discovery fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-search-'));
  try {
    ensureSessionSkeleton(root);
    const paths = { root, session: join(root, 'session.json'), collectionResult: join(root, 'collection-result.json'), metadata: join(root, 'sanitized/metadata.json'), inputDir: join(root, '.collection-inputs'), lock: join(root, '.knowledge-collection.lock') };
    persistSession(paths, newSession(unifiedTask('巡检流程', {
      cloudDiscoveryScope: { schemaVersion: '1.0', resources: [{ resourceId: 7, directoryPath: '/', origin: 'user-input' }] },
    })));
    const result = await runUnifiedSearch(paths, { query: '巡检流程', limit: 10 }, {
      runPublicDiscover: async () => { throw new Error('public unavailable'); },
      createCloudKnowledgeAdapter: () => ({
        search: async ({ outputDir }) => {
          await writeFile(join(outputDir, 'sanitized/metadata.json'), JSON.stringify({
            collection: { items: [{
              itemId: 'cloud-7', resourceId: 7, filePath: '/巡检流程.md', originalFileName: '巡检流程.md',
              title: '巡检流程.md', sourceUrl: 'cloud-knowledge://7/巡检流程.md', sourceItemId: '7:/巡检流程.md',
              fileType: 'md', fileSize: 12, materializationType: 'md', rawArtifacts: [],
              materialization: { status: 'pending', contentGranularity: 'unknown' },
            }] },
            sourceMetadata: { source: 'cloud-knowledge', metadataOnly: true },
          }));
          return { ok: true, status: 'complete' };
        },
      }),
    });
    assert.equal(result.sources.publicInternet.status, 'failed');
    assert.equal(result.sources.cloudKnowledge.status, 'complete');
    assert.equal(result.candidates[0].source, 'cloud-knowledge');
    const metadata = JSON.parse(await readFile(join(root, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.sourceMetadata.metadataOnly, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unified search inventories public candidates from the real merged groups contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-public-groups-'));
  try {
    ensureSessionSkeleton(root);
    const paths = {
      root,
      session: join(root, 'session.json'),
      collectionResult: join(root, 'collection-result.json'),
      metadata: join(root, 'sanitized/metadata.json'),
      inputDir: join(root, '.collection-inputs'),
      lock: join(root, '.knowledge-collection.lock'),
    };
    persistSession(paths, newSession(unifiedTask('AI 热点新闻')));
    const result = await runUnifiedSearch(paths, { query: 'AI 热点新闻' }, {
      runPublicDiscover: async () => ({
        merged: {
          groups: {
            bothChannels: [],
            searxngTop: [{
              url: 'https://example.test/ai-news',
              title: 'AI 热点新闻',
              passage: '一篇来自公共互联网的新闻摘要',
              provider: 'tencent-wsa',
              requestId: 'request-public-1',
              publishedAt: '2026-09-20T08:00:00Z',
              site: 'example.test',
              evidenceLevel: 'search-summary',
            }],
            agentReachTop: [],
            hotBySource: {},
            hotWithoutPopularity: [],
            unverified: [],
          },
        },
      }),
      createCloudKnowledgeAdapter: () => ({
        search: async () => ({ ok: true, status: 'unavailable' }),
      }),
    });

    assert.equal(result.inventory, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].source, 'public-internet');
    assert.equal(result.candidates[0].sourceUrl, 'https://example.test/ai-news');
    const session = JSON.parse(await readFile(paths.session, 'utf8'));
    assert.equal(session.collection.collection.items.length, 1);
    assert.equal(session.collection.collection.items[0].publishedAt, '2026-09-20T08:00:00Z');
    assert.equal(session.collection.collection.items[0].provider, 'tencent-wsa');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unified search derives a weekly discovery window from a near-week query', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-week-window-'));
  try {
    ensureSessionSkeleton(root);
    const paths = {
      root,
      session: join(root, 'session.json'),
      collectionResult: join(root, 'collection-result.json'),
      metadata: join(root, 'sanitized/metadata.json'),
      inputDir: join(root, '.collection-inputs'),
      lock: join(root, '.knowledge-collection.lock'),
    };
    persistSession(paths, newSession(unifiedTask('近一周的 AI 热点新闻')));
    let discoveryArgs;
    await runUnifiedSearch(paths, { query: '近一周的 AI 热点新闻' }, {
      runPublicDiscover: async (_paths, args) => {
        discoveryArgs = args;
        return { merged: { groups: {} } };
      },
      createCloudKnowledgeAdapter: () => ({
        search: async () => ({ ok: true, status: 'unavailable' }),
      }),
    });

    assert.equal(discoveryArgs['time-range'], 'week');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unified search excludes public candidates without a verified in-range publication date', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-week-filter-'));
  try {
    ensureSessionSkeleton(root);
    const paths = {
      root,
      session: join(root, 'session.json'),
      collectionResult: join(root, 'collection-result.json'),
      metadata: join(root, 'sanitized/metadata.json'),
      inputDir: join(root, '.collection-inputs'),
      lock: join(root, '.knowledge-collection.lock'),
    };
    persistSession(paths, newSession(unifiedTask('近一周的 AI 热点新闻')));
    const grouped = (candidates) => ({
      merged: {
        groups: {
          bothChannels: [], searxngTop: candidates, agentReachTop: [],
          hotBySource: {}, hotWithoutPopularity: [], unverified: [],
        },
      },
    });
    const result = await runUnifiedSearch(paths, { query: '近一周的 AI 热点新闻' }, {
      now: () => new Date('2026-09-21T08:00:00Z'),
      runPublicDiscover: async () => grouped([
        { url: 'https://example.test/current', title: '本周新闻', publishedAt: '2026-09-20T08:00:00Z' },
        { url: 'https://example.test/old', title: '旧闻', publishedAt: '2026-09-07T08:00:00Z' },
        { url: 'https://example.test/unknown', title: '待验证新闻' },
      ]),
      createCloudKnowledgeAdapter: () => ({ search: async () => ({ ok: true, status: 'unavailable' }) }),
    });

    assert.deepEqual(result.candidates.map((candidate) => candidate.sourceUrl), [
      'https://example.test/current',
    ]);
    assert.equal(result.freshness.excludedKnownOutOfRange, 1);
    assert.equal(result.freshness.unknownPublicationDate, 1);
    assert.equal(
      result.candidates.find((candidate) => candidate.sourceUrl.endsWith('/current')).freshnessStatus,
      'in-range',
    );
    assert.equal(result.candidates.some((candidate) => candidate.sourceUrl.endsWith('/unknown')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unified search applies the requested time window to cloud updatedAt metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-cloud-window-'));
  try {
    ensureSessionSkeleton(root);
    const paths = {
      root,
      session: join(root, 'session.json'),
      collectionResult: join(root, 'collection-result.json'),
      metadata: join(root, 'sanitized/metadata.json'),
      inputDir: join(root, '.collection-inputs'),
      lock: join(root, '.knowledge-collection.lock'),
    };
    persistSession(paths, newSession(unifiedTask('近一周的巡检流程', {
      cloudDiscoveryScope: { schemaVersion: '1.0', resources: [{ resourceId: 7, directoryPath: '/', origin: 'user-input' }] },
    })));
    const cloudItem = (itemId, updatedAt) => ({
      itemId, resourceId: 7, filePath: `/${itemId}.md`, originalFileName: `${itemId}.md`,
      title: `${itemId}.md`, sourceUrl: `cloud-knowledge://7/${itemId}.md`, sourceItemId: `7:/${itemId}.md`,
      fileType: 'md', fileSize: 12, updatedAt, materialization: { status: 'pending', contentGranularity: 'unknown' },
    });
    const result = await runUnifiedSearch(paths, { query: '近一周的巡检流程' }, {
      now: () => new Date('2026-09-21T08:00:00Z'),
      runPublicDiscover: async () => ({ merged: { groups: {} } }),
      createCloudKnowledgeAdapter: () => ({
        search: async ({ outputDir }) => {
          await writeFile(join(outputDir, 'sanitized/metadata.json'), JSON.stringify({ collection: { items: [
            cloudItem('current', '2026-09-20T08:00:00Z'),
            cloudItem('old', '2026-09-01T08:00:00Z'),
            cloudItem('unknown', ''),
          ] } }));
          return { ok: true, status: 'complete' };
        },
      }),
    });

    assert.deepEqual(result.candidates.map((candidate) => candidate.candidateId), ['current']);
    assert.equal(result.freshness.cloudExcludedKnownOutOfRange, 1);
    assert.equal(result.freshness.cloudUnknownUpdatedAt, 1);
    assert.equal(result.candidates[0].freshnessStatus, 'in-range');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unified search resolves cloud resource from project id when no explicit resource id is given', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-project-context-'));
  try {
    ensureSessionSkeleton(root);
    const paths = { root, session: join(root, 'session.json'), collectionResult: join(root, 'collection-result.json'), metadata: join(root, 'sanitized/metadata.json'), inputDir: join(root, '.collection-inputs'), lock: join(root, '.knowledge-collection.lock') };
    persistSession(paths, newSession(unifiedTask('巡检流程')));
    let resolvedProjectId;
    const result = await runUnifiedSearch(paths, { query: '巡检流程', 'project-id': '20044191' }, {
      runPublicDiscover: async () => ({ merged: { results: [] } }),
      resolveCloudResourceId: async (projectId) => {
        resolvedProjectId = projectId;
        return 7;
      },
      createCloudKnowledgeAdapter: () => ({
        search: async ({ outputDir }) => {
          await writeFile(join(outputDir, 'sanitized/metadata.json'), JSON.stringify({ collection: { items: [] } }));
          return { ok: true, status: 'complete' };
        },
      }),
    });
    assert.equal(resolvedProjectId, 20044191);
    assert.equal(result.sources.cloudKnowledge.status, 'complete');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unified search propagates cloud failure reason', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-cloud-failure-'));
  try {
    ensureSessionSkeleton(root);
    const paths = { root, session: join(root, 'session.json'), collectionResult: join(root, 'collection-result.json'), metadata: join(root, 'sanitized/metadata.json'), inputDir: join(root, '.collection-inputs'), lock: join(root, '.knowledge-collection.lock') };
    persistSession(paths, newSession(unifiedTask('云盘失败测试', {
      cloudDiscoveryScope: { schemaVersion: '1.0', resources: [{ resourceId: 7, directoryPath: '/', origin: 'user-input' }] },
    })));
    const result = await runUnifiedSearch(paths, { query: '云盘失败测试' }, {
      runPublicDiscover: async () => ({ merged: { results: [] } }),
      createCloudKnowledgeAdapter: () => ({
        search: async () => ({ ok: true, status: 'failed', reasonCode: 'SOURCE_FAILED', reason: 'backend unavailable' }),
      }),
    });
    assert.equal(result.sources.cloudKnowledge.status, 'failed');
    assert.equal(result.sources.cloudKnowledge.error, 'SOURCE_FAILED');
    assert.equal(result.sources.cloudKnowledge.reasonCode, 'SOURCE_FAILED');
    assert.equal(result.sources.cloudKnowledge.reason, 'backend unavailable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unified materialize routes public and cloud candidates independently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-materialize-'));
  try {
    ensureSessionSkeleton(root);
    const paths = { root, session: join(root, 'session.json'), collectionResult: join(root, 'collection-result.json'), metadata: join(root, 'sanitized/metadata.json'), inputDir: join(root, '.collection-inputs'), lock: join(root, '.knowledge-collection.lock') };
    const session = newSession({ query: '巡检流程', sourceScope: ['public-internet', 'cloud-knowledge'] });
    session.collection = { schemaVersion: '1.0', storage: { fallback: false }, collection: { status: 'collected', items: [
      { itemId: 'public-1', source: 'public-internet', sourceUrl: 'https://example.test/a', title: 'web', materialization: { status: 'pending' } },
      { itemId: 'cloud-1', source: 'cloud-knowledge', sourceUrl: 'cloud-knowledge://7/a.md', title: 'cloud', resourceId: 7, filePath: '/a.md', fileType: 'md', fileSize: 1, materialization: { status: 'pending' } },
    ] } };
    persistSession(paths, session);
    const calls = [];
    const result = await runUnifiedMaterialize(paths, { 'item-ids': 'public-1,cloud-1' }, {
      runWebAcquire: async () => { calls.push('acquire-web'); return { executorResult: 'raw/bycli/web/public-1/executor-result.json' }; },
      runWebMaterialize: async () => { calls.push('materialize-web'); return { ok: true }; },
      createCloudKnowledgeAdapter: () => ({ materialize: async () => { calls.push('cloud-materialize'); return { ok: true }; } }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['acquire-web', 'materialize-web', 'cloud-materialize']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unified materialize rejects a time-bounded public candidate with unknown publication date', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-materialize-freshness-'));
  try {
    ensureSessionSkeleton(root);
    const paths = {
      root,
      session: join(root, 'session.json'),
      collectionResult: join(root, 'collection-result.json'),
      metadata: join(root, 'sanitized/metadata.json'),
      inputDir: join(root, '.collection-inputs'),
      lock: join(root, '.knowledge-collection.lock'),
    };
    const session = newSession(unifiedTask('近一周 AI 新闻'));
    session.collection = { schemaVersion: '1.0', storage: { fallback: false }, collection: { status: 'collected', items: [
      {
        itemId: 'public-unknown-date', source: 'public-internet',
        sourceUrl: 'https://example.test/unknown', title: '未知日期新闻',
        freshnessStatus: 'unknown', timeRange: 'week', materialization: { status: 'pending' },
      },
    ] } };
    persistSession(paths, session);

    await assert.rejects(
      runUnifiedMaterialize(paths, { 'item-ids': 'public-unknown-date' }),
      /PUBLICATION_DATE_NOT_VERIFIED/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
