import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSearchParams,
  normalizeSearchResponse,
  runTencentWsa,
  sanitizeProviderError,
} from './tencent-wsa.mjs';

test('maps supported public-discovery arguments to SearchPro parameters', () => {
  assert.deepEqual(buildSearchParams({
    query: '人工智能',
    category: 'news',
    'time-range': 'week',
    'max-results': '11',
  }, { industry: true, count: true }), {
    Query: '人工智能',
    Mode: 0,
    Industry: 'news',
    Freshness: 'd7',
    Cnt: 20,
  });

  assert.deepEqual(buildSearchParams({
    query: '金融政策',
    category: 'finance',
    'requested-count': '51',
    'time-range': 'year',
  }, { industry: false, count: false }), {
    Query: '金融政策',
    Mode: 0,
    Freshness: 'y1',
  });
});

test('normalizes WSA Pages JSON strings into public discovery candidates', () => {
  const response = normalizeSearchResponse({
    Query: '人工智能',
    Pages: [JSON.stringify({
      title: '人工智能深度报道',
      url: 'https://example.com/news/1234567',
      passage: '标准摘要',
      content: '动态摘要',
      date: '2026/09/01 08:00:00',
      site: '示例站点',
      score: 0.8,
      authority_level: 4,
    })],
    Version: 'flagship',
    RequestId: 'request-1',
  }, '人工智能');

  assert.equal(response.query, '人工智能');
  assert.equal(response.provider, 'tencent-wsa');
  assert.equal(response.requestId, 'request-1');
  assert.equal(response.providerVersion, 'flagship');
  assert.deepEqual(response.results, [{
    url: 'https://example.com/news/1234567',
    title: '人工智能深度报道',
    content: '动态摘要',
    engine: 'tencent-wsa',
    score: 0.8,
    publishedAt: '2026/09/01 08:00:00',
    site: '示例站点',
    authorityLevel: 4,
  }]);
});

test('treats an empty Pages array as a successful empty search', () => {
  const response = normalizeSearchResponse({
    Query: '无结果查询', Pages: [], RequestId: 'request-empty',
  }, '无结果查询');
  assert.deepEqual(response.results, []);
  assert.deepEqual(response.warnings, []);
});

test('keeps valid Pages while warning about malformed or unsafe entries', () => {
  const response = normalizeSearchResponse({
    Pages: [
      '{bad json',
      JSON.stringify({ title: 'Unsafe', url: 'https://user:pass@example.com/article/1234567' }),
      JSON.stringify({ title: 'Safe article', url: 'https://example.com/article/1234567', passage: '摘要正文' }),
    ],
  }, '测试');

  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].content, '摘要正文');
  assert.equal(response.warnings.length, 2);
  assert.match(response.warnings[0], /Pages\[0\]/);
  assert.match(response.warnings[1], /Pages\[1\]/);
});

test('rejects a non-empty Pages array when no entry can be normalized', () => {
  assert.throws(
    () => normalizeSearchResponse({ Pages: ['{bad json'] }, '测试'),
    (error) => error.code === 'INVALID_WSA_RESPONSE',
  );
});

test('sanitizes provider errors without retaining credentials', () => {
  const failure = sanitizeProviderError(Object.assign(
    new Error('Authorization: Bearer secret-token SecretKey=secret-value'),
    { code: 'RequestLimitExceeded', requestId: 'request-limit' },
  ));
  const serialized = JSON.stringify(failure);
  assert.equal(failure.category, 'rate-limit');
  assert.equal(failure.code, 'RequestLimitExceeded');
  assert.equal(failure.requestId, 'request-limit');
  assert.doesNotMatch(serialized, /secret-token|secret-value/);
});

test('calls an injected WSA client and returns a normalized document', async () => {
  const calls = [];
  const result = await runTencentWsa({ query: '人工智能' }, {
    environment: {
      TENCENT_WSA_ENABLED: 'true',
      TENCENTCLOUD_SECRET_ID: 'id-value',
      TENCENTCLOUD_SECRET_KEY: 'key-value',
    },
    client: {
      SearchPro: async (params) => {
        calls.push(params);
        return { Query: params.Query, Pages: [], RequestId: 'request-run' };
      },
    },
    timeoutMs: 100,
  });

  assert.equal(result.ok, true);
  assert.equal(result.document.requestId, 'request-run');
  assert.deepEqual(calls, [{ Query: '人工智能', Mode: 0 }]);
});

test('truncates normalized WSA results to the requested local limit', async () => {
  const pages = [1, 2, 3].map((index) => JSON.stringify({
    title: `结果 ${index}`,
    url: `https://example.com/article/${index}`,
  }));
  const result = await runTencentWsa({ query: '人工智能', 'max-results': '2' }, {
    environment: {
      TENCENTCLOUD_SECRET_ID: 'id-value',
      TENCENTCLOUD_SECRET_KEY: 'key-value',
    },
    client: { SearchPro: async () => ({ Query: '人工智能', Pages: pages }) },
  });

  assert.equal(result.ok, true);
  assert.equal(result.document.results.length, 2);
});

test('enables WSA automatically when both credentials are present', async () => {
  const result = await runTencentWsa({ query: '人工智能' }, {
    environment: {
      TENCENTCLOUD_SECRET_ID: 'id-value',
      TENCENTCLOUD_SECRET_KEY: 'key-value',
    },
    client: { SearchPro: async () => ({ Query: '人工智能', Pages: [] }) },
  });
  assert.equal(result.ok, true);
  assert.equal(result.document.provider, 'tencent-wsa');
});

test('reports disabled and timed out WSA calls as typed failures', async () => {
  const disabled = await runTencentWsa({ query: '人工智能' }, { environment: {} });
  assert.deepEqual(disabled, {
    ok: false,
    error: {
      category: 'unavailable',
      code: 'WSA_DISABLED',
      retryable: false,
      message: 'Tencent WSA is not enabled',
    },
  });

  const timedOut = await runTencentWsa({ query: '人工智能' }, {
    environment: {
      TENCENT_WSA_ENABLED: 'true',
      TENCENTCLOUD_SECRET_ID: 'id-value',
      TENCENTCLOUD_SECRET_KEY: 'key-value',
    },
    client: { SearchPro: async () => new Promise(() => {}) },
    timeoutMs: 10,
  });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error.category, 'timeout');
  assert.equal(timedOut.error.code, 'WSA_TIMEOUT');
});
