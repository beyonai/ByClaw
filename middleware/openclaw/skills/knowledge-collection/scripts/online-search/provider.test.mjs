import assert from 'node:assert/strict';
import test from 'node:test';

import { runOnlineSearch } from './provider.mjs';

test('returns WSA results with provider diagnostics', async () => {
  const result = await runOnlineSearch({ query: '人工智能' }, {
    runWsa: async () => ({
      ok: true,
      document: { query: '人工智能', provider: 'tencent-wsa', results: [] },
    }),
    runSearch1Api: async () => ({
      ok: false,
      error: { category: 'unavailable', code: 'SEARCH1API_KEY_MISSING' },
    }),
    now: (() => { let current = 0; return () => current += 5; })(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.document.provider, 'tencent-wsa');
  assert.equal(result.document.fallbackUsed, false);
  assert.equal(result.document.providerDiagnostics.tencentWsa.status, 'success');
  assert.equal(result.document.providerDiagnostics.search1api.code, 'SEARCH1API_KEY_MISSING');
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

test('keeps partial WSA results without a fallback provider', async () => {
  const result = await runOnlineSearch({ query: '人工智能', 'requested-count': '3' }, {
    runWsa: async () => ({
      ok: true,
      document: {
        query: '人工智能',
        results: [{ url: 'https://example.com/news/1234567', title: '一篇报道' }],
      },
    }),
    runSearch1Api: async () => ({
      ok: false,
      error: { category: 'unavailable', code: 'SEARCH1API_KEY_MISSING' },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.document.results.length, 1);
});

test('preserves both provider diagnostics when all online search providers fail', async () => {
  const result = await runOnlineSearch({ query: '人工智能' }, {
    runWsa: async () => ({
      ok: false,
      error: { category: 'timeout', code: 'WSA_TIMEOUT', retryable: true, message: 'timed out' },
    }),
    runSearch1Api: async () => ({
      ok: false,
      error: { category: 'unavailable', code: 'SEARCH1API_KEY_MISSING', retryable: false },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.provider, null);
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.error.code, 'ONLINE_SEARCH_FAILED');
  assert.equal(result.providerDiagnostics.tencentWsa.code, 'WSA_TIMEOUT');
  assert.equal(result.providerDiagnostics.search1api.code, 'SEARCH1API_KEY_MISSING');
});

test('uses Search1API when WSA is unavailable', async () => {
  const result = await runOnlineSearch({ query: 'agent memory' }, {
    runWsa: async () => ({ ok: false, error: { category: 'unavailable', code: 'WSA_CREDENTIALS_MISSING' } }),
    runSearch1Api: async () => ({
      ok: true,
      document: { query: 'agent memory', provider: 'search1api', results: [{
        url: 'https://example.com/a', title: 'A', engine: 'google', provider: 'search1api', originalRank: 1,
      }] },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.document.provider, 'search1api');
  assert.deepEqual(result.document.providers, ['search1api']);
  assert.equal(result.document.providerDiagnostics.search1api.status, 'success');
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

test('caps each provider timeout at fifteen seconds', async () => {
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
  assert.deepEqual(observed, [10_000, 10_000]);

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
