import assert from 'node:assert/strict';
import test from 'node:test';

import { rankCandidates } from './candidate-ranker.mjs';

function candidate(id, overrides = {}) {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Title ${id}`,
    content: `Summary ${id}`,
    discoveryDisposition: 'probe',
    providers: ['searxng'],
    engines: ['bing'],
    originalRank: 5,
    ...overrides,
  };
}

test('ranks eligible candidates with explainable component scores', async () => {
  const candidates = [
    candidate('a', { providers: ['tencent-wsa', 'search1api'], engines: ['wsa', 'google'], originalRank: 2 }),
    candidate('b', { originalRank: 1 }),
    candidate('reject', { discoveryDisposition: 'reject' }),
  ];
  let observed;
  const result = await rankCandidates('agent memory', candidates, {
    callJev: async (payload) => {
      observed = payload;
      return {
        ok: true,
        document: {
          model: 'jev-1',
          answers: {
            r0: { type: 'noul', noul: 0.95 },
            r1: { type: 'noul', noul: 0.2 },
          },
          usage: {},
        },
      };
    },
  });
  assert.equal(Object.keys(observed.questions).length, 2);
  assert.equal(JSON.stringify(observed).includes('reject'), false);
  assert.deepEqual(result.candidates.map((item) => item.id), ['a', 'b', 'reject']);
  assert.deepEqual(result.candidates[0].ranking, {
    version: '1.0', semanticRelevance: 0.95, providerAgreement: 1, originalRankScore: 0.5,
    finalScore: 0.92, judge: 'typesafe',
  });
  assert.equal(result.candidates[2].ranking, undefined);
  assert.equal(result.diagnostic.status, 'used');
});

test('uses batches of no more than forty candidates', async () => {
  const candidates = Array.from({ length: 41 }, (_, index) => candidate(`c${index}`));
  const sizes = [];
  const result = await rankCandidates('agents', candidates, {
    callJev: async (payload) => {
      sizes.push(Object.keys(payload.questions).length);
      return {
        ok: true,
        document: {
          model: 'jev-1', usage: {},
          answers: Object.fromEntries(Object.keys(payload.questions).map((key) => [key, { type: 'noul', noul: 0.5 }])),
        },
      };
    },
  });
  assert.deepEqual(sizes, [40, 1]);
  assert.equal(result.diagnostic.status, 'used');
});

for (const [name, callJev] of [
  ['provider failure', async () => ({ ok: false, diagnostic: { status: 'failed', code: 'TYPESAFE_HTTP_503' } })],
  ['missing score', async () => ({ ok: true, document: { model: 'jev-1', answers: {}, usage: {} } })],
  ['out of range score', async () => ({
    ok: true, document: { model: 'jev-1', answers: { r0: { type: 'noul', noul: 2 } }, usage: {} },
  })],
]) {
  test(`preserves exact candidate order and objects after ${name}`, async () => {
    const candidates = [candidate('a'), candidate('b')];
    const result = await rankCandidates('agents', candidates, { callJev });
    assert.deepEqual(result.candidates, candidates);
    assert.notEqual(result.diagnostic.status, 'used');
  });
}

test('discards partial scores when a later batch fails', async () => {
  const candidates = Array.from({ length: 41 }, (_, index) => candidate(`c${index}`));
  let calls = 0;
  const result = await rankCandidates('agents', candidates, {
    callJev: async (payload) => {
      calls += 1;
      if (calls === 2) return { ok: false, diagnostic: { status: 'failed', code: 'TYPESAFE_HTTP_503' } };
      return { ok: true, document: { model: 'jev-1', usage: {},
        answers: Object.fromEntries(Object.keys(payload.questions).map((key) => [key, { type: 'noul', noul: 0.8 }])) } };
    },
  });
  assert.deepEqual(result.candidates, candidates);
  assert.equal(result.diagnostic.status, 'fallback');
});
