import test from 'node:test';
import assert from 'node:assert/strict';
import { planSourceWaves, sourcePlanIdentity, selectFeedbackQuery } from './source-plan.mjs';
const input = { query: 'agents', sources: ['a', 'b', 'c', 'd', 'e'], constraints: { tiers: '1,2', category: 'it' } };
const infer = (choice = 'p1', confidence = 0.95) => async () => ({ ok: true, document: { answers: { plan: { type: 'choice', choice, confidence } } } });
test('bounded source choice is a complete permutation split into at most three per wave', async () => {
  const plan = await planSourceWaves(input, { environment: {}, callJev: infer() });
  assert.equal(plan.diagnostic.status, 'used');
  assert.deepEqual(plan.waves.flat(), ['b', 'c', 'd', 'e', 'a']);
  assert.ok(plan.waves.every((wave) => wave.length <= 3));
  assert.equal(plan.identity, sourcePlanIdentity(input));
  assert.notEqual(plan.identity, sourcePlanIdentity({ ...input, constraints: { tiers: '1' } }));
});
test('declaration metadata offers nonadjacent matching sources in the first wave without changing rotations', async () => {
  const candidate = { query: 'framework', effectiveCategory: 'it', sources: ['a', 'b', 'c', 'd', 'e'] };
  const metadata = [
    { site: 'a', tier: 2, dimensions: ['general'] },
    { site: 'b', tier: 1, dimensions: ['it'] },
    { site: 'c', tier: 2, dimensions: ['general'] },
    { site: 'd', tier: 1, dimensions: ['it'] },
    { site: 'e', tier: 2, dimensions: ['general'] },
  ];
  const plan = await planSourceWaves(candidate, { environment: {}, sourceMetadata: metadata,
    callJev: async (payload) => {
      assert.deepEqual(payload.state.sourceHints.map((row) => row.site), candidate.sources);
      assert.deepEqual(payload.state.sourceHints[1], { site: 'b', tier: 1, dimensions: ['it'] });
      assert.equal(payload.questions.plan.criteria.p0, 'a, b, c, d, e');
      assert.equal(payload.questions.plan.criteria.p1, 'b, c, d, e, a');
      assert.equal(payload.questions.plan.criteria.p5, 'b, d, a, c, e');
      return { ok: true, document: { answers: { plan: { type: 'choice', choice: 'p5', confidence: 0.95 } } } };
    } });
  assert.deepEqual(plan.waves, [['b', 'd', 'a'], ['c', 'e']]);
  assert.equal(plan.identity, sourcePlanIdentity(candidate));
  const noMetadata = await planSourceWaves(candidate, { environment: {}, sourceMetadata: [{ site: 'unknown', tier: 1 }],
    callJev: async (payload) => {
      assert.deepEqual(Object.keys(payload.questions.plan.criteria), ['p0', 'p1', 'p2', 'p3', 'p4']);
      return { ok: true, document: { answers: { plan: { type: 'choice', choice: 'p0', confidence: 0.95 } } } };
    } });
  assert.deepEqual(noMetadata.waves.flat(), candidate.sources);
});
test('invalid or uncertain source decisions restore no-plan legacy and exhaustive bypass makes zero calls', async () => {
  for (const callJev of [infer('unknown'), infer('p1', 0.3), async () => { throw Error('offline'); }]) {
    assert.equal((await planSourceWaves(input, { environment: {}, callJev })).waves, null);
  }
  let calls = 0;
  const result = await planSourceWaves({ ...input, exhaustive: true }, { callJev: () => { calls++; } });
  assert.equal(result.waves, null);
  assert.equal(calls, 0);
});
test('exhausted inference budget leaves the complete legacy discovery path available', async () => {
  let calls = 0;
  const result = await planSourceWaves(input, { environment: {}, remainingBudgetMs: () => 0,
    callJev: async () => { calls++; return infer()(); } });
  assert.equal(result.waves, null);
  assert.equal(calls, 0);
});
test('feedback query picks a supplied subject-preserving template; failure returns exact fallback', async () => {
  const request = { query: 'agents', fallbackQuery: 'agents architecture', subject: 'agents', feedback: [{ reason: 'ABSTRACT_ONLY' }] };
  const result = await selectFeedbackQuery(request, { environment: {}, callJev: async (payload) => {
    assert.ok(Object.values(payload.questions.query.criteria).every((query) => query.includes('agents')));
    return { ok: true, document: { answers: { query: { type: 'choice', choice: 'q1', confidence: 0.95 } } } };
  } });
  assert.equal(result.query, 'agents architecture full text');
  const failed = await selectFeedbackQuery(request, { environment: {}, callJev: infer() });
  assert.equal(failed.query, request.fallbackQuery);
});

test('feedback query recognizes the normalized contract subject without changing original spelling', async () => {
  const result = await selectFeedbackQuery({ query: 'DeepSeek Harness', fallbackQuery: 'DeepSeek Harness 工程实践',
    subject: 'deepseek harness', feedback: [{ reason: 'ABSTRACT_ONLY' }] }, { environment: {},
    callJev: async () => ({ ok: true, document: { answers: { query: { type: 'choice', choice: 'q1', confidence: 0.95 } } } }) });
  assert.equal(result.query, 'DeepSeek Harness 工程实践 全文');
});
