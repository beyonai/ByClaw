import assert from 'node:assert/strict';
import test from 'node:test';

import { runSearch1Api } from './search1api.mjs';

test('does not call Search1API without credentials or when disabled', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; };
  const missing = await runSearch1Api({ query: 'agents' }, { environment: {}, fetchImpl });
  const disabled = await runSearch1Api({ query: 'agents' }, {
    environment: { SEARCH1API_API_KEY: 'secret', SEARCH1API_ENABLED: 'false' }, fetchImpl,
  });
  assert.equal(calls, 0);
  assert.equal(missing.error.code, 'SEARCH1API_KEY_MISSING');
  assert.equal(disabled.error.code, 'SEARCH1API_DISABLED');
});

test('maps search arguments and normalizes Search1API results', async () => {
  let observed;
  const result = await runSearch1Api({
    query: 'agent memory', category: 'it', 'time-range': 'week', 'max-results': '3',
  }, {
    environment: { SEARCH1API_API_KEY: 'secret', SEARCH1API_BASE_URL: 'https://search.example/' },
    fetchImpl: async (url, init) => {
      observed = { url, init };
      return new Response(JSON.stringify({ results: [{
        link: 'https://example.com/a', title: 'A', snippet: 'summary', published_date: '2026-09-20',
      }] }), { status: 200 });
    },
  });
  assert.equal(observed.url, 'https://search.example/search');
  assert.equal(observed.init.headers.Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(observed.init.body), {
    query: 'agent memory', search_service: 'github', time_range: 'week', max_results: 3,
  });
  assert.deepEqual(result.document.results, [{
    url: 'https://example.com/a',
    title: 'A',
    content: 'summary',
    publishedAt: '2026-09-20',
    engine: 'github',
    provider: 'search1api',
    originalRank: 1,
    evidenceLevel: 'search-summary',
  }]);
});

test('accepts a valid empty Search1API result', async () => {
  const result = await runSearch1Api({ query: 'none' }, {
    environment: { SEARCH1API_API_KEY: 'secret' },
    fetchImpl: async () => new Response('{"results":[]}', { status: 200 }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.document.results, []);
});

test('uses an explicit bounded source preference over the category mapping', async () => {
  let body;
  const result = await runSearch1Api({ query: 'papers', category: 'general', source: 'arxiv' }, {
    environment: { SEARCH1API_API_KEY: 'secret' },
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response('{"results":[]}', { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(body.search_service, 'arxiv');
});

for (const [status, category] of [[401, 'authentication'], [402, 'payment'], [429, 'rate-limit'], [500, 'provider']]) {
  test(`sanitizes Search1API HTTP ${status} failures`, async () => {
    const result = await runSearch1Api({ query: 'agents' }, {
      environment: { SEARCH1API_API_KEY: 'secret-value' },
      fetchImpl: async () => new Response('upstream secret-value details', { status }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.category, category);
    assert.equal(JSON.stringify(result).includes('secret-value'), false);
    assert.equal(JSON.stringify(result).includes('upstream'), false);
  });
}

test('rejects malformed Search1API success responses', async () => {
  const result = await runSearch1Api({ query: 'agents' }, {
    environment: { SEARCH1API_API_KEY: 'secret' },
    fetchImpl: async () => new Response('{"results":{}}', { status: 200 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, 'invalid-response');
});
