import assert from 'node:assert/strict';
import test from 'node:test';

import { runOnlineSearch } from './provider.mjs';

test('provider experiment is opt-in, valid choice skips peer, invalid choice restores both', async () => {
  for (const [enabled, choice, expected] of [[false, 'p1', ['wsa', 'search']], [true, 'p1', ['wsa']], [true, 'invalid', ['wsa', 'search']]]) {
    const calls = [];
    let inference = 0;
    const result = await runOnlineSearch({ query: 'agents' }, {
      environment: { JEV_PROVIDER_SELECTION_ENABLED: String(enabled), TENCENTCLOUD_SECRET_ID: 'fixture',
        TENCENTCLOUD_SECRET_KEY: 'fixture', SEARCH1API_API_KEY: 'fixture' },
      callJev: async () => { inference++; return { ok: true, document: { answers: { provider: { type: 'choice', choice, confidence: 0.95 } } } }; },
      runWsa: async () => { calls.push('wsa'); return { ok: true, document: { results: [] } }; },
      runSearch1Api: async () => { calls.push('search'); return { ok: true, document: { results: [] } }; },
      runSearxng: async () => assert.fail('empty success must not trigger fallback'),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, expected);
    assert.equal(inference, enabled ? 1 : 0);
  }
});

test('chosen provider failure still tries the unattempted commercial peer', async () => {
  const calls = [];
  const result = await runOnlineSearch({ query: 'agents' }, {
    environment: { JEV_PROVIDER_SELECTION_ENABLED: 'true', TENCENTCLOUD_SECRET_ID: 'fixture',
      TENCENTCLOUD_SECRET_KEY: 'fixture', SEARCH1API_API_KEY: 'fixture' },
    callJev: async () => ({ ok: true, document: { answers: { provider: { type: 'choice', choice: 'p1', confidence: 0.95 } } } }),
    runWsa: async () => { calls.push('wsa'); return { ok: false }; },
    runSearch1Api: async () => { calls.push('search'); return { ok: true, document: { results: [] } }; },
  });
  assert.deepEqual(calls, ['wsa', 'search']);
  assert.equal(result.document.provider, 'search1api');
});

test('provider experiment bypasses exhaustive tasks and restores parallel execution after inference failure', async () => {
  for (const coverageRequired of [true, false]) {
    const calls = [];
    let inference = 0;
    const result = await runOnlineSearch({ query: 'agents' }, {
      coverageRequired,
      environment: { JEV_PROVIDER_SELECTION_ENABLED: 'true', TENCENTCLOUD_SECRET_ID: 'fixture',
        TENCENTCLOUD_SECRET_KEY: 'fixture', SEARCH1API_API_KEY: 'fixture' },
      callJev: async () => { inference++; throw Error('unavailable'); },
      runWsa: async () => { calls.push('wsa'); return { ok: true, document: { results: [] } }; },
      runSearch1Api: async () => { calls.push('search'); return { ok: true, document: { results: [] } }; },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['wsa', 'search']);
    assert.equal(inference, coverageRequired ? 0 : 1);
  }
});

test('returns WSA results without calling SearXNG', async () => {
  let searxngCalls = 0;
  const result = await runOnlineSearch({ query: '人工智能' }, {
    runWsa: async () => ({
      ok: true,
      document: { query: '人工智能', provider: 'tencent-wsa', results: [] },
    }),
    runSearxng: async () => { searxngCalls += 1; throw new Error('must not run'); },
    now: (() => { let current = 0; return () => current += 5; })(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.document.provider, 'tencent-wsa');
  assert.equal(result.document.fallbackUsed, false);
  assert.equal(result.document.providerDiagnostics.tencentWsa.status, 'success');
  assert.equal(result.document.providerDiagnostics.searxng.status, 'skipped');
  assert.equal(searxngCalls, 0);
});

test('preserves metadata from a single successful provider', async () => {
  const result = await runOnlineSearch({ query: '人工智能' }, {
    runWsa: async () => ({ ok: true, document: {
      query: '人工智能', requestId: 'request-1', providerVersion: 'v1', warnings: ['partial'], message: 'ok',
      results: [{ url: 'https://example.com/a', title: 'A' }],
    } }),
    runSearch1Api: async () => ({ ok: false, error: { category: 'unavailable', code: 'SEARCH1API_KEY_MISSING' } }),
  });
  assert.equal(result.document.requestId, 'request-1');
  assert.equal(result.document.providerVersion, 'v1');
  assert.deepEqual(result.document.warnings, ['partial']);
  assert.equal(result.document.message, 'ok');
  assert.equal(Object.hasOwn(result.document.results[0], 'sourceUrls'), false);
});

test('does not fall back when WSA returns fewer results than requested', async () => {
  let searxngCalls = 0;
  const result = await runOnlineSearch({ query: '人工智能', 'requested-count': '3' }, {
    runWsa: async () => ({
      ok: true,
      document: {
        query: '人工智能',
        results: [{ url: 'https://example.com/news/1234567', title: '一篇报道' }],
      },
    }),
    runSearxng: async () => { searxngCalls += 1; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.document.results.length, 1);
  assert.equal(searxngCalls, 0);
});

for (const [name, error] of [
  ['disabled', { category: 'unavailable', code: 'WSA_DISABLED', retryable: false, message: 'disabled' }],
  ['authentication failure', { category: 'authentication', code: 'AuthFailure', retryable: false, message: 'auth failed' }],
  ['rate limit', { category: 'rate-limit', code: 'RequestLimitExceeded', retryable: true, message: 'limited' }],
  ['timeout', { category: 'timeout', code: 'WSA_TIMEOUT', retryable: true, message: 'timed out' }],
  ['invalid response', { category: 'invalid-response', code: 'INVALID_WSA_RESPONSE', retryable: false, message: 'bad response' }],
]) {
  test(`falls back to SearXNG after WSA ${name}`, async () => {
    const calls = [];
    const result = await runOnlineSearch({ query: '人工智能' }, {
      runWsa: async () => ({ ok: false, error }),
      runSearxng: async (args) => {
        calls.push(args);
        return { ok: true, document: { query: args.query, results: [] } };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.document.provider, 'searxng');
    assert.equal(result.document.fallbackUsed, true);
    assert.equal(result.document.providerDiagnostics.tencentWsa.code, error.code);
    assert.equal(result.document.providerDiagnostics.searxng.status, 'success');
    assert.deepEqual(calls, [{ query: '人工智能' }]);
  });
}

test('preserves both sanitized diagnostics when WSA and SearXNG fail', async () => {
  const result = await runOnlineSearch({ query: '人工智能' }, {
    runWsa: async () => ({
      ok: false,
      error: { category: 'timeout', code: 'WSA_TIMEOUT', retryable: true, message: 'timed out' },
    }),
    runSearxng: async () => ({
      ok: false,
      error: { category: 'provider', code: 'SEARXNG_FAILED', retryable: true, message: 'failed' },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ONLINE_SEARCH_FAILED');
  assert.equal(result.providerDiagnostics.tencentWsa.code, 'WSA_TIMEOUT');
  assert.equal(result.providerDiagnostics.searxng.code, 'SEARXNG_FAILED');
});

test('does not start SearXNG after the hard budget is exhausted', async () => {
  let searxngCalls = 0;
  const result = await runOnlineSearch({ query: '人工智能' }, {
    runWsa: async () => ({
      ok: false,
      error: { category: 'timeout', code: 'WSA_TIMEOUT', retryable: true, message: 'timed out' },
    }),
    runSearxng: async () => { searxngCalls += 1; },
    timeoutMs: 1,
    now: (() => { const values = [0, 2, 2]; return () => values.shift() ?? 2; })(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.providerDiagnostics.searxng.status, 'skipped');
  assert.equal(result.providerDiagnostics.searxng.skipReason, 'hard_budget_exhausted');
  assert.equal(searxngCalls, 0);
});

test('uses Search1API when WSA is unavailable without invoking SearXNG', async () => {
  let searxngCalls = 0;
  const result = await runOnlineSearch({ query: 'agent memory' }, {
    runWsa: async () => ({ ok: false, error: { category: 'unavailable', code: 'WSA_CREDENTIALS_MISSING' } }),
    runSearch1Api: async () => ({
      ok: true,
      document: { query: 'agent memory', provider: 'search1api', results: [{
        url: 'https://example.com/a', title: 'A', engine: 'google', provider: 'search1api', originalRank: 1,
      }] },
    }),
    runSearxng: async () => { searxngCalls += 1; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.document.provider, 'search1api');
  assert.deepEqual(result.document.providers, ['search1api']);
  assert.equal(result.document.providerDiagnostics.search1api.status, 'success');
  assert.equal(searxngCalls, 0);
});

test('merges concurrent WSA and Search1API results with agreement evidence', async () => {
  let releaseWsa;
  let releaseSearch1;
  const wsaReady = new Promise((resolve) => { releaseWsa = resolve; });
  const search1Ready = new Promise((resolve) => { releaseSearch1 = resolve; });
  const resultPromise = runOnlineSearch({ query: 'agent memory' }, {
    runWsa: async () => { await search1Ready; return {
      ok: true,
      document: { query: 'agent memory', results: [{
        url: 'https://example.com/a?utm_source=x', title: 'A', content: 'short WSA evidence', engine: 'wsa',
      }] },
    }; },
    runSearch1Api: async () => { releaseSearch1(); releaseWsa(); return {
      ok: true,
      document: { query: 'agent memory', results: [
        { url: 'https://example.com/a', title: 'A richer title', content: 'different Search1 evidence',
          engine: 'google', provider: 'search1api', originalRank: 2 },
        { url: 'https://example.com/b', title: 'B', engine: 'github', provider: 'search1api', originalRank: 1 },
      ] },
    }; },
    runSearxng: async () => { throw new Error('must not run'); },
  });
  await wsaReady;
  const result = await resultPromise;
  assert.equal(result.document.provider, 'multi');
  assert.deepEqual(result.document.providers, ['tencent-wsa', 'search1api']);
  assert.equal(result.document.results.length, 2);
  assert.deepEqual(result.document.results[0].providers, ['tencent-wsa', 'search1api']);
  assert.deepEqual(result.document.results[0].engines, ['wsa', 'google']);
  assert.equal(result.document.results[0].providerAgreement, 2);
  assert.deepEqual(result.document.results[0].sourceUrls, [
    'https://example.com/a?utm_source=x',
    'https://example.com/a',
  ]);
  assert.equal(result.document.results[0].content, 'short WSA evidence\ndifferent Search1 evidence');
});

test('reserves fallback time by bounding concurrent commercial providers to half the total budget', async () => {
  const observed = [];
  await runOnlineSearch({ query: 'agent memory' }, {
    timeoutMs: 10_000,
    runWsa: async (_args, options) => {
      observed.push(options.timeoutMs);
      return { ok: true, document: { query: 'agent memory', results: [] } };
    },
    runSearch1Api: async (_args, options) => {
      observed.push(options.timeoutMs);
      return { ok: false, error: { category: 'unavailable', code: 'SEARCH1API_KEY_MISSING' } };
    },
  });
  assert.deepEqual(observed, [5_000, 5_000]);

  observed.length = 0;
  await runOnlineSearch({ query: 'agent memory' }, {
    timeoutMs: 60_000,
    runWsa: async (_args, options) => {
      observed.push(options.timeoutMs);
      return { ok: true, document: { query: 'agent memory', results: [] } };
    },
    runSearch1Api: async (_args, options) => {
      observed.push(options.timeoutMs);
      return { ok: false, error: { category: 'unavailable', code: 'SEARCH1API_KEY_MISSING' } };
    },
  });
  assert.deepEqual(observed, [15_000, 15_000]);
});

test('falls back to SearXNG when WSA and Search1API are both unavailable', async () => {
  const result = await runOnlineSearch({ query: 'agent memory' }, {
    runWsa: async () => ({ ok: false, error: { category: 'unavailable', code: 'WSA_CREDENTIALS_MISSING' } }),
    runSearch1Api: async () => ({ ok: false, error: { category: 'unavailable', code: 'SEARCH1API_KEY_MISSING' } }),
    runSearxng: async () => ({ ok: true, document: { query: 'agent memory', results: [] } }),
  });
  assert.equal(result.document.provider, 'searxng');
  assert.equal(result.document.providerDiagnostics.search1api.code, 'SEARCH1API_KEY_MISSING');
});

test('isolates an unexpected provider exception and uses the other provider', async () => {
  const result = await runOnlineSearch({ query: 'agent memory' }, {
    runWsa: async () => { throw new Error('credential must not escape'); },
    runSearch1Api: async () => ({ ok: true, document: { query: 'agent memory', results: [] } }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.document.provider, 'search1api');
  assert.equal(result.document.providerDiagnostics.tencentWsa.code, 'WSA_UNEXPECTED_ERROR');
  assert.equal(JSON.stringify(result).includes('credential must not escape'), false);
});

test('passes the cancellation signal to Search1API', async () => {
  const controller = new AbortController();
  let observedSignal;
  await runOnlineSearch({ query: 'agent memory' }, {
    signal: controller.signal,
    runWsa: async () => ({ ok: false, error: { category: 'unavailable', code: 'WSA_DISABLED' } }),
    runSearch1Api: async (_args, options) => {
      observedSignal = options.signal;
      return { ok: true, document: { query: 'agent memory', results: [] } };
    },
  });
  assert.equal(observedSignal, controller.signal);
});

test('keeps successful commercial results when supplemental SearXNG fails', async () => {
  const result = await runOnlineSearch({ query: 'agent memory' }, {
    supplementWithSearxng: true,
    runWsa: async () => ({ ok: true, document: { query: 'agent memory', results: [
      { url: 'https://example.com/a', title: 'A' },
    ] } }),
    runSearch1Api: async () => ({ ok: false, error: { category: 'unavailable', code: 'SEARCH1API_KEY_MISSING' } }),
    runSearxng: async () => ({ ok: false, error: { category: 'provider', code: 'SEARXNG_FAILED' } }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.document.provider, 'tencent-wsa');
  assert.equal(result.document.fallbackUsed, false);
  assert.equal(result.document.results.length, 1);
  assert.equal(result.document.providerDiagnostics.searxng.code, 'SEARXNG_FAILED');
});
