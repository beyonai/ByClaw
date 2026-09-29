import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureSessionSkeleton, sessionPaths, newSession, persistSession, loadSession } from '../session.mjs';
import { cmdCrawlNext, cmdCrawlSeed } from '../crawl-state.mjs';
import { cmdAggregate } from '../research-state.mjs';
import { runResearchUpdate, runResearchAggregate, runCrawlNext, runCrawlSeed } from './workflow-advisory.mjs';

function setup(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jev-advisory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ensureSessionSkeleton(root);
  const session = newSession({ query: 'agent memory', mode: 'research', sourceScope: ['public-internet'],
    materializationTarget: 'selected', maxContextWords: 100, ...overrides });
  session.research = { branches: [{ id: 'b1', query: 'initial', status: 'done', followups: [] }],
    learnings: ['known finding'], citations: { claim: 'source1' }, visitedUrls: [], context:
      ['key finding '.repeat(30), 'related work '.repeat(30), 'repeated idea '.repeat(30)] };
  session.crawl = { schemaVersion: '1.0', entries: ['navigation', 'memory', 'overview'].map((part) => ({
    url: `https://example.com/${part}`, status: 'pending', depth: 0, itemId: null, reason: null,
  })), coverage: {}, overCapUrls: [] };
  persistSession({ root, session: join(root, 'session.json') }, session);
  const paths = sessionPaths(root);
  return { paths, session, args: { 'session-dir': root } };
}
const response = (payload) => ({ ok: true, document: { answers: Object.fromEntries(Object.keys(payload.questions)
  .map((key, index) => [key, { type: 'choice', choice: index === 1 ? 'high' : 'low', confidence: 0.95 }])) } });

test('crawl orders pending URLs without changing the queue, and failure matches baseline', async (t) => {
  const { paths, args } = setup(t);
  const original = loadSession(paths).session;
  const result = await runCrawlNext(paths, { ...args, limit: 1 }, { callJev: async (payload) => response(payload) });
  assert.deepEqual(result.urls, ['https://example.com/memory']);
  assert.deepEqual(loadSession(paths).session, original);
  const failed = await runCrawlNext(paths, { ...args, limit: 1 }, { callJev: async () => { throw new Error('fail'); } });
  assert.deepEqual(failed.urls, cmdCrawlNext(paths, { ...args, limit: 1 }).urls);
  assert.equal(failed.remaining, 2);
});

test('successful crawl advice is reused across calls without changing canonical state', async (t) => {
  const { paths, args } = setup(t);
  const original = loadSession(paths).session;
  let calls = 0;
  const callJev = async (payload) => { calls += 1; return response(payload); };
  const first = await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  const second = await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  assert.deepEqual([first.urls, second.urls], [
    ['https://example.com/memory'], ['https://example.com/memory'],
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(loadSession(paths).session, original);
  const sidecar = JSON.parse(readFileSync(join(paths.root, '.jev-advisory-cache.json'), 'utf8'));
  assert.equal(JSON.stringify(sidecar).includes('example.com'), false);
  assert.equal(JSON.stringify(sidecar).includes('agent memory'), false);
  assert.equal(statSync(join(paths.root, '.jev-advisory-cache.json')).mode & 0o077, 0);
});

test('new transport and changed session evidence cannot reuse crawl advice', async (t) => {
  const { paths, args } = setup(t);
  let firstCalls = 0;
  const callJev = async (payload) => { firstCalls += 1; return response(payload); };
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  assert.equal(firstCalls, 1);
  const different = await runCrawlNext(paths, { ...args, limit: 1 }, { callJev: async () => null });
  assert.deepEqual(different.urls, ['https://example.com/navigation']);
  const session = loadSession(paths).session;
  session.research.learnings.push('new evidence');
  persistSession(paths, session);
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  assert.equal(firstCalls, 2);
});

test('Jev policy gates apply before persisted advice, including opt-out and cancellation', async (t) => {
  const { paths, args } = setup(t);
  let calls = 0;
  const callJev = async (payload) => { calls += 1; return response(payload); };
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  for (const options of [
    { environment: { TYPESAFE_ENABLED: 'false' } },
    { budgetMs: 0 },
    { remainingBudgetMs: () => 0 },
    { signal: AbortSignal.abort() },
  ]) {
    const result = await runCrawlNext(paths, { ...args, limit: 1 }, { ...options, callJev });
    assert.deepEqual(result.urls, ['https://example.com/navigation']);
  }
  const session = loadSession(paths).session;
  session.task.sourceScope = ['dingtalk'];
  persistSession(paths, session);
  const privateResult = await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  assert.deepEqual(privateResult.urls, ['https://example.com/navigation']);
  assert.equal(calls, 1);
});

test('private advice with opt-in is reusable, then privacy opt-out invalidates it', async (t) => {
  const { paths, args } = setup(t, { sourceScope: ['dingtalk'] });
  const enabled = { TYPESAFE_ENTERPRISE_ENABLED: 'true' };
  let calls = 0;
  const callJev = async (payload) => { calls += 1; return response(payload); };
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev, environment: enabled });
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev, environment: enabled });
  assert.equal(calls, 1);
  const disabled = await runCrawlNext(paths, { ...args, limit: 1 }, { callJev,
    environment: { TYPESAFE_ENTERPRISE_ENABLED: 'false' } });
  assert.deepEqual(disabled.urls, ['https://example.com/navigation']);
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev, environment: enabled });
  assert.equal(calls, 2);
});

test('model, credential, and fetch transport changes miss persisted advice', async (t) => {
  const { paths, args } = setup(t);
  let calls = 0;
  const callJev = async (payload) => { calls += 1; return response(payload); };
  const fetchA = async () => null;
  const fetchB = async () => null;
  const base = { callJev, fetchImpl: fetchA, environment: { TYPESAFE_MODEL: 'one', TYPESAFE_API_KEY: 'secret-a' } };
  for (const options of [base, base,
    { ...base, fetchImpl: fetchB },
    { ...base, environment: { TYPESAFE_MODEL: 'two', TYPESAFE_API_KEY: 'secret-a' } },
    { ...base, environment: { TYPESAFE_MODEL: 'one', TYPESAFE_API_KEY: 'secret-b' } }]) {
    await runCrawlNext(paths, { ...args, limit: 1 }, options);
  }
  assert.equal(calls, 4);
  const sidecar = readFileSync(join(paths.root, '.jev-advisory-cache.json'), 'utf8');
  assert.equal(sidecar.includes('secret-a'), false);
  assert.equal(sidecar.includes('secret-b'), false);
});

test('malformed, expired and unsafe sidecars fall back to fresh advice', async (t) => {
  const { paths, args } = setup(t);
  const cachePath = join(paths.root, '.jev-advisory-cache.json');
  let calls = 0;
  const callJev = async (payload) => { calls += 1; return response(payload); };
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  const valid = JSON.parse(readFileSync(cachePath, 'utf8'));
  valid.entries[0].at = Date.now() - 61_000;
  writeFileSync(cachePath, JSON.stringify(valid), { mode: 0o600 });
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  assert.equal(calls, 2);
  writeFileSync(cachePath, '{broken', { mode: 0o600 });
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  assert.equal(calls, 3);
  rmSync(cachePath);
  const outside = join(paths.root, 'outside.json');
  writeFileSync(outside, 'untouched');
  symlinkSync(outside, cachePath);
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  assert.equal(calls, 4);
  assert.equal(readFileSync(outside, 'utf8'), 'untouched');
});

test('invalid permutations, future timestamps and sidecar I/O errors never apply cached order', async (t) => {
  const { paths, args } = setup(t);
  const cachePath = join(paths.root, '.jev-advisory-cache.json');
  let calls = 0;
  const callJev = async (payload) => { calls += 1; return response(payload); };
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  const invalid = JSON.parse(readFileSync(cachePath, 'utf8'));
  invalid.entries[0].indices = [0, 0, 2];
  writeFileSync(cachePath, JSON.stringify(invalid), { mode: 0o600 });
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  assert.equal(calls, 2);
  const future = JSON.parse(readFileSync(cachePath, 'utf8'));
  future.entries[0].at = Date.now() + 60_000;
  writeFileSync(cachePath, JSON.stringify(future), { mode: 0o600 });
  await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  assert.equal(calls, 3);
  rmSync(cachePath);
  mkdirSync(cachePath);
  const result = await runCrawlNext(paths, { ...args, limit: 1 }, { callJev });
  assert.deepEqual(result.urls, ['https://example.com/memory']);
  assert.equal(calls, 4);
});

test('exhaustive crawls skip inference and retain every page', async (t) => {
  const { paths, args } = setup(t, { materializationTarget: 'all' });
  assert.deepEqual(await runCrawlNext(paths, { ...args, limit: 1 }, {
    callJev: () => { throw new Error('must not infer'); },
  }), cmdCrawlNext(paths, { ...args, limit: 1 }));
});

test('context selection preserves originals and citations, keeps selected text unmodified', async (t) => {
  const { paths, args, session } = setup(t);
  await runResearchAggregate(args, { callJev: async (payload) => response(payload) });
  const updated = loadSession(paths).session;
  assert.deepEqual(updated.research.context, [session.research.context[1]]);
  assert.deepEqual(updated.research.contextArchive, session.research.context);
  assert.deepEqual(updated.research.citations, session.research.citations);
});

test('failed context selection produces exactly the legacy persisted research state', async (t) => {
  const left = setup(t);
  const right = setup(t);
  await runResearchAggregate(left.args, { callJev: async () => { throw new Error('fail'); } });
  cmdAggregate(right.args);
  assert.deepEqual(loadSession(left.paths).session.research, loadSession(right.paths).session.research);
});

test('research plan suggests only existing followups and fallback retains their order', async (t) => {
  const { paths, args } = setup(t);
  const input = { ...args, 'initial-search': '["agent memory"]', followups: '["architecture","evaluation"]',
    channels: JSON.stringify(Object.fromEntries(['builtin-routing', 'searxng', 'hot-discovery'].map((key) => [key, { state: 'used' }]))) };
  const ranked = await runResearchUpdate('plan', input, { callJev: async (payload) => response(payload) });
  assert.deepEqual(ranked.suggestedFollowups, ['evaluation', 'architecture']);
  assert.deepEqual(loadSession(paths).session.task.followups, ['architecture', 'evaluation']);
  const failed = await runResearchUpdate('plan', input, { callJev: async () => null });
  assert.deepEqual(failed.suggestedFollowups, ['architecture', 'evaluation']);
});

test('repeated research plan reuses successful followup advice from its session sidecar', async (t) => {
  const { args } = setup(t);
  const input = { ...args, 'initial-search': '["agent memory"]', followups: '["architecture","evaluation"]',
    channels: JSON.stringify(Object.fromEntries(['builtin-routing', 'searxng', 'hot-discovery'].map((key) => [key, { state: 'used' }]))) };
  let calls = 0;
  const callJev = async (payload) => { calls += 1; return response(payload); };
  const first = await runResearchUpdate('plan', input, { callJev });
  const second = await runResearchUpdate('plan', input, { callJev });
  assert.deepEqual(first.suggestedFollowups, ['evaluation', 'architecture']);
  assert.deepEqual(second.suggestedFollowups, first.suggestedFollowups);
  assert.equal(calls, 1);
});

test('inference cannot apply a stale crawl order when the queue changes', async (t) => {
  const { paths, args } = setup(t);
  const result = await runCrawlNext(paths, { ...args, limit: 1 }, { callJev: async (payload) => {
    const session = loadSession(paths).session;
    session.crawl.entries[1].status = 'fetched';
    persistSession(paths, session);
    return response(payload);
  } });
  assert.equal(result.candidateRanking.code, 'CONTEXT_CHANGED');
  assert.deepEqual(result.urls, ['https://example.com/navigation']);
  assert.equal(existsSync(join(paths.root, '.jev-advisory-cache.json')), false);
});

test('large crawl-next ranks authorized path groups and leaves all pending entries untouched', async (t) => {
  const { paths, args } = setup(t);
  const session = loadSession(paths).session;
  session.crawl.entries = Array.from({ length: 120 }, (_, index) => ({
    url: `https://example.com/${index % 2 ? 'guide' : 'api'}/page-${index}`,
    status: 'pending', depth: 0, itemId: null, reason: null,
  }));
  persistSession(paths, session);
  const result = await runCrawlNext(paths, { ...args, limit: 2 }, { callJev: async (payload) => ({
    ok: true, document: { answers: Object.fromEntries(Object.keys(payload.questions).map((key, index) => [key,
      { type: 'choice', choice: index === 1 ? 'high' : 'low', confidence: 0.95 }])) },
  }) });
  assert.deepEqual(result.urls, ['https://example.com/guide/page-1', 'https://example.com/guide/page-3']);
  assert.deepEqual(loadSession(paths).session.crawl.entries, session.crawl.entries);
});

test('crawl-seed selects groups before the cap and preserves every original URL in admission or overflow', async (t) => {
  const { paths, args } = setup(t);
  const session = loadSession(paths).session;
  session.crawl.entries = [];
  persistSession(paths, session);
  const urls = Array.from({ length: 120 }, (_, index) =>
    `https://example.com/${index % 2 ? 'guide' : 'api'}/page-${index}`);
  const urlsFile = join(paths.root, 'urls.txt');
  writeFileSync(urlsFile, urls.join('\n'));
  const result = await runCrawlSeed(paths, { ...args, 'urls-file': urlsFile, 'max-pages': 1 }, {
    callJev: async (payload) => ({ ok: true, document: { answers: Object.fromEntries(
      Object.keys(payload.questions).map((key, index) => [key,
        { type: 'choice', choice: index === 1 ? 'high' : 'low', confidence: 0.95 }]),
    ) } }),
  });
  const crawl = loadSession(paths).session.crawl;
  assert.equal(result.added, 1);
  assert.deepEqual(crawl.entries.map((entry) => entry.url), ['https://example.com/guide/page-1']);
  assert.equal(crawl.overCapUrls.length, 119);
  assert.deepEqual(new Set([...crawl.entries.map((entry) => entry.url), ...crawl.overCapUrls]), new Set(urls));
});

test('large-group crawl seed keeps all 120 URLs across admission and overflow', async (t) => {
  const { paths, args } = setup(t);
  const session = loadSession(paths).session;
  session.crawl.entries = [];
  persistSession(paths, session);
  const urls = Array.from({ length: 120 }, (_, index) => `https://example.com/group-${index}/page`);
  const urlsFile = join(paths.root, 'urls-large.txt');
  writeFileSync(urlsFile, urls.join('\n'));
  const result = await runCrawlSeed(paths, { ...args, 'urls-file': urlsFile, 'max-pages': 1 }, {
    callJev: async (payload) => ({ ok: true, document: { answers: Object.fromEntries(
      Object.entries(payload.state.items).map(([key, item]) => [key, { type: 'choice',
        choice: `${item.title} ${item.text}`.includes('group-110') ? 'high' : 'low', confidence: 0.95 }]),
    ) } }),
  });
  const crawl = loadSession(paths).session.crawl;
  assert.equal(result.added, 1);
  assert.deepEqual(crawl.entries.map((entry) => entry.url), [urls[110]]);
  assert.equal(crawl.overCapUrls.length, 119);
  assert.deepEqual(new Set([...crawl.entries.map((entry) => entry.url), ...crawl.overCapUrls]), new Set(urls));
});

test('failed crawl-seed inference yields the exact legacy persisted crawl state', async (t) => {
  const left = setup(t);
  const right = setup(t);
  for (const fixture of [left, right]) {
    const session = loadSession(fixture.paths).session;
    session.crawl.entries = [];
    persistSession(fixture.paths, session);
  }
  const urls = ['https://example.com/api/one', 'https://example.com/guide/two'];
  const leftFile = join(left.paths.root, 'urls.txt');
  const rightFile = join(right.paths.root, 'urls.txt');
  writeFileSync(leftFile, urls.join('\n'));
  writeFileSync(rightFile, urls.join('\n'));
  await runCrawlSeed(left.paths, { ...left.args, 'urls-file': leftFile, 'max-pages': 1 }, {
    callJev: async () => { throw new Error('unavailable'); },
  });
  cmdCrawlSeed(right.paths, { ...right.args, 'urls-file': rightFile, 'max-pages': 1 });
  const actual = loadSession(left.paths).session.crawl;
  const expected = loadSession(right.paths).session.crawl;
  assert.deepEqual({ ...actual, seededAt: null }, { ...expected, seededAt: null });
});

test('all-target crawl-seed bypasses inference and admits URLs in file order', async (t) => {
  const { paths, args } = setup(t, { materializationTarget: 'all' });
  const session = loadSession(paths).session;
  session.crawl.entries = [];
  persistSession(paths, session);
  const urlsFile = join(paths.root, 'urls.txt');
  writeFileSync(urlsFile, 'https://example.com/api/one\nhttps://example.com/guide/two\n');
  let inferenceCalls = 0;
  const result = await runCrawlSeed(paths, { ...args, 'urls-file': urlsFile, 'max-pages': 1 }, {
    callJev: async () => { inferenceCalls += 1; throw new Error('must not infer'); },
  });
  assert.equal(inferenceCalls, 0);
  assert.equal(result.added, 1);
  assert.deepEqual(loadSession(paths).session.crawl.entries.map((entry) => entry.url),
    ['https://example.com/api/one']);
  assert.deepEqual(loadSession(paths).session.crawl.overCapUrls, ['https://example.com/guide/two']);
});

test('crawl-seed prioritizes only in-scope valid URLs while preserving interleaved input accounting', async (t) => {
  const { paths, args } = setup(t);
  const session = loadSession(paths).session;
  session.crawl.entries = [];
  persistSession(paths, session);
  const urlsFile = join(paths.root, 'urls.txt');
  writeFileSync(urlsFile, [
    'https://example.com/api/one',
    'https://outside.example.org/private',
    'https://user:pass@example.com/rejected',
    'https://example.com/guide/two',
  ].join('\n'));
  const result = await runCrawlSeed(paths, { ...args, 'urls-file': urlsFile,
    'scope-prefix': 'https://example.com/', 'max-pages': 1 }, {
    callJev: async (payload) => {
      assert.deepEqual(Object.values(payload.state.items).map((item) => item.title),
        ['example.com/api', 'example.com/guide']);
      return response(payload);
    },
  });
  const crawl = loadSession(paths).session.crawl;
  assert.equal(result.discovered, 4);
  assert.deepEqual(result.skipped, { duplicate: 0, outOfScope: 1, overCap: 1 });
  assert.deepEqual(crawl.entries.map((entry) => entry.url), ['https://example.com/guide/two']);
  assert.deepEqual(crawl.overCapUrls, ['https://example.com/api/one']);
});

test('crawl-seed uses the current source file when it changes during inference', async (t) => {
  const { paths, args } = setup(t);
  const session = loadSession(paths).session;
  session.crawl.entries = [];
  persistSession(paths, session);
  const urlsFile = join(paths.root, 'urls.txt');
  writeFileSync(urlsFile, 'https://example.com/api/old\nhttps://example.com/guide/old\n');
  let inferenceCalls = 0;
  const result = await runCrawlSeed(paths, { ...args, 'urls-file': urlsFile, 'max-pages': 1 }, {
    callJev: async (payload) => {
      inferenceCalls += 1;
      writeFileSync(urlsFile, 'https://example.com/new/first\nhttps://example.com/guide/after\n');
      return response(payload);
    },
  });
  const crawl = loadSession(paths).session.crawl;
  assert.equal(inferenceCalls, 1);
  assert.equal(result.discovered, 2);
  assert.deepEqual(crawl.entries.map((entry) => entry.url), ['https://example.com/new/first']);
  assert.deepEqual(crawl.overCapUrls, ['https://example.com/guide/after']);
});
