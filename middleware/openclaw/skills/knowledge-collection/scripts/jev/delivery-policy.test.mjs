import assert from 'node:assert/strict';
import test from 'node:test';
import { rankCandidates } from './candidate-ranker.mjs';
import { planDiscovery } from './query-planner.mjs';
import { callTypeSafeJev } from './typesafe.mjs';
import { collectionFeedback, possibleDuplicates } from './delivery-policy.mjs';

const row = (id, overrides = {}) => ({ id, title: `Independent article ${id}`, url: `https://${id}.example/article`,
  discoveryDisposition: 'probe', originalRank: 1, ...overrides });
const answersFor = (payload) => Object.fromEntries(Object.keys(payload.questions).map((key) => [key, { type: 'noul', noul: 0.9 }]));

test('singleton ranking does not call inference', async () => {
  const candidates = [row('only')];
  let called = false;
  const result = await rankCandidates('agents', candidates, { callJev: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(result.candidates, candidates);
});

test('incremental evidence shares ranking request and invalid novelty restores exact input', async () => {
  const candidates = [row('repeat'), row('counterexample')];
  let calls = 0;
  const options = { environment: {}, optimizeDelivery: true, collectedCandidates: [row('already')],
    evidenceContext: { missingSubtopics: ['failure modes'] }, callJev: async (payload) => {
      calls++;
      assert.ok(payload.state.evidenceContext);
      const answers = answersFor(payload);
      answers.v0.noul = 0;
      answers.v1.noul = 1;
      return { ok: true, document: { answers } };
    } };
  const result = await rankCandidates('agents', candidates, options);
  assert.equal(calls, 1);
  assert.equal(result.candidates[0].id, 'counterexample');
  const failed = await rankCandidates('agents', candidates, { ...options, callJev: async (payload) => {
    const answers = answersFor(payload); delete answers.v1;
    return { ok: true, document: { answers } };
  } });
  assert.equal(failed.candidates, candidates);
});

test('delivery ranking favors accessible full text over a relevant abstract in one request', async () => {
  let calls = 0;
  const result = await rankCandidates('agents', [row('abstract'), row('fulltext'), row('blocked', { discoveryDisposition: 'reject' })], {
    optimizeDelivery: true, callJev: async (payload) => {
      calls += 1;
      const answers = answersFor(payload);
      answers.f0.noul = 0.1;
      return { ok: true, document: { answers } };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ['fulltext', 'abstract', 'blocked']);
  assert.equal(result.candidates[0].ranking.version, '2.0');
});

test('similar-title copies are deferred without being dropped', async () => {
  const candidates = [row('original', { title: 'A detailed study of agent memory and retrieval' }),
    row('mirror', { title: 'A detailed study of agent memory and retrieval' }),
    row('different', { title: 'How to deploy a scalable inference service' })];
  assert.deepEqual(possibleDuplicates(candidates), [[0, 1]]);
  const result = await rankCandidates('agents', candidates, { optimizeDelivery: true,
    callJev: async (payload) => ({ ok: true, document: { answers: answersFor(payload) } }) });
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ['original', 'different', 'mirror']);
  assert.equal(result.diagnostic.deferredDuplicates, 1);
});

test('failed slow hosts lose priority, malformed delivery scores restore exact inputs', async () => {
  const candidates = [row('slow'), row('fast')];
  const options = { optimizeDelivery: true,
    feedback: [{ host: 'slow.example', delivered: false, durationMs: 30000, reason: 'ABSTRACT_ONLY' }],
    callJev: async (payload) => ({ ok: true, document: { answers: answersFor(payload) } }) };
  const result = await rankCandidates('agents', candidates, options);
  assert.equal(result.candidates[0].id, 'fast');
  const invalid = await rankCandidates('agents', candidates, { ...options, callJev: async (payload) => {
    const answers = answersFor(payload); delete answers.a1;
    return { ok: true, document: { answers } };
  } });
  assert.equal(invalid.candidates, candidates);
});

test('fixed planning skips inference; uncertain source selection preserves the original scope', async () => {
  const input = { query: 'agents', category: 'general', timeRange: 'week', language: 'all' };
  const fixed = await planDiscovery(input, { callJev: () => { throw new Error('unnecessary inference'); } });
  assert.equal(fixed.jev.status, 'skipped');
  const uncertain = await planDiscovery({ ...input, sourceCandidates: ['automatic', 'github'] }, {
    callJev: async (payload) => {
      assert.deepEqual(Object.keys(payload.questions), ['source']);
      return { ok: true, document: { answers: { source: { type: 'choice', choice: 's1', confidence: 0.6 } } } };
    },
  });
  assert.equal(uncertain.effective.source, 'automatic');
  assert.equal(uncertain.jev.code, 'TYPESAFE_PLANNING_LOW_CONFIDENCE');
});

test('bounded channel planning accepts only a confident supplied channel', async () => {
  const result = await planDiscovery({ query: 'agents', category: 'it', hotSourceCandidates: ['bing', 'weixin'] }, {
    callJev: async () => ({ ok: true, document: { answers: { hotSource: { type: 'choice', choice: 'h1', confidence: 0.95 } } } }),
  });
  assert.equal(result.effective.hotSource, 'weixin');
});

test('feedback contains bounded outcomes, never document contents or URL credentials', () => {
  const result = collectionFeedback({ task: { discoveryGate: { candidates: [
    { candidateId: 'a', canonicalUrl: 'https://user:secret@example.com/article?token=secret' },
  ] } } }, { attempts: [{ candidateId: 'a', startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:01Z', promotionStatus: 'promoted' }] });
  assert.deepEqual(result, [{ host: 'example.com', reason: '', delivered: true, durationMs: 1000 }]);
});

test('explicit disable prevents network access even with credentials configured', async () => {
  const result = await callTypeSafeJev({ state: {}, questions: {} }, {
    environment: { TYPESAFE_ENABLED: 'false', TYPESAFE_API_KEY: 'test' },
    fetchImpl: () => { throw new Error('network must not run'); },
  });
  assert.equal(result.diagnostic.code, 'JEV_DISABLED');
});

test('duplicate comparison crosses scoring batches without dropping later candidates', async () => {
  const title = 'A detailed investigation of persistent agent memory architecture';
  const candidates = Array.from({ length: 41 }, (_, index) => row(`c${index}`, { title: `x${index}` }));
  candidates[0].title = title;
  candidates[40].title = title;
  const comparisons = [];
  const result = await rankCandidates('agents', candidates, { optimizeDelivery: true,
    callJev: async (payload) => {
      comparisons.push(payload.state.duplicateComparisons);
      return { ok: true, document: { answers: answersFor(payload) } };
    } });
  assert.equal(comparisons[0], undefined);
  assert.equal(comparisons[1].d0[0].title, title);
  assert.equal(result.candidates.length, 41);
  assert.equal(result.candidates.at(-1).id, 'c40');
  assert.equal(result.candidates.at(-1).ranking.deferredDuplicate, true);
});

test('a suspected copy of previously materialized public content stays available at the tail', async () => {
  const title = 'A detailed investigation of persistent agent memory architecture';
  const candidates = [row('copy', { title }), row('new', { title: 'novel evidence' })];
  const result = await rankCandidates('agents', candidates, { optimizeDelivery: true,
    collectedCandidates: [{ title, id: 'previous' }],
    callJev: async (payload) => ({ ok: true, document: { answers: answersFor(payload) } }),
  });
  assert.deepEqual(result.candidates.map((item) => item.id), ['new', 'copy']);
  assert.equal(result.candidates[1].ranking.deferredDuplicate, true);
});
