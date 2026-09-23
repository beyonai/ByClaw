import assert from 'node:assert/strict';
import test from 'node:test';

import { rankCandidates } from './candidate-ranker.mjs';
import { withJevRun, currentJevRun } from './run-context.mjs';

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

test('bounds untrusted candidate fields before sending them to Jev', async () => {
  let observed;
  const candidates = [candidate('x'.repeat(600), {
    title: 't'.repeat(1_100),
    content: 's'.repeat(4_100),
    providers: Array.from({ length: 12 }, () => 'p'.repeat(110)),
    engines: Array.from({ length: 12 }, () => 'e'.repeat(110)),
  }), candidate('second')];
  await rankCandidates('q'.repeat(2_100), candidates, {
    callJev: async (payload) => {
      observed = payload.state;
      return { ok: true, document: { model: 'jev-1', answers: { r0: { type: 'noul', noul: 0.5 }, r1: { type: 'noul', noul: 0.5 } } } };
    },
  });
  assert.equal(observed.request.length, 2_000);
  assert.equal(observed.candidates.r0.id.length, 500);
  assert.equal(observed.candidates.r0.title.length, 1_000);
  assert.equal(observed.candidates.r0.summary.length, 4_000);
  assert.equal(observed.candidates.r0.providers.length, 10);
  assert.equal(observed.candidates.r0.providers[0].length, 100);
  assert.equal(observed.candidates.r0.engines.length, 10);
});

test('shares a ten-second budget across ranking batches', async () => {
  const candidates = Array.from({ length: 41 }, (_, index) => candidate(`c${index}`));
  let clock = 0;
  let calls = 0;
  const result = await rankCandidates('agents', candidates, {
    now: () => clock,
    callJev: async (payload, options) => {
      calls += 1;
      assert.equal(options.remainingBudgetMs(), 10_000);
      clock = 10_000;
      return { ok: true, document: { model: 'jev-1', answers:
        Object.fromEntries(Object.keys(payload.questions).map((key) => [key, { type: 'noul', noul: 0.5 }])) } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.diagnostic.code, 'TYPESAFE_RANKING_BUDGET_EXHAUSTED');
  assert.deepEqual(result.candidates, candidates);
});

test('combines the ranking deadline with an outer remaining budget', async () => {
  let observedRemaining;
  await rankCandidates('agents', [candidate('a'), candidate('b')], {
    now: () => 100,
    remainingBudgetMs: () => 250,
    callJev: async (payload, options) => {
      observedRemaining = options.remainingBudgetMs();
      return { ok: true, document: { model: 'jev-1', answers:
        Object.fromEntries(Object.keys(payload.questions).map((key) => [key, { type: 'noul', noul: 0.5 }])) } };
    },
  });
  assert.equal(observedRemaining, 250);
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

test('reuses unchanged candidate scores within one run and scores new rows in a batch', async () => {
  const a = candidate('a');
  const b = candidate('b');
  const c = candidate('c');
  const seen = [];
  const options = { environment: {}, callJev: async (payload) => {
    seen.push(Object.keys(payload.questions));
    return { ok: true, document: { model: 'jev-1', answers: Object.fromEntries(
      Object.keys(payload.questions).map((key) => [key, { type: 'noul', noul: key === 'r1' ? 0.9 : 0.6 }])) } };
  } };
  await withJevRun(async () => {
    assert.equal((await rankCandidates('agents', [a, b], options)).diagnostic.status, 'used');
    const result = await rankCandidates('agents', [a, c], options);
    assert.equal(result.diagnostic.status, 'used');
    assert.equal(result.candidates.find((row) => row.id === 'a').ranking.semanticRelevance, 0.6);
    assert.equal(result.candidates.find((row) => row.id === 'c').ranking.semanticRelevance, 0.9);
  });
  assert.deepEqual(seen, [['r0', 'r1'], ['r1']]);
});

test('score reuse changes with query, model, policy, evidence and feedback', async () => {
  const rows = [candidate('a'), candidate('b')];
  const questions = [];
  const options = { environment: {}, optimizeDelivery: true, evidenceContext: { missingSubtopics: ['first'] },
    feedback: [{ host: 'example.com', delivered: true, durationMs: 1000 }],
    callJev: async (payload) => { questions.push(Object.keys(payload.questions)); return { ok: true, document: { model: 'jev-1', answers: Object.fromEntries(
      Object.keys(payload.questions).map((key) => [key, { type: 'noul', noul: 0.6 }])) } }; } };
  await withJevRun(async () => {
    await rankCandidates('agents', rows, options);
    await rankCandidates('agents', rows, options);
    await rankCandidates('changed', rows, options);
    await rankCandidates('agents', rows, { ...options, environment: { TYPESAFE_MODEL: 'other' } });
    await rankCandidates('agents', rows, { ...options, cachePolicy: 'different' });
    await rankCandidates('agents', rows, { ...options, evidenceContext: { missingSubtopics: ['second'] } });
    await rankCandidates('agents', rows, { ...options, feedback: [{ host: 'example.com', delivered: false, durationMs: 1000 }] });
  });
  assert.equal(questions.length, 7);
  assert.deepEqual(questions[1], ['v0', 'v1']);
  for (const changed of questions.slice(2)) assert.deepEqual(changed, questions[0]);
});

test('partial invalid scoring after cached scores restores the exact original candidates', async () => {
  const a = candidate('a');
  const b = candidate('b');
  const c = candidate('c');
  await withJevRun(async () => {
    const good = { environment: {}, callJev: async (payload) => ({ ok: true, document: { model: 'jev-1', answers:
      Object.fromEntries(Object.keys(payload.questions).map((key) => [key, { type: 'noul', noul: 0.7 }])) } }) };
    await rankCandidates('agents', [a, b], good);
    const source = [a, c, b];
    const result = await rankCandidates('agents', source, { ...good, callJev: async () => ({ ok: true, document: {
      model: 'jev-1', answers: { r1: { type: 'noul', noul: 2 } },
    } }) });
    assert.equal(result.diagnostic.code, 'TYPESAFE_INVALID_RESPONSE');
    assert.equal(result.candidates, source);
    assert.deepEqual(result.candidates, [a, c, b]);
  });
});

test('score cache stays inside its run and cannot bypass disable, privacy, budget, cancellation or circuit gates', async () => {
  const rows = [candidate('a'), candidate('b')];
  let calls = 0;
  const options = { environment: {}, callJev: async (payload) => { calls += 1; return { ok: true, document: { model: 'jev-1', answers:
    Object.fromEntries(Object.keys(payload.questions).map((key) => [key, { type: 'noul', noul: 0.5 }])) } }; } };
  await withJevRun(async () => {
    await rankCandidates('agents', rows, options);
    const abort = new AbortController();
    abort.abort();
    for (const override of [{ environment: { TYPESAFE_ENABLED: 'false' } }, { privateData: true },
      { remainingBudgetMs: () => 0 }, { signal: abort.signal }]) {
      const result = await rankCandidates('agents', rows, { ...options, ...override });
      assert.equal(result.candidates, rows);
      assert.equal(result.diagnostic.status, 'fallback');
    }
    currentJevRun().circuit = 'TYPESAFE_HTTP_503';
    const circuit = await rankCandidates('agents', rows, options);
    assert.equal(circuit.candidates, rows);
    assert.equal(circuit.diagnostic.code, 'JEV_CIRCUIT_OPEN');
  });
  await withJevRun(() => rankCandidates('agents', rows, options));
  assert.equal(calls, 2);
});

test('candidate score cache is bounded and expired entries are replaced', async () => {
  const rows = Array.from({ length: 130 }, (_, index) => candidate(`c${index}`));
  const options = { environment: {}, callJev: async (payload) => ({ ok: true, document: { model: 'jev-1', answers:
    Object.fromEntries(Object.keys(payload.questions).map((key) => [key, { type: 'noul', noul: 0.5 }])) } }) };
  await withJevRun(async () => {
    await rankCandidates('agents', rows, options);
    const run = currentJevRun();
    assert.equal(run.scoreCache.size, 128);
    const oldest = run.scoreCache.values().next().value;
    oldest.at -= 60_001;
    const before = run.diagnostics.scoreCacheHits;
    await rankCandidates('agents', rows.slice(2), options);
    assert.equal(run.scoreCache.size, 128);
    assert.equal(run.diagnostics.scoreCacheHits, before + 127);
  });
});

for (const transport of ['callJev', 'fetchImpl']) {
  test(`changed ${transport} cannot reuse candidate scores from a successful transport`, async () => {
    const rows = [candidate('a'), candidate('b')];
    let invalidCalls = 0;
    const good = async (payload) => ({ ok: true, document: { model: 'jev-1', answers:
      Object.fromEntries(Object.keys(payload.questions).map((key) => [key, { type: 'noul', noul: 0.8 }])) } });
    const invalid = async () => { invalidCalls += 1; return { ok: true, document: { model: 'jev-1', answers: {} } }; };
    const options = { environment: {}, callJev: (payload, details) => details.fetchImpl(payload), fetchImpl: good };
    await withJevRun(async () => {
      assert.equal((await rankCandidates('agents', rows, options)).diagnostic.status, 'used');
      const result = await rankCandidates('agents', rows, { ...options, [transport]: invalid });
      assert.equal(result.diagnostic.code, 'TYPESAFE_INVALID_RESPONSE');
      assert.equal(result.candidates, rows);
      assert.equal(invalidCalls, 1);
    });
  });
}
