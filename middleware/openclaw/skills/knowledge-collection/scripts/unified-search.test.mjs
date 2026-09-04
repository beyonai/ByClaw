import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureSessionSkeleton, newSession, persistSession, sessionPaths } from './session.mjs';
import { mergeUnifiedCandidates } from './unified-candidates.mjs';
import { runUnifiedMaterialize, runUnifiedSearch } from './unified-search.mjs';

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

test('unified search continues with cloud results when public discovery fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unified-search-'));
  try {
    ensureSessionSkeleton(root);
    const paths = { root, session: join(root, 'session.json'), collectionResult: join(root, 'collection-result.json'), metadata: join(root, 'sanitized/metadata.json'), inputDir: join(root, '.collection-inputs'), lock: join(root, '.knowledge-collection.lock') };
    persistSession(paths, newSession({
      query: '巡检流程', sourceScope: ['public-internet', 'cloud-knowledge'],
      cloudDiscoveryScope: { schemaVersion: '1.0', resources: [{ resourceId: 7, directoryPath: '/', origin: 'user-input' }] },
    }));
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
