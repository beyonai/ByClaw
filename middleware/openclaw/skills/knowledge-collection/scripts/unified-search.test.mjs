import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureSessionSkeleton, loadSession, newSession, persistSession } from './session.mjs';
import { sessionPaths } from './session.mjs';
import { cmdInit } from './research-state.mjs';
import { collectionStatus } from './collection-state.mjs';
import { recordDiscoveryResult, reserveDiscoveryAttempt } from './discovery-authorization.mjs';
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

test('unified search owns one final selection and provider failure preserves legacy order', async () => {
  for (const succeeds of [true, false]) {
    const root = await mkdtemp(join(tmpdir(), 'unified-jev-'));
    try {
      ensureSessionSkeleton(root);
      const paths = { root, session: join(root, 'session.json'), collectionResult: join(root, 'collection-result.json'),
        metadata: join(root, 'sanitized/metadata.json'), inputDir: join(root, '.collection-inputs'), lock: join(root, '.knowledge-collection.lock') };
      persistSession(paths, newSession(unifiedTask('agents', { sourceScope: ['public-internet'] })));
      let calls = 0;
      const result = await runUnifiedSearch(paths, { query: 'agents' }, {
        runPublicDiscover: async (_paths, _args, options) => {
          assert.equal(options.deferCandidateRanking, true);
          return { merged: { groups: { searxngTop: [
            { url: 'https://example.test/a', title: 'Agents A' },
            { url: 'https://example.test/b', title: 'Agents B' },
          ] } } };
        },
        jevOptions: { environment: {}, callJev: async () => {
          calls += 1;
          if (!succeeds) throw new Error('provider unavailable');
          return { ok: true, document: { answers: {
            i0: { type: 'choice', choice: 'low', confidence: 0.95 },
            i1: { type: 'choice', choice: 'high', confidence: 0.95 },
          } } };
        } },
      });
      assert.equal(calls, 1);
      assert.deepEqual(result.candidates.map((candidate) => candidate.title), succeeds ? ['Agents B', 'Agents A'] : ['Agents A', 'Agents B']);
      const metadata = JSON.parse(await readFile(paths.metadata, 'utf8'));
      assert.equal(metadata.sourceMetadata.ranking.jev.status, succeeds ? 'used' : 'fallback');
      assert.equal(metadata.collection.items.length, 2);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

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
    assert.deepEqual(JSON.parse(await readFile(paths.session, 'utf8')).task.cloudDiscoveryScope,
      { schemaVersion: '1.0', resources: [{ resourceId: 7, directoryPath: '/', origin: 'user-input' }] });
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
    const session = newSession(unifiedTask('巡检流程', { cloudDiscoveryScope: {
      schemaVersion: '1.0', resources: [{ resourceId: 7, directoryPath: '/', origin: 'user-input' }],
    } }));
    session.collection = { schemaVersion: '1.0', storage: { fallback: false },
      sourceMetadata: { operation: 'unified-search' }, collection: { status: 'partial', items: [
      { itemId: 'public-1', source: 'public-internet', sourceUrl: 'https://example.test/a', title: 'web', materialization: { status: 'pending' } },
      { itemId: 'cloud-1', source: 'cloud-knowledge', sourceUrl: 'cloud-knowledge://7/a.md', title: 'cloud', resourceId: 7, filePath: '/a.md', fileType: 'md', fileSize: 1, materialization: { status: 'pending' } },
    ] } };
    persistSession(paths, session);
    const calls = [];
    const result = await runUnifiedMaterialize(paths, { 'item-ids': 'public-1,cloud-1' }, {
      runWebAcquire: async () => { calls.push('acquire-web'); return { status: 'saved', executorResult: 'raw/bycli/web/public-1/executor-result.json' }; },
      runWebMaterialize: async () => { calls.push('materialize-web'); return { ok: true, materialization: { status: 'materialized' } }; },
      createCloudKnowledgeAdapter: () => ({ materialize: async () => { calls.push('cloud-materialize'); return { ok: true }; } }),
    });
    assert.equal(result.ok, false);
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
    session.collection = { schemaVersion: '1.0', storage: { fallback: false },
      sourceMetadata: { operation: 'unified-search' }, collection: { status: 'partial', items: [
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

test('unified public materialization registers canonical full text and remains idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-public-register-'));
  const url = 'https://example.com/news/1234567';
  const other = 'https://example.com/news/7654321';
  try {
    cmdInit({ 'session-dir': root, query: 'Example 公司发展',
      'source-scope': '["public-internet"]', 'materialization-target': 'selected',
      'required-content-granularity': 'full-text' });
    const paths = sessionPaths(root);
    const discovered = await runUnifiedSearch(paths, { query: 'Example 公司发展' }, {
      jevOptions: { environment: {} },
      runPublicDiscover: async (childPaths) => {
        const child = loadSession(childPaths, { persistMigration: false }).session;
        reserveDiscoveryAttempt(child.task.discoveryGate, { query: 'Example 公司发展', category: 'general' });
        recordDiscoveryResult(child.task.discoveryGate, { query: 'Example 公司发展', category: 'general',
          candidates: [url, other].map((candidateUrl) => ({ url: candidateUrl,
            title: 'Example 公司发展', pageType: 'article', passage: 'Example 公司发展与产品增长。' })) });
        persistSession(childPaths, child);
        return { merged: { groups: { searxngTop: [url, other].map((candidateUrl) => ({
          url: candidateUrl, title: 'Example 公司发展', passage: 'Example 公司发展与产品增长。',
        })) } } };
      },
    });
    assert.equal(discovered.inventory, 2);
    const [firstId, secondId] = loadSession(paths, { persistMigration: false }).session.collection.collection.items
      .map((item) => item.itemId);
    const article = ['第一部分介绍 Example 公司发展和市场背景。', '',
      '第二部分分析 Example 新产品与用户增长。', '',
      '第三部分引用 Example 管理层公开说明。', '',
      '第四部分讨论 Example 行业竞争和风险。', '',
      '第五部分总结 Example 当前进展和机会。'].join('\n');
    let executorCalls = 0;
    const runProcess = async (_bin, command) => {
      executorCalls += 1;
      if (command.at(-2) === '--format') return { exitCode: 0, stdout: '{"ok":true}', stderr: '' };
      if (command.includes('open') || command.includes('close')) return { exitCode: 0, stdout: '{}', stderr: '' };
      if (command.includes('get')) return { exitCode: 0, stdout: url, stderr: '' };
      if (command.includes('extract')) return { exitCode: 0, stdout: JSON.stringify({
        url, title: 'Example 公司发展', total_chars: article.length, start: 0,
        end: article.length, next_start_char: null, content: article,
      }), stderr: '' };
      throw new Error('unexpected executor operation');
    };
    const first = await runUnifiedMaterialize(paths, { 'item-ids': firstId }, {
      publicAcquireOptions: { runProcess },
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    const status = collectionStatus(paths);
    assert.equal(status.deliveryComplete, true);
    assert.equal(status.pending, 1);
    assert.equal(status.canonicalItems, 1);
    assert.equal(status.downstreamInput.files.length, 1);
    const session = JSON.parse(await readFile(paths.session, 'utf8'));
    assert.deepEqual(session.task.selectedDelivery.itemIds, [firstId]);
    assert.equal(session.collection.collection.items[0].materialization.contentGranularity, 'full-text');
    const second = await runUnifiedMaterialize(paths, { 'item-ids': firstId }, {
      publicAcquireOptions: { runProcess: async () => { throw new Error('unexpected reacquisition'); } },
    });
    assert.equal(second.ok, true);
    assert.equal(executorCalls > 0, true);
    assert.equal(collectionStatus(paths).canonicalItems, 1);
    const partial = await runUnifiedMaterialize(paths, { 'item-ids': secondId }, {
      publicAcquireOptions: { runProcess: async (_bin, command) => {
        if (command.at(-2) === '--format') return { exitCode: 0, stdout: '{"ok":true}', stderr: '' };
        if (command.includes('open') || command.includes('close')) return { exitCode: 0, stdout: '{}', stderr: '' };
        if (command.includes('get')) return { exitCode: 0, stdout: other, stderr: '' };
        if (command.includes('extract')) return { exitCode: 0, stdout: JSON.stringify({
          url: other, title: 'Example', total_chars: 5, start: 0,
          end: 5, next_start_char: null, content: 'short',
        }), stderr: '' };
        throw new Error('unexpected executor operation');
      } },
    });
    assert.equal(partial.ok, false);
    const partialStatus = collectionStatus(paths);
    assert.equal(partialStatus.deliveryComplete, false);
    assert.equal(partialStatus.canonicalItems, 1);
    assert.deepEqual(JSON.parse(await readFile(paths.session, 'utf8')).task.selectedDelivery.itemIds,
      [firstId, secondId]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unified materialization reports a failed selected cloud download', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-cloud-failed-download-'));
  try {
    ensureSessionSkeleton(root);
    const paths = { root, session: join(root, 'session.json') };
    const session = newSession(unifiedTask('巡检流程', { sourceScope: ['cloud-knowledge'],
      cloudDiscoveryScope: { schemaVersion: '1.0', resources: [
        { resourceId: 7, directoryPath: '/', origin: 'user-input' },
      ] } }));
    session.collection = { sourceMetadata: { operation: 'unified-search' },
      collection: { status: 'partial', items: [{ itemId: 'cloud-1', source: 'cloud-knowledge',
        resourceId: 7, filePath: '/a.md', fileType: 'md', fileSize: 12,
        materialization: { status: 'pending' } }] } };
    persistSession(paths, session);
    const result = await runUnifiedMaterialize(paths, { 'item-ids': 'cloud-1' }, {
      createCloudKnowledgeAdapter: () => ({ materialize: async () => ({ status: 'failed' }) }),
    });
    assert.equal(result.ok, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const legacy of [false, true]) {
  test(`real unified cloud retry preserves cumulative delivery (${legacy ? 'legacy source-less' : 'current'} rows)`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'unified-cloud-retry-'));
    try {
      ensureSessionSkeleton(root);
      persistSession({ root, session: join(root, 'session.json') }, newSession(unifiedTask('DeepSeek', { cloudDiscoveryScope: {
        schemaVersion: '1.0', resources: [{ resourceId: 7, directoryPath: '/docs', origin: 'user-input' }],
      } })));
      const paths = sessionPaths(root);
      const script = join(root, 'offline-cloud.mjs');
      const log = join(root, 'downloads.jsonl');
      await writeFile(script, `
import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2);
if (args[0] === 'search-file') process.stdout.write(JSON.stringify({ ok: true, data: ['a', 'b', 'c'].map((id) => ({
  resourceId: 7, filePath: '/docs/' + id + '.md', metadata: { fileType: { value: 'md' }, fileSize: { value: 12 } },
})) }));
else if (args[0] === 'download') {
  const file = args[args.indexOf('--file-path') + 1];
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(file) + '\\n');
  if (file === '/docs/b.md' && !fs.existsSync(${JSON.stringify(join(root, 'resolved'))})) process.exit(2);
  const output = args[args.indexOf('--output') + 1];
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, '# DeepSeek full document ' + file);
  process.stdout.write(JSON.stringify({ ok: true, output }));
}
`);
      const dependencies = { python: process.execPath, script, env: { ...process.env, TYPESAFE_ENABLED: 'false' },
        jevOptions: { environment: { TYPESAFE_ENABLED: 'false' } },
        runPublicDiscover: async () => ({ merged: { results: [
          { url: 'https://example.com/deepseek', title: 'DeepSeek public' },
        ] } }),
      };
      await runUnifiedSearch(paths, { query: 'DeepSeek' }, dependencies);
      const original = loadSession(paths).session.collection.collection.items;
      const firstId = original.find((item) => item.filePath === '/docs/a.md').itemId;
      const failedId = original.find((item) => item.filePath === '/docs/b.md').itemId;
      const retained = original.filter((item) => ![firstId, failedId].includes(item.itemId));
      assert.equal((await runUnifiedMaterialize(paths, { 'item-ids': firstId }, dependencies)).ok, true);
      assert.equal((await runUnifiedMaterialize(paths, { 'item-ids': failedId }, dependencies)).ok, false);
      assert.equal(collectionStatus(paths).deliveryComplete, false);
      const failed = loadSession(paths).session;
      assert.deepEqual(failed.task.selectedDelivery.itemIds, [firstId, failedId]);
      if (legacy) {
        delete failed.collection.collection.items.find((item) => item.itemId === failedId).source;
        persistSession(paths, failed);
        const metadata = JSON.parse(await readFile(paths.metadata, 'utf8'));
        delete metadata.collection.items.find((item) => item.itemId === failedId).source;
        await writeFile(paths.metadata, JSON.stringify(metadata));
      } else {
        assert.equal(failed.collection.collection.items.find((item) => item.itemId === failedId).source, 'cloud-knowledge');
      }
      await writeFile(join(root, 'resolved'), 'yes');
      const retry = await runUnifiedMaterialize(paths, { 'item-ids': `${firstId},${failedId}` }, dependencies);
      assert.equal(retry.ok, true, JSON.stringify(retry));
      const status = collectionStatus(paths);
      assert.equal(status.deliveryComplete, true);
      assert.equal(status.pending, 2);
      assert.equal(status.downstreamInput.files.length, 2);
      for (const file of status.downstreamInput.files) assert.match(await readFile(file, 'utf8'), /DeepSeek full document/);
      const final = loadSession(paths).session;
      assert.deepEqual(final.task.selectedDelivery.itemIds, [firstId, failedId]);
      assert.deepEqual(final.collection.collection.items.filter((item) => retained.some((row) => row.itemId === item.itemId)), retained);
      assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse),
        ['/docs/a.md', '/docs/b.md', '/docs/b.md']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test('unified materialization rejects an out-of-scope cloud item before selecting anything', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-cloud-scope-preflight-'));
  try {
    ensureSessionSkeleton(root);
    const paths = { root, session: join(root, 'session.json') };
    const session = newSession(unifiedTask('巡检流程', { sourceScope: ['public-internet', 'cloud-knowledge'],
      cloudDiscoveryScope: { schemaVersion: '1.0', resources: [
        { resourceId: 7, directoryPath: '/docs', origin: 'user-input' },
      ] } }));
    session.collection = { sourceMetadata: { operation: 'unified-search' },
      collection: { status: 'partial', items: [
        { itemId: 'public-first', source: 'public-internet', sourceSkill: 'bycli',
          sourceUrl: 'https://example.test/article', materialization: { status: 'pending' } },
        { itemId: 'cloud-outside', source: 'cloud-knowledge',
          sourceSkill: 'project-cloud-knowledge', resourceId: 7, filePath: '/outside/a.md',
          fileType: 'md', fileSize: 12, materialization: { status: 'pending' } },
      ] } };
    persistSession(paths, session);
    const before = await readFile(paths.session, 'utf8');
    let adapterCalled = false;
    let acquireCalled = false;
    await assert.rejects(runUnifiedMaterialize(paths, { 'item-ids': 'public-first,cloud-outside' }, {
      runWebAcquire: async () => { acquireCalled = true; throw new Error('public acquire must not run before preflight'); },
      createCloudKnowledgeAdapter: () => {
        adapterCalled = true;
        throw new Error('cloud adapter must not run before scope preflight');
      },
    }), /SOURCE_NOT_AUTHORIZED_BY_DISCOVERY/);
    assert.equal(adapterCalled, false);
    assert.equal(acquireCalled, false);
    assert.equal(await readFile(paths.session, 'utf8'), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unified cloud source identity validation rejects inconsistent and legacy out-of-scope rows before mutation', async () => {
  for (const identity of [
    { source: 'public-internet', sourceSkill: 'project-cloud-knowledge' },
    { source: 'cloud-knowledge', sourceSkill: 'bycli' },
    { sourceSkill: 'project-cloud-knowledge', resourceId: 8 },
    { sourceSkill: 'project-cloud-knowledge', filePath: '/outside/a.md' },
  ]) {
    const root = await mkdtemp(join(tmpdir(), 'unified-cloud-identity-'));
    try {
      ensureSessionSkeleton(root);
      const paths = { root, session: join(root, 'session.json') };
      const session = newSession(unifiedTask('DeepSeek', { cloudDiscoveryScope: {
        schemaVersion: '1.0', resources: [{ resourceId: 7, directoryPath: '/docs', origin: 'user-input' }],
      } }));
      session.collection = { sourceMetadata: { operation: 'unified-search' }, collection: { items: [
        { itemId: 'cloud-1', resourceId: 7, filePath: '/docs/a.md', fileType: 'md', fileSize: 12,
          materialization: { status: 'failed' }, ...identity },
      ] } };
      persistSession(paths, session);
      const before = await readFile(paths.session, 'utf8');
      await assert.rejects(runUnifiedMaterialize(paths, { 'item-ids': 'cloud-1' }, {
        createCloudKnowledgeAdapter: () => assert.fail('invalid identity must fail before dispatch'),
        runWebAcquire: () => assert.fail('invalid identity must fail before dispatch'),
      }), /authorized sourceScope|SOURCE_NOT_AUTHORIZED_BY_DISCOVERY/);
      assert.equal(await readFile(paths.session, 'utf8'), before);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
