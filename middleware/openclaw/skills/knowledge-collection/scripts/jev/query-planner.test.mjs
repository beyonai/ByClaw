import assert from 'node:assert/strict';
import test from 'node:test';

import { planDiscovery } from './query-planner.mjs';

const input = Object.freeze({
  request: '最近一周 GitHub 上的 agent memory 项目',
  query: 'agent memory',
  category: 'general',
  language: 'zh-CN',
  timeRange: null,
  queryCandidates: ['agent memory', 'agent long-term memory'],
  categoryCandidates: ['general', 'it'],
  timeRangeCandidates: [null, 'day', 'week', 'month', 'year'],
  sourceCandidates: ['automatic', 'github', 'arxiv'],
});

test('selects only bounded query planning choices returned by Jev', async () => {
  const result = await planDiscovery(input, {
    callJev: async () => ({
      ok: true,
      document: {
        model: 'jev-1',
        answers: {
          query: { type: 'choice', choice: 'q1', confidence: 0.92 },
          category: { type: 'choice', choice: 'c1', confidence: 0.88 },
          timeRange: { type: 'choice', choice: 't2', confidence: 0.95 },
          source: { type: 'choice', choice: 's1', confidence: 0.8 },
        },
        usage: { input_tokens: 20, output_tokens: 4 },
      },
      diagnostic: { status: 'success', model: 'jev-1' },
    }),
  });
  assert.deepEqual(result.effective, {
    query: 'agent long-term memory', category: 'it', language: 'zh-CN', timeRange: 'week', source: 'github',
  });
  assert.equal(result.jev.status, 'used');
  assert.equal(result.jev.model, 'jev-1');
  assert.deepEqual(result.jev.confidence, { query: 0.92, category: 0.88, timeRange: 0.95, source: 0.8 });
});

for (const [name, response] of [
  ['missing token', { ok: false, diagnostic: { status: 'unavailable', code: 'TYPESAFE_API_KEY_MISSING' } }],
  ['disabled Jev', { ok: false, diagnostic: { status: 'disabled', code: 'JEV_DISABLED' } }],
  ['provider failure', { ok: false, diagnostic: { status: 'failed', code: 'TYPESAFE_HTTP_503' } }],
  ['missing answers', { ok: true, document: { model: 'jev-1', answers: {}, usage: {} } }],
  ['unknown choices', {
    ok: true,
    document: {
      model: 'jev-1', usage: {}, answers: {
        query: { type: 'choice', choice: 'q99' },
        category: { type: 'choice', choice: 'c99' },
        timeRange: { type: 'choice', choice: 't99' },
        source: { type: 'choice', choice: 's99' },
      },
    },
  }],
]) {
  test(`keeps the legacy discovery inputs after ${name}`, async () => {
    const result = await planDiscovery(input, { callJev: async () => response });
    assert.deepEqual(result.effective, {
      query: input.query, category: input.category, language: input.language, timeRange: input.timeRange, source: 'automatic',
    });
    assert.notEqual(result.jev.status, 'used');
  });
}
