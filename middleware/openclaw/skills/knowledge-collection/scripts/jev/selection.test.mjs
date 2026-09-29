import assert from 'node:assert/strict';
import test from 'node:test';
import { prioritizeItems } from './selection.mjs';
import { prioritizeUnifiedCandidates, mergeUnifiedCandidates } from '../unified-candidates.mjs';
import { safeCallJev } from './safe-call.mjs';
import { rankCandidates } from './candidate-ranker.mjs';
import { planDiscovery } from './query-planner.mjs';

const items = [{ title: 'first', text: 'evidence A' }, { title: 'second', text: 'evidence B' }];
export const rankResponse = (payload) => ({ ok: true, document: { model: 'fixture', answers:
  Object.fromEntries(Object.keys(payload.questions).map((key, index) => [key,
    { type: 'choice', choice: index === 0 ? 'low' : 'high', confidence: 0.95 }])) } });

test('selection reorders existing objects without deletion or mutation', async () => {
  const result = await prioritizeItems('test', items, { callJev: async (payload) => rankResponse(payload) });
  assert.deepEqual(result.items, [items[1], items[0]]);
  assert.equal(result.items[0], items[1]);
});

for (const [name, callJev] of [
  ['throw', async () => { throw new Error('secret should never escape'); }],
  ['null', async () => null],
  ['HTTP failure', async () => ({ ok: false, diagnostic: { code: 'TYPESAFE_HTTP_503' } })],
  ['invalid choice', async () => ({ ok: true, document: { answers: { i0: { type: 'choice', choice: 'invented', confidence: 1 } } } })],
  ['low confidence', async (payload) => { const result = rankResponse(payload); result.document.answers.i0.confidence = 0.5; return result; }],
  ['missing answer', async (payload) => { const result = rankResponse(payload); delete result.document.answers.i1; return result; }],
]) {
  test(`selection retains the exact original array on ${name}`, async () => {
    const result = await prioritizeItems('test', items, { callJev });
    assert.equal(result.items, items);
    assert.equal(result.diagnostic.status, 'fallback');
    assert.ok(!JSON.stringify(result).includes('secret'));
  });
}

test('hung and aborted inference returns promptly to legacy selection', async () => {
  const result = await prioritizeItems('test', items, { budgetMs: 10, callJev: () => new Promise(() => {}) });
  assert.equal(result.items, items);
  assert.equal(result.diagnostic.code, 'TYPESAFE_TIMEOUT');
  const controller = new AbortController();
  const aborted = prioritizeItems('test', items, { signal: controller.signal, callJev: () => new Promise(() => {}) });
  controller.abort();
  assert.equal((await aborted).items, items);
});

test('a later failed batch discards every partial score', async () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ title: `${index}` }));
  let calls = 0;
  const result = await prioritizeItems('test', rows, { callJev: async (payload) => {
    calls += 1;
    if (calls === 2) throw new Error('fail');
    return rankResponse(payload);
  } });
  assert.equal(calls, 2);
  assert.equal(result.items, rows);
});

test('private-data gate is checked before inference, including mixed unified candidates', async () => {
  const callJev = () => { throw new Error('must never receive private data'); };
  const result = await prioritizeItems('private request', items, { privateData: true, environment: {}, callJev });
  assert.equal(result.items, items);
  assert.equal(result.diagnostic.code, 'ENTERPRISE_INFERENCE_NOT_ENABLED');
  const unified = [{ ...items[0], source: 'public-internet' }, { ...items[1], source: 'cloud-knowledge' }];
  const blocked = await prioritizeUnifiedCandidates('private request', unified, { environment: {}, callJev });
  assert.equal(blocked.items, unified);
  const enabled = await prioritizeUnifiedCandidates('private request', unified, {
    environment: { TYPESAFE_ENTERPRISE_ENABLED: 'true' }, callJev: async (payload) => rankResponse(payload),
  });
  assert.deepEqual(enabled.items, [unified[1], unified[0]]);
});

test('unconfigured or disabled providers preserve deterministic unified ordering', async () => {
  const baseline = mergeUnifiedCandidates('agents', { publicCandidates: [
    { url: 'https://example.com/a', title: 'Agents A', ranking: { finalScore: 0.8 } },
    { url: 'https://example.com/b', title: 'Agents B' },
  ] });
  assert.equal(baseline[0].ranking.finalScore, 0.8);
  for (const environment of [{}, { TYPESAFE_API_KEY: 'fixture', TYPESAFE_ENABLED: 'false' }]) {
    const ranked = await prioritizeUnifiedCandidates('agents', baseline, { environment,
      fetchImpl: () => { throw new Error('network must not run'); } });
    assert.equal(ranked.items, baseline);
  }
});

test('legacy planner and ranker also fall back on thrown inference', async () => {
  const callJev = async () => { throw new Error('failure'); };
  const input = { query: 'agents', category: 'it', sourceCandidates: ['automatic', 'github'] };
  assert.equal((await planDiscovery(input, { callJev })).effective.source, 'automatic');
  assert.equal((await rankCandidates('agents', items, { callJev })).candidates, items);
  assert.equal((await safeCallJev({}, { callJev })).ok, false);
});
