import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ensureSessionSkeleton, newSession, sessionPaths } from './session.mjs';
import { createDiscoveryAuthorization } from './discovery-authorization.mjs';
import * as publicDiscovery from './public-discovery.mjs';

const { runPublicDiscover } = publicDiscovery;

test('selects the bounded Chinese article profile from deterministic task state', () => {
  const session = newSession({
    query: '采集一篇关于米哈游的文章',
    mode: 'collection',
    sourceScope: ['public-internet'],
    discoveryGate: createDiscoveryAuthorization({ query: '采集一篇关于米哈游的文章' }),
  });
  assert.equal(publicDiscovery.isChineseArticleProfile(session, {
    query: '米哈游 报道', category: 'general', language: 'zh-CN', 'requested-count': '1',
  }), true);
  assert.equal(publicDiscovery.isChineseArticleProfile(session, {
    query: '米哈游', category: 'images', language: 'zh-CN', 'requested-count': '1',
  }), false);
  assert.equal(publicDiscovery.isChineseArticleProfile({
    ...session, task: { ...session.task, query: '查找米哈游官网' },
  }, {
    query: '米哈游', category: 'general', language: 'zh-CN', 'requested-count': '1',
  }), false);
});

test('uses the image-wide SearXNG CLI by default', () => {
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime({}, {}),
    { executable: 'searxng-cli', argsPrefix: [] },
  );
});

test('prefers explicit SearXNG interpreter overrides over the image-wide command', () => {
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      { pythonExecutable: '/custom/python' },
      { ONLINE_SEARCH_PYTHON: '/environment/python' },
    ),
    { executable: '/custom/python', argsPrefix: ['/opt/searxng-cli/searxng_cli.py'] },
  );
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      {},
      { ONLINE_SEARCH_PYTHON: '/environment/python' },
    ),
    { executable: '/environment/python', argsPrefix: ['/opt/searxng-cli/searxng_cli.py'] },
  );
});

test('supports an explicit SearXNG script path for local development', () => {
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      { pythonExecutable: '/custom/python', searxngScript: '/workspace/searxng_cli.py' },
      { ONLINE_SEARCH_PYTHON: '/environment/python', ONLINE_SEARCH_SCRIPT: '/environment/searxng_cli.py' },
    ),
    { executable: '/custom/python', argsPrefix: ['/workspace/searxng_cli.py'] },
  );
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      {},
      { ONLINE_SEARCH_PYTHON: '/environment/python', ONLINE_SEARCH_SCRIPT: '/environment/searxng_cli.py' },
    ),
    { executable: '/environment/python', argsPrefix: ['/environment/searxng_cli.py'] },
  );
});

test('uses the unified online-search runner and exposes compatible provider aliases', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '人工智能');
  let onlineSearchCalls = 0;
  const result = await runPublicDiscover(paths, {
    query: '人工智能 报道',
    category: 'general',
    language: 'zh-CN',
    'requested-count': '1',
  }, {
    runOnlineSearch: async (args) => {
      onlineSearchCalls += 1;
      return {
        ok: true,
        durationMs: 12,
        document: {
          query: args.query,
          provider: 'tencent-wsa',
          fallbackUsed: false,
          providerDiagnostics: {
            tencentWsa: { status: 'success', durationMs: 12, resultCount: 1, requestId: 'request-1' },
            searxng: { status: 'skipped', durationMs: 0, skipReason: 'primary_provider_succeeded' },
          },
          results: [{
            url: 'https://example.com/news/1234567',
            title: '人工智能深度报道',
            content: '人工智能产业发展深度报道',
            engine: 'tencent-wsa',
          }],
        },
      };
    },
    runProcess: async (spec) => {
      if (spec.channel === 'searxng') {
        return {
          code: 0,
          stdout: JSON.stringify({ query: '人工智能 报道', results: [] }),
          stderr: '',
        };
      }
      return { code: 0, stdout: JSON.stringify({ query: '人工智能 报道', candidates: [] }), stderr: '' };
    },
  });

  assert.equal(onlineSearchCalls, 1);
  assert.equal(result.channels.onlineSearch.provider, 'tencent-wsa');
  assert.equal(result.channels.onlineSearch.fallbackUsed, false);
  assert.deepEqual(result.channels.searxng, result.channels.onlineSearch);
  assert.deepEqual(result.candidateQuality.searxng, result.candidateQuality.onlineSearch);
  assert.equal(result.timing.searxngMs, result.timing.onlineSearchMs);
  assert.equal(result.snapshots.searxng, result.snapshots.onlineSearch);
  assert.equal(result.channels.hotDiscovery.status, 'skipped');
});

test('keeps hot-discovery fallback when WSA returns a valid empty result', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '人工智能');
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: '人工智能 报道',
    category: 'general',
    language: 'zh-CN',
    'requested-count': '1',
  }, {
    runOnlineSearch: async () => ({
      ok: true,
      document: {
        query: '人工智能 报道',
        provider: 'tencent-wsa',
        fallbackUsed: false,
        providerDiagnostics: {
          tencentWsa: { status: 'success', durationMs: 5, resultCount: 0 },
          searxng: { status: 'skipped', durationMs: 0, skipReason: 'primary_provider_succeeded' },
        },
        results: [],
      },
    }),
    runProcess: async (spec) => {
      calls.push(spec.channel);
      return {
        code: 0,
        stdout: JSON.stringify({ query: '人工智能 报道', candidates: [] }),
        stderr: '',
      };
    },
  });

  assert.deepEqual(calls, ['hot-discovery']);
  assert.equal(result.channels.onlineSearch.status, 'success');
  assert.equal(result.channels.onlineSearch.provider, 'tencent-wsa');
  assert.equal(result.channels.hotDiscovery.status, 'success');
});

test('preserves provider diagnostics when online-search fails and hot-discovery succeeds', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '人工智能');
  const result = await runPublicDiscover(paths, {
    query: '人工智能 报道',
    category: 'general',
    'requested-count': '1',
  }, {
    runOnlineSearch: async () => ({
      ok: false,
      error: { category: 'provider', code: 'ONLINE_SEARCH_FAILED', message: 'both failed' },
      provider: 'searxng',
      fallbackUsed: true,
      providerDiagnostics: {
        tencentWsa: { status: 'failed', code: 'WSA_DISABLED', category: 'unavailable' },
        searxng: { status: 'failed', code: 'SEARXNG_FAILED', category: 'provider' },
      },
    }),
    runProcess: async () => ({
      code: 0,
      stdout: JSON.stringify({ query: '人工智能 报道', candidates: [] }),
      stderr: '',
    }),
  });

  assert.equal(result.channels.onlineSearch.provider, 'searxng');
  assert.equal(result.channels.onlineSearch.fallbackUsed, true);
  assert.equal(result.channels.onlineSearch.providerDiagnostics.tencentWsa.code, 'WSA_DISABLED');
  assert.equal(result.channels.onlineSearch.providerDiagnostics.searxng.code, 'SEARXNG_FAILED');
});

function makeInitializedSession(sourceScope = ['public-internet'], query = '采集一篇文章') {
  const root = mkdtempSync(join(tmpdir(), 'public-discovery-test-'));
  ensureSessionSkeleton(root);
  writeFileSync(join(root, 'session.json'), `${JSON.stringify(newSession({
    query,
    sourceScope,
    materializationTarget: 'candidates',
    ...(sourceScope.includes('public-internet') ? {
      discoveryGate: createDiscoveryAuthorization({ query }),
    } : {}),
  }))}\n`);
  return { root, paths: sessionPaths(root) };
}

test('public discovery requires public-internet in the parent source scope', async () => {
  const { paths } = makeInitializedSession(['ima']);
  let called = false;
  await assert.rejects(
    runPublicDiscover(paths, { query: 'q' }, {
      runProcess: async () => { called = true; return { code: 0, stdout: '{}', stderr: '' }; },
    }),
    /sourceScope.*public-internet/,
  );
  assert.equal(called, false);
});

test('default public process runner enforces timeout bounds', async () => {
  assert.equal(typeof publicDiscovery.runBoundedProcess, 'function');
  await assert.rejects(
    publicDiscovery.runBoundedProcess({
      bin: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 100)'],
    }, { timeoutMs: 25 }),
    /timeout after 25ms/,
  );
});

test('public channel runner converts a bound failure into an isolated channel failure', async () => {
  assert.equal(typeof publicDiscovery.runPublicProcess, 'function');
  const outcome = await publicDiscovery.runPublicProcess({
    bin: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 100)'],
  }, { timeoutMs: 25 });
  assert.equal(outcome.code, 1);
  assert.equal(outcome.stdout, '');
  assert.match(outcome.stderr, /timeout after 25ms/);
});

test('runs online search and hot discovery for every online-search category', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];

  const result = await runPublicDiscover(paths, {
    query: 'DeepSeek Harness',
    category: 'images',
    language: 'zh-CN',
    'time-range': 'week',
  }, {
    runProcess: async (spec, options) => {
      calls.push({ spec, options });
      return spec.channel === 'searxng'
        ? { code: 0, stdout: JSON.stringify({ query: 'DeepSeek Harness', results: [] }), stderr: '' }
        : {
          code: 0,
          stdout: JSON.stringify({
            query: 'DeepSeek Harness',
            candidates: [],
            dimensions: ['images'],
            effectiveDimensions: ['images', 'general'],
          }),
          stderr: '',
        };
    },
    merge: ({ hotDoc, sxDoc }) => ({ query: sxDoc.query, effectiveDimensions: hotDoc.effectiveDimensions }),
  });

  assert.deepEqual(calls.map(({ spec }) => spec.channel).sort(), ['hot-discovery', 'searxng']);
  assert.deepEqual(calls.find(({ spec }) => spec.channel === 'hot-discovery').spec.args.slice(-2), ['--dimensions', 'images']);
  assert.deepEqual(
    calls.find(({ spec }) => spec.channel === 'hot-discovery').options,
    { timeoutMs: 60_000 },
  );
  const searxngCall = calls.find(({ spec }) => spec.channel === 'searxng');
  assert.ok(searxngCall.spec.args.includes('--time-range'));
  assert.ok(searxngCall.spec.args.includes('week'));
  assert.equal(searxngCall.spec.args[searxngCall.spec.args.indexOf('--timeout') + 1], '10');
  assert.ok(searxngCall.options.timeoutMs > 0 && searxngCall.options.timeoutMs <= 60_000);
  assert.equal(result.ok, true);
  assert.deepEqual(result.hotDiscovery.effectiveDimensions, ['images', 'general']);
  assert.equal(existsSync(result.snapshots.searxng), true);
  assert.equal(existsSync(result.snapshots.hotDiscovery), true);
  assert.equal(existsSync(result.snapshots.merged), true);
  const snapshot = JSON.parse(readFileSync(result.snapshots.merged, 'utf8'));
  assert.equal(snapshot.query, 'DeepSeek Harness');
  assert.deepEqual(snapshot.effectiveDimensions, ['images', 'general']);
  assert.equal(snapshot.channelDiagnostics.searxng.status, 'success');
  assert.equal(snapshot.channelDiagnostics.hotDiscovery.status, 'success');
  assert.ok(Number.isInteger(snapshot.timing.totalMs));
  assert.deepEqual(snapshot.candidateQuality.merged, {
    article: 0,
    weak: 0,
    reject: 0,
    eligibleArticle: 0,
    topicRelevance: { matched: 0, unmatched: 0, unknown: 0, notRequired: 0 },
  });
});

test('default merge preserves the source hostname used for acquisition', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: '浩鲸科技' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? {
        code: 0,
        stdout: JSON.stringify({
          query: '浩鲸科技',
          results: [
            { url: 'https://www.iwhalecloud.com/', title: '浩鲸科技', engine: 'baidu' },
            { url: 'https://iwhalecloud.com/', title: '浩鲸科技', engine: 'bing' },
          ],
        }),
        stderr: '',
      }
      : {
        code: 0,
        stdout: JSON.stringify({ query: '浩鲸科技', candidates: [] }),
        stderr: '',
      },
  });

  const candidate = result.merged.groups.searxngTop[0];
  assert.equal(candidate.url, 'https://www.iwhalecloud.com/');
  assert.deepEqual(candidate.sourceUrls, [
    'https://www.iwhalecloud.com/',
    'https://iwhalecloud.com/',
  ]);
});

test('returns merged user action without discarding successful SearXNG discovery', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: 'agent' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? {
        code: 0,
        stdout: JSON.stringify({
          query: 'agent',
          results: [{ url: 'https://example.com/a', title: 'A', engine: 'google' }],
        }),
        stderr: '',
      }
      : {
        code: 0,
        stdout: JSON.stringify({
          query: 'agent',
          candidates: [],
          warnings: ['byCLI 浏览器桥接不可用；已停止浏览器适配器并等待人工恢复。'],
          requiresUserAction: {
            kind: 'bridge_unavailable',
            message: 'bridge unavailable',
          },
        }),
        stderr: '',
      },
  });

  const expectedAction = {
    kind: 'bridge_unavailable',
    message: 'bridge unavailable',
    fallbackPolicy: {
      allowDirectHttp: false,
      allowGenericBrowser: false,
      nextAction: 'stop-and-report',
    },
  };
  assert.deepEqual(result.requiresUserAction, expectedAction);
  assert.deepEqual(result.merged.requiresUserAction, expectedAction);
  assert.equal(result.merged.groups.searxngTop.length, 1);
  assert.match(result.merged.warnings.join('\n'), /禁止使用.*HTTP.*通用浏览器.*降级/);
  const mergedSnapshot = JSON.parse(readFileSync(result.snapshots.merged, 'utf8'));
  assert.deepEqual(
    mergedSnapshot.requiresUserAction,
    expectedAction,
  );
  assert.match(mergedSnapshot.warnings.join('\n'), /禁止使用.*HTTP.*通用浏览器.*降级/);
});

test('uses only SearXNG when a requested article count is satisfied', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: 'DeepSeek',
    'requested-count': '1',
    'max-results': '20',
  }, {
    runProcess: async (spec, options) => {
      calls.push({ spec, options });
      return {
        code: 0,
        stdout: JSON.stringify({
          query: 'DeepSeek',
          results: [{
            url: 'https://example.com/news/deepseek-report',
            title: 'DeepSeek 深度报道',
            engine: 'google',
          }],
        }),
        stderr: '',
      };
    },
    merge: ({ hotDoc, sxDoc }) => ({ query: sxDoc.query, hotDoc }),
  });

  assert.deepEqual(calls.map(({ spec }) => spec.channel), ['searxng']);
  const searxngCall = calls[0];
  assert.equal(searxngCall.spec.args[searxngCall.spec.args.indexOf('--max-results') + 1], '1');
  assert.equal(searxngCall.spec.args[searxngCall.spec.args.indexOf('--timeout') + 1], '10');
  assert.deepEqual(searxngCall.options, { timeoutMs: 60_000 });
  assert.equal(result.hotDiscovery, null);
  assert.equal(result.snapshots.hotDiscovery, null);
  assert.equal(result.channels.hotDiscovery.status, 'skipped');
  assert.equal(result.channels.hotDiscovery.skipReason, 'sufficient_article_candidates');
  assert.equal(result.candidateQuality.searxng.article, 1);
  assert.equal(result.candidateQuality.searxng.eligibleArticle, 1);
  assert.ok(!result.warnings.some((warning) => warning.includes('hot-discovery')));
  assert.equal(
    JSON.parse(readFileSync(result.snapshots.merged, 'utf8')).channelDiagnostics.hotDiscovery.skipReason,
    'sufficient_article_candidates',
  );
});

test('Chinese article profile starts SearXNG and bounded hot discovery concurrently', async () => {
  const { paths } = makeInitializedSession(
    ['public-internet'],
    '采集一篇关于米哈游的文章',
  );
  const calls = [];
  const releases = [];
  let initialWaveReleased = false;
  const outcome = (spec) => spec.channel === 'searxng'
    ? { code: 0, stdout: JSON.stringify({ query: '米哈游 报道', results: [] }), stderr: '' }
    : { code: 0, stdout: JSON.stringify({
      query: '米哈游 报道', candidates: [], adapterStats: {},
      dimensions: ['general', 'news', 'blogs'], effectiveDimensions: ['general', 'news', 'blogs'],
    }), stderr: '' };
  const promise = runPublicDiscover(paths, {
    query: '米哈游 报道', category: 'general', language: 'zh-CN', 'requested-count': '1',
  }, {
    runProcess: (spec, options) => new Promise((resolve) => {
      calls.push({ spec, options });
      if (initialWaveReleased) resolve(outcome(spec));
      else releases.push(() => resolve(outcome(spec)));
    }),
    merge: ({ sxDoc }) => ({
      query: sxDoc.query,
      groups: {
        bothChannels: [], searxngTop: [], agentReachTop: [], hotBySource: {},
        hotWithoutPopularity: [], unverified: [],
      },
    }),
  });
  for (let index = 0; index < 10 && calls.length < 2; index += 1) await Promise.resolve();
  assert.deepEqual(calls.map(({ spec }) => spec.channel).sort(), ['hot-discovery', 'searxng']);
  const hot = calls.find(({ spec }) => spec.channel === 'hot-discovery');
  const arg = (name) => hot.spec.args[hot.spec.args.indexOf(name) + 1];
  assert.equal(arg('--sources'), '36kr,weixin,sogou');
  assert.equal(arg('--adapter-timeout-ms'), '10000');
  assert.equal(arg('--minimum-attempts'), '3');
  assert.ok(Number(arg('--total-budget-ms')) > 0 && Number(arg('--total-budget-ms')) <= 60_000);
  assert.equal(arg('--dimensions'), 'general,news,blogs');
  assert.ok(calls.every(({ options }) => options.timeoutMs <= 90_000));
  initialWaveReleased = true;
  for (const release of releases) release();
  const result = await promise;
  assert.equal(result.discoveryProfile.name, 'chinese-article');
  assert.deepEqual(result.discoveryProfile.budget, { softMs: 60_000, hardMs: 90_000 });
});

test('an unrelated trusted publication does not satisfy requested count or receive authorization', async () => {
  const { paths } = makeInitializedSession(
    ['public-internet'],
    '采集一篇关于 kc-no-source-20260901-xqvzt 的文章',
  );
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: 'kc-no-source-20260901-xqvzt article',
    'requested-count': '1',
  }, {
    runProcess: async (spec) => {
      calls.push(spec.channel);
      return spec.channel === 'searxng'
        ? {
          code: 0,
          stdout: JSON.stringify({
            query: 'kc-no-source-20260901-xqvzt article',
            results: [{
              url: 'https://arxiv.org/abs/2103.05770v1',
              title: 'Notebook articles: towards a transformative publishing experience',
            }],
          }),
          stderr: '',
        }
        : { code: 0, stdout: JSON.stringify({ query: 'kc-no-source-20260901-xqvzt', candidates: [] }), stderr: '' };
    },
    merge: ({ sxDoc }) => ({
      query: sxDoc.query,
      groups: {
        bothChannels: [],
        searxngTop: sxDoc.results,
        agentReachTop: [],
        hotBySource: {},
        hotWithoutPopularity: [],
        unverified: [],
      },
    }),
  });

  assert.equal(calls.filter((channel) => channel === 'searxng').length, 1);
  assert.ok(calls.filter((channel) => channel === 'hot-discovery').length >= 1);
  assert.equal(result.candidateQuality.searxng.article, 1);
  assert.equal(result.candidateQuality.searxng.eligibleArticle, 0);
  assert.equal(result.candidateQuality.searxng.topicRelevance.unmatched, 1);
  assert.equal(result.discoveryAuthorization.articleCandidateIds.length, 0);
  assert.equal(result.discoveryAuthorization.structuralArticleCandidateIds.length, 1);
});

test('query drift fails before reserving or invoking discovery executors', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '采集一篇关于 DeepSeek 的文章');
  let executorCalls = 0;
  await assert.rejects(
    runPublicDiscover(paths, { query: 'Qwen paper' }, {
      runProcess: async () => {
        executorCalls += 1;
        return { code: 0, stdout: '{}', stderr: '' };
      },
    }),
    /DISCOVERY_QUERY_DRIFT/,
  );
  assert.equal(executorCalls, 0);
  const session = JSON.parse(readFileSync(paths.session, 'utf8'));
  assert.equal(session.task.discoveryGate.attemptCount, 0);
});

test('a public legacy session with a missing gate is not silently upgraded', async () => {
  const { paths } = makeInitializedSession();
  const session = JSON.parse(readFileSync(paths.session, 'utf8'));
  delete session.task.discoveryGate;
  writeFileSync(paths.session, `${JSON.stringify(session, null, 2)}\n`);
  let executorCalls = 0;
  await assert.rejects(
    runPublicDiscover(paths, { query: 'article' }, {
      runProcess: async () => {
        executorCalls += 1;
        return { code: 0, stdout: '{}', stderr: '' };
      },
    }),
    /DISCOVERY_RELEVANCE_MIGRATION_REQUIRED/,
  );
  assert.equal(executorCalls, 0);
  assert.equal(JSON.parse(readFileSync(paths.session, 'utf8')).task.discoveryGate, undefined);
});

test('requested count merges duplicate SearXNG evidence before deciding hot fallback', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'neural scaling');
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: 'neural scaling',
    'requested-count': '1',
  }, {
    runProcess: async (spec) => {
      calls.push(spec.channel);
      return {
        code: 0,
        stdout: JSON.stringify({
          query: 'neural scaling',
          results: [
            { url: 'https://example.com/news/report', title: 'Neural report', content: '记者报道' },
            { url: 'https://example.com/news/report', title: 'Scaling analysis', content: '记者报道' },
          ],
        }),
        stderr: '',
      };
    },
    merge: ({ sxDoc }) => ({
      query: sxDoc.query,
      groups: {
        bothChannels: [],
        searxngTop: sxDoc.results,
        agentReachTop: [],
        hotBySource: {},
        hotWithoutPopularity: [],
        unverified: [],
      },
    }),
  });

  assert.deepEqual(calls, ['searxng']);
  assert.equal(result.channels.hotDiscovery.skipReason, 'sufficient_article_candidates');
});

test('falls back when non-empty SearXNG results are login and home pages', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: '米哈游',
    'requested-count': '1',
  }, {
    runProcess: async (spec) => {
      calls.push(spec.channel);
      return spec.channel === 'searxng'
        ? {
          code: 0,
          stdout: JSON.stringify({
            query: '米哈游',
            results: [
              { url: 'https://user.mihoyo.com/login', title: '米哈游通行证登录', engine: 'baidu' },
              { url: 'https://www.mihoyo.com/', title: '米哈游', engine: 'bing' },
            ],
          }),
          stderr: '',
        }
        : {
          code: 0,
          stdout: JSON.stringify({ query: '米哈游', candidates: [] }),
          stderr: '',
        };
    },
    merge: ({ sxDoc }) => ({
      query: sxDoc.query,
      groups: {
        bothChannels: [],
        searxngTop: sxDoc.results,
        agentReachTop: [],
        hotBySource: {},
        hotWithoutPopularity: [],
        unverified: [],
      },
    }),
  });

  assert.deepEqual(calls, ['searxng', 'hot-discovery']);
  assert.equal(result.candidateQuality.searxng.article, 0);
  assert.equal(result.candidateQuality.searxng.weak, 1);
  assert.equal(result.candidateQuality.searxng.reject, 1);
});

test('falls back when unique article count is below requested count', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  await runPublicDiscover(paths, {
    query: '米哈游 报道',
    'requested-count': '2',
  }, {
    runProcess: async (spec) => {
      calls.push(spec.channel);
      return spec.channel === 'searxng'
        ? {
          code: 0,
          stdout: JSON.stringify({
            query: '米哈游 报道',
            results: [
              { url: 'https://example.com/news/mihoyo', title: '米哈游深度报道', engine: 'baidu' },
              { url: 'https://www.mihoyo.com/', title: '米哈游', engine: 'bing' },
            ],
          }),
          stderr: '',
        }
        : { code: 0, stdout: JSON.stringify({ query: '米哈游 报道', candidates: [] }), stderr: '' };
    },
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  });

  assert.deepEqual(calls, ['searxng', 'hot-discovery']);
});

test('records deterministic discovery phase timings', async () => {
  const { paths } = makeInitializedSession();
  const ticks = [0, 0, 20, 20, 30, 35];
  const result = await runPublicDiscover(paths, {
    query: '米哈游 报道',
    'requested-count': '1',
  }, {
    now: () => ticks.shift(),
    runProcess: async () => ({
      code: 0,
      stdout: JSON.stringify({
        query: '米哈游 报道',
        results: [{ url: 'https://example.com/news/mihoyo', title: '米哈游深度报道' }],
      }),
      stderr: '',
    }),
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  });

  assert.deepEqual(result.timing, {
    searxngMs: 20,
    onlineSearchMs: 20,
    hotDiscoveryMs: 0,
    mergeAndClassifyMs: 10,
    totalMs: 35,
  });
  assert.equal(result.channels.searxng.durationMs, 20);
  assert.equal(result.channels.hotDiscovery.durationMs, 0);
});

test('falls back to hot discovery when requested SearXNG result set is empty', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: '浩鲸科技',
    'requested-count': '1',
    'max-results': '20',
    timeout: '0.025',
  }, {
    runProcess: async (spec, options) => {
      calls.push({ spec, options });
      return spec.channel === 'searxng'
        ? { code: 0, stdout: JSON.stringify({ query: '浩鲸科技', results: [] }), stderr: '' }
        : {
          code: 0,
          stdout: JSON.stringify({
            query: '浩鲸科技',
            candidates: [],
            dimensions: ['general'],
            effectiveDimensions: ['general'],
          }),
          stderr: '',
        };
    },
    merge: ({ hotDoc, sxDoc }) => ({ query: sxDoc.query, usedHotDiscovery: Boolean(hotDoc) }),
  });

  assert.deepEqual(calls.map(({ spec }) => spec.channel), ['searxng', 'hot-discovery']);
  const hotDiscoveryCall = calls[1];
  assert.equal(
    hotDiscoveryCall.spec.args[hotDiscoveryCall.spec.args.indexOf('--limit') + 1],
    '1',
  );
  assert.deepEqual(calls.map(({ options }) => options), [
    { timeoutMs: 25 },
    { timeoutMs: 25 },
  ]);
  assert.equal(result.merged.usedHotDiscovery, true);
  assert.equal(result.channels.hotDiscovery.status, 'success');
  assert.equal(result.channels.hotDiscovery.exitCode, 0);
  assert.ok(Number.isInteger(result.channels.hotDiscovery.durationMs));
  assert.equal(existsSync(result.snapshots.hotDiscovery), true);
});

test('persists two empty discovery attempts and rejects a third attempt before executors run', async () => {
  const { paths } = makeInitializedSession();
  let executorCalls = 0;
  const options = {
    runProcess: async (spec) => {
      executorCalls += 1;
      return spec.channel === 'searxng'
        ? { code: 0, stdout: JSON.stringify({ query: 'DeepSeek', results: [] }), stderr: '' }
        : { code: 0, stdout: JSON.stringify({ query: 'DeepSeek', candidates: [] }), stderr: '' };
    },
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  };

  await runPublicDiscover(paths, { query: 'DeepSeek', 'requested-count': '1' }, options);
  await runPublicDiscover(paths, {
    query: 'DeepSeek-R1 paper', category: 'science', 'requested-count': '1',
  }, options);

  const session = JSON.parse(readFileSync(paths.session, 'utf8'));
  assert.equal(session.task.discoveryGate.attemptCount, 2);
  assert.equal(session.task.discoveryGate.exhausted, true);
  assert.equal(session.task.discoveryGate.stopReason, 'no-article-candidates');
  assert.equal(session.task.discoveryGate.stopDetail, 'no-relevant-article-candidates');
  const callsBeforeRejectedAttempt = executorCalls;
  await assert.rejects(
    runPublicDiscover(paths, { query: '2501.12948', category: 'science' }, options),
    /DISCOVERY_ATTEMPTS_EXHAUSTED/,
  );
  assert.equal(executorCalls, callsBeforeRejectedAttempt);
});

test('applies a custom outer timeout to both public discovery channels', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  await runPublicDiscover(paths, {
    query: 'timeout bounds',
    timeout: '0.025',
  }, {
    runProcess: async (spec, options) => {
      calls.push({ spec, options });
      return spec.channel === 'searxng'
        ? { code: 0, stdout: JSON.stringify({ query: 'timeout bounds', results: [] }), stderr: '' }
        : {
          code: 0,
          stdout: JSON.stringify({ query: 'timeout bounds', candidates: [] }),
          stderr: '',
        };
    },
    merge: ({ sxDoc }) => ({ query: sxDoc.query }),
  });

  assert.deepEqual(calls.map(({ options }) => options), [
    { timeoutMs: 25 },
    { timeoutMs: 25 },
  ]);
});

test('falls back to hot discovery when requested SearXNG output is invalid', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: '浩鲸科技',
    'requested-count': '1',
  }, {
    runProcess: async (spec) => {
      calls.push(spec);
      return spec.channel === 'searxng'
        ? { code: 1, stdout: '', stderr: 'invalid response' }
        : {
          code: 0,
          stdout: JSON.stringify({
            query: '浩鲸科技',
            candidates: [],
            dimensions: ['general'],
            effectiveDimensions: ['general'],
          }),
          stderr: '',
        };
    },
    merge: ({ hotDoc, sxDoc, warnings }) => ({
      query: hotDoc.query,
      hasSearxng: Boolean(sxDoc),
      warnings,
    }),
  });

  assert.deepEqual(calls.map((spec) => spec.channel), ['searxng', 'hot-discovery']);
  assert.equal(result.merged.hasSearxng, false);
  assert.equal(result.channels.searxng.status, 'failed');
  assert.equal(result.channels.searxng.exitCode, 1);
  assert.equal(result.channels.searxng.timedOut, false);
  assert.equal(result.channels.searxng.stderr, 'invalid response');
  assert.ok(Number.isInteger(result.channels.searxng.durationMs));
  assert.equal(result.channels.hotDiscovery.status, 'success');
  assert.equal(result.channels.hotDiscovery.exitCode, 0);
  assert.ok(Number.isInteger(result.channels.hotDiscovery.durationMs));
  assert.match(result.warnings.join('\n'), /SearXNG 发现失败/);
});

test('keeps SearXNG output when hot discovery fails', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: 'q' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? { code: 0, stdout: JSON.stringify({ query: 'q', results: [] }), stderr: '' }
      : { code: 75, stdout: '', stderr: 'RATE_LIMITED' },
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.channels.searxng.status, 'success');
  assert.equal(result.channels.hotDiscovery.status, 'failed');
  assert.equal(result.channels.hotDiscovery.exitCode, 75);
  assert.equal(result.channels.hotDiscovery.timedOut, false);
  assert.equal(result.channels.hotDiscovery.stderr, 'RATE_LIMITED');
  assert.ok(result.warnings.some((warning) => warning.includes('hot-discovery')));
  assert.equal(existsSync(result.snapshots.searxng), true);
  assert.equal(result.snapshots.hotDiscovery, null);
  assert.equal(existsSync(result.snapshots.merged), true);
  const snapshotDiagnostics = JSON.parse(readFileSync(result.snapshots.merged, 'utf8')).channelDiagnostics;
  assert.equal(snapshotDiagnostics.searxng.status, 'success');
  assert.ok(Number.isInteger(snapshotDiagnostics.searxng.durationMs));
  assert.equal(snapshotDiagnostics.hotDiscovery.status, 'failed');
  assert.equal(snapshotDiagnostics.hotDiscovery.exitCode, 75);
  assert.ok(Number.isInteger(snapshotDiagnostics.hotDiscovery.durationMs));
  assert.equal(snapshotDiagnostics.hotDiscovery.timedOut, false);
  assert.equal(snapshotDiagnostics.hotDiscovery.stderr, 'RATE_LIMITED');
});

test('records outer timeout diagnostics with bounded and redacted stderr', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: 'q' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? { code: 0, stdout: JSON.stringify({ query: 'q', results: [] }), stderr: '' }
      : {
        code: 1,
        stdout: '',
        stderr: `CLI timeout after 30000ms authorization: Bearer ${'x'.repeat(3000)}`,
        timedOut: true,
      },
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  });

  const diagnostic = result.channels.hotDiscovery;
  assert.equal(diagnostic.timedOut, true);
  assert.match(diagnostic.stderr, /CLI timeout after 30000ms authorization: \[REDACTED\]/i);
  assert.ok(diagnostic.stderr.length <= 2_000);
  assert.doesNotMatch(diagnostic.stderr, /x{20}/);
});

test('fails public discovery only when both channels fail', async () => {
  const { paths } = makeInitializedSession();

  await assert.rejects(
    runPublicDiscover(paths, { query: 'q' }, {
      runProcess: async () => ({ code: 1, stdout: '', stderr: 'failed' }),
    }),
    /SearXNG 与 hot-discovery 均未返回有效结果/,
  );
});
