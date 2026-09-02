import assert from 'node:assert/strict';
import test from 'node:test';

import { runOnlineSearch } from './provider.mjs';

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
