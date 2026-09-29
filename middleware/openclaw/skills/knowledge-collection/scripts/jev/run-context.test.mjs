import test from 'node:test';
import assert from 'node:assert/strict';
import { withJevRun, currentJevRun } from './run-context.mjs';
import { safeCallJev } from './safe-call.mjs';
import { planDiscovery } from './query-planner.mjs';
import { rankCandidates } from './candidate-ranker.mjs';
import { prioritizeItems } from './selection.mjs';

const payload = { state: { request: 'topic' }, questions: { q: { type: 'choice', criteria: { a: 'a', b: 'b' } } } };
const valid = () => ({ ok: true, document: { answers: { q: { type: 'choice', choice: 'a', confidence: 0.95 } } } });
test('run caches only complete valid payloads and isolates runs, models and inputs', async () => {
  let calls = 0;
  const options = { environment: {}, callJev: async () => { calls++; return valid(); } };
  await withJevRun(async () => {
    const first = await safeCallJev(payload, options);
    first.document.answers.q.choice = 'b';
    assert.equal((await safeCallJev(payload, options)).document.answers.q.choice, 'a');
    assert.equal(calls, 1);
    await safeCallJev({ ...payload, state: { request: 'changed' } }, options);
    await safeCallJev(payload, { ...options, environment: { TYPESAFE_MODEL: 'other' } });
    assert.equal(calls, 3);
  });
  await withJevRun(() => safeCallJev(payload, options));
  assert.equal(calls, 4);
});
test('service failure opens only this run circuit', async () => {
  let calls = 0;
  const options = { environment: {}, callJev: async () => { calls++; throw Error('offline'); } };
  await withJevRun(async () => {
    assert.equal((await safeCallJev(payload, options)).ok, false);
    assert.equal((await safeCallJev(payload, options)).diagnostic.code, 'JEV_CIRCUIT_OPEN');
    assert.equal(calls, 1);
  });
  await withJevRun(() => safeCallJev(payload, options));
  assert.equal(calls, 2);
});
test('disabled, private and exhausted calls cannot reuse cached responses', async () => {
  const options = { environment: {}, callJev: async () => valid() };
  await withJevRun(async () => {
    await safeCallJev(payload, options);
    for (const override of [{ environment: { TYPESAFE_ENABLED: 'false' } }, { privateData: true }, { remainingBudgetMs: () => 0 }]) {
      assert.equal((await safeCallJev(payload, { ...options, ...override })).ok, false);
    }
  });
});
test('uncertain answers are never cached', async () => {
  let calls = 0;
  await withJevRun(async () => {
    const options = { environment: {}, callJev: async () => { calls++; const r = valid(); r.document.answers.q.confidence = 0.4; return r; } };
    await safeCallJev(payload, options);
    await safeCallJev(payload, options);
  });
  assert.equal(calls, 2);
});

test('missing choice answer opens one run circuit across planning and ranking, then a new run recovers', async () => {
  let calls = 0;
  const options = { environment: {}, callJev: async (request) => {
    calls += 1;
    if (calls === 1) return { ok: true, document: { answers: {} } };
    return { ok: true, document: { answers: Object.fromEntries(Object.keys(request.questions)
      .map((name) => [name, { type: 'noul', noul: 0.5 }])) } };
  } };
  const candidates = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  await withJevRun(async () => {
    const plan = await planDiscovery({ query: 'first', queryCandidates: ['first', 'second'],
      category: 'general', language: 'en' }, options);
    assert.equal(plan.jev.code, 'TYPESAFE_INVALID_RESPONSE');
    const rank = await rankCandidates('first', candidates, options);
    assert.equal(rank.diagnostic.code, 'JEV_CIRCUIT_OPEN');
    assert.strictEqual(rank.candidates, candidates);
    assert.equal(currentJevRun().cache.size, 0);
    assert.equal(calls, 1);
  });
  await withJevRun(async () => {
    const rank = await rankCandidates('first', candidates, options);
    assert.equal(rank.diagnostic.status, 'used');
  });
  assert.equal(calls, 2);
});

test('partial selection batch cannot apply or cache one valid answer', async () => {
  const items = [{ title: 'first' }, { title: 'second' }];
  let calls = 0;
  await withJevRun(async () => {
    const result = await prioritizeItems('topic', items, { environment: {}, callJev: async () => {
      calls += 1;
      return { ok: true, document: { answers: { i0: { type: 'choice', choice: 'high', confidence: 0.95 } } } };
    } });
    assert.strictEqual(result.items, items);
    assert.equal(result.diagnostic.code, 'TYPESAFE_INVALID_RESPONSE');
    assert.equal(currentJevRun().cache.size, 0);
    assert.equal(currentJevRun().circuit, 'TYPESAFE_INVALID_RESPONSE');
    assert.equal((await safeCallJev(payload, { environment: {}, callJev: async () => { calls += 1; return valid(); } }))
      .diagnostic.code, 'JEV_CIRCUIT_OPEN');
  });
  assert.equal(calls, 1);
});

for (const [name, answer] of [
  ['wrong answer type', { type: 'noul', noul: 0.8 }],
  ['unknown choice', { type: 'choice', choice: 'other', confidence: 0.95 }],
  ['non-string choice matching a coerced criteria key', { type: 'choice', choice: 0, confidence: 0.95 }],
  ['missing confidence', { type: 'choice', choice: 'a' }],
  ['string confidence', { type: 'choice', choice: 'a', confidence: '0.9' }],
  ['negative confidence', { type: 'choice', choice: 'a', confidence: -0.1 }],
  ['confidence over one', { type: 'choice', choice: 'a', confidence: 1.1 }],
]) {
  test(`${name} corrupts the choice response and opens its run circuit`, async () => {
    await withJevRun(async () => {
      const request = name === 'non-string choice matching a coerced criteria key'
        ? { ...payload, questions: { q: { type: 'choice', criteria: { 0: 'first' } } } } : payload;
      const result = await safeCallJev(request, { environment: {}, callJev: async () => ({ ok: true,
        document: { answers: { q: answer } } }) });
      assert.equal(result.diagnostic.code, 'TYPESAFE_INVALID_RESPONSE');
      assert.equal(currentJevRun().circuit, 'TYPESAFE_INVALID_RESPONSE');
    });
  });
}

for (const [name, answer] of [
  ['wrong noul answer type', { type: 'choice', choice: 'a', confidence: 0.9 }],
  ['missing noul', { type: 'noul' }],
  ['string noul', { type: 'noul', noul: '0.9' }],
  ['negative noul', { type: 'noul', noul: -0.1 }],
  ['noul over one', { type: 'noul', noul: 1.1 }],
]) {
  test(`${name} corrupts the numeric response and opens its run circuit`, async () => {
    await withJevRun(async () => {
      const result = await safeCallJev({ ...payload, questions: { q: { type: 'noul' } } }, {
        environment: {}, callJev: async () => ({ ok: true, document: { answers: { q: answer } } }),
      });
      assert.equal(result.diagnostic.code, 'TYPESAFE_INVALID_RESPONSE');
      assert.equal(currentJevRun().circuit, 'TYPESAFE_INVALID_RESPONSE');
    });
  });
}

test('bounded low-confidence and defined unsure choices remain valid without opening the circuit', async () => {
  let calls = 0;
  const unsurePayload = { ...payload, questions: { q: { type: 'choice', criteria: { a: 'first', unsure: 'uncertain' } } } };
  const options = { environment: {}, callJev: async () => { calls += 1; return { ok: true,
    document: { answers: { q: { type: 'choice', choice: 'unsure', confidence: 0.4 } } } }; } };
  await withJevRun(async () => {
    assert.equal((await safeCallJev(unsurePayload, options)).ok, true);
    assert.equal((await safeCallJev(unsurePayload, options)).ok, true);
    assert.equal(currentJevRun().circuit, null);
    assert.equal(currentJevRun().cache.size, 0);
  });
  assert.equal(calls, 2);
});

test('numeric answer needs no confidence and accepts both inclusive endpoints', async () => {
  const numericPayload = { ...payload, questions: { q: { type: 'noul' } } };
  let calls = 0;
  await withJevRun(async () => {
    for (const [value, state] of [[0, 'zero'], [1, 'one']]) {
      const request = { ...numericPayload, state: { request: state } };
      const options = { environment: {}, callJev: async () => { calls += 1; return { ok: true,
        document: { answers: { q: { type: 'noul', noul: value } } } }; } };
      assert.equal((await safeCallJev(request, options)).document.answers.q.noul, value);
      assert.equal((await safeCallJev(request, options)).document.answers.q.noul, value);
    }
    assert.equal(currentJevRun().circuit, null);
  });
  assert.equal(calls, 2);
});

test('expired cache is ignored and budget timeout opens a run-local circuit', async () => {
  let calls = 0;
  await withJevRun(async () => {
    const options = { environment: {}, callJev: async () => { calls++; return valid(); } };
    await safeCallJev(payload, options);
    for (const entry of currentJevRun().cache.values()) entry.at -= 60001;
    await safeCallJev(payload, options);
    assert.equal(calls, 2);
    const result = await safeCallJev({ ...payload, state: { request: 'hung' } }, {
      environment: {}, remainingBudgetMs: () => 5, callJev: () => new Promise(() => {}) });
    assert.equal(result.diagnostic.code, 'TYPESAFE_TIMEOUT');
    assert.equal((await safeCallJev(payload, options)).diagnostic.code, 'JEV_CIRCUIT_OPEN');
    assert.equal(calls, 2);
  });
});

test('concurrent workflow circuits and caches remain isolated', async () => {
  let healthyCalls = 0;
  let failingCalls = 0;
  await Promise.all([
    withJevRun(async () => {
      const options = { environment: {}, callJev: async () => { failingCalls++; throw Error('offline'); } };
      await safeCallJev(payload, options);
      assert.equal((await safeCallJev(payload, options)).diagnostic.code, 'JEV_CIRCUIT_OPEN');
    }),
    withJevRun(async () => {
      const options = { environment: {}, callJev: async () => { healthyCalls++; return valid(); } };
      assert.equal((await safeCallJev(payload, options)).ok, true);
      assert.equal((await safeCallJev(payload, options)).ok, true);
    }),
  ]);
  assert.equal(failingCalls, 1);
  assert.equal(healthyCalls, 1);
});

test('simultaneous identical calls share one inference and return independent copies', async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  await withJevRun(async () => {
    const options = { environment: {}, callJev: async () => { calls += 1; await pending; return valid(); } };
    const first = safeCallJev(payload, options);
    const second = safeCallJev(payload, options);
    await Promise.resolve();
    assert.equal(calls, 1);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    a.document.answers.q.choice = 'b';
    assert.equal(b.document.answers.q.choice, 'a');
    assert.equal(currentJevRun().diagnostics.inferenceShared, 1);
    assert.equal(JSON.stringify(currentJevRun().diagnostics).includes('topic'), false);
  });
});

test('one waiting caller can time out without cancelling another caller', async () => {
  let release;
  let upstreamSignal;
  const pending = new Promise((resolve) => { release = resolve; });
  await withJevRun(async () => {
    const callJev = async (_payload, options) => { upstreamSignal = options.signal; await pending; return valid(); };
    const short = safeCallJev(payload, { environment: {}, remainingBudgetMs: () => 5, callJev });
    const long = safeCallJev(payload, { environment: {}, remainingBudgetMs: () => 1000, callJev });
    assert.equal((await short).diagnostic.code, 'TYPESAFE_TIMEOUT');
    assert.equal(upstreamSignal.aborted, false);
    assert.equal(currentJevRun().circuit, null);
    release();
    assert.equal((await long).ok, true);
  });
});

test('budget-aware injected provider does not inherit a simultaneous short waiter budget', async () => {
  let upstreamBudget;
  await withJevRun(async () => {
    const callJev = async (_payload, options) => {
      upstreamBudget = options.remainingBudgetMs();
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ ok: false, diagnostic: { code: 'TYPESAFE_TIMEOUT' } }), upstreamBudget);
        setTimeout(() => { clearTimeout(timeout); resolve(valid()); }, 25);
      });
    };
    const short = safeCallJev(payload, { environment: {}, remainingBudgetMs: () => 5, callJev });
    const long = safeCallJev(payload, { environment: {}, remainingBudgetMs: () => 1000, callJev });
    assert.equal((await short).diagnostic.code, 'TYPESAFE_TIMEOUT');
    assert.equal((await long).ok, true);
    assert.equal(currentJevRun().circuit, null);
    assert.equal(upstreamBudget >= 25, true);
  });
});

test('a later long waiter survives a provider that snapshots the first short budget', async () => {
  let providerStarted;
  const started = new Promise((resolve) => { providerStarted = resolve; });
  await withJevRun(async () => {
    const callJev = async (_payload, options) => {
      const transportBudget = options.remainingBudgetMs();
      providerStarted();
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ ok: false, diagnostic: { code: 'TYPESAFE_TIMEOUT' } }), transportBudget);
        setTimeout(() => { clearTimeout(timeout); resolve(valid()); }, 25);
      });
    };
    const short = safeCallJev(payload, { environment: {}, remainingBudgetMs: () => 5, callJev });
    await started;
    const long = safeCallJev(payload, { environment: {}, remainingBudgetMs: () => 1000, callJev });
    assert.equal((await short).diagnostic.code, 'TYPESAFE_TIMEOUT');
    assert.equal((await long).ok, true);
    assert.equal(currentJevRun().circuit, null);
  });
});

test('one cancelled caller cannot cancel another or reuse a stale result', async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  await withJevRun(async () => {
    const abort = new AbortController();
    const options = { environment: {}, callJev: async () => { calls += 1; await pending; return valid(); } };
    const cancelled = safeCallJev(payload, { ...options, signal: abort.signal });
    const active = safeCallJev(payload, options);
    abort.abort();
    assert.equal((await cancelled).diagnostic.code, 'TYPESAFE_CANCELLED');
    release();
    assert.equal((await active).ok, true);
    assert.equal(calls, 1);
    assert.equal((await safeCallJev(payload, { ...options, signal: abort.signal })).diagnostic.code, 'TYPESAFE_CANCELLED');
  });
});

test('in-flight reuse still checks disabled, private, budget and circuit gates', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await withJevRun(async () => {
    const options = { environment: {}, callJev: async () => { await pending; return valid(); } };
    const active = safeCallJev(payload, options);
    const overrides = [
      [{ environment: { TYPESAFE_ENABLED: 'false' } }, 'JEV_DISABLED'],
      [{ privateData: true }, 'ENTERPRISE_INFERENCE_NOT_ENABLED'],
      [{ remainingBudgetMs: () => 0 }, 'TYPESAFE_BUDGET_EXHAUSTED'],
    ];
    for (const [override, code] of overrides) assert.equal((await safeCallJev(payload, { ...options, ...override })).diagnostic.code, code);
    currentJevRun().circuit = 'TYPESAFE_HTTP_503';
    assert.equal((await safeCallJev(payload, options)).diagnostic.code, 'JEV_CIRCUIT_OPEN');
    release();
    await active;
    assert.equal(currentJevRun().cache.size, 0);
  });
});

test('a non-cloneable provider response resolves fallback within the caller deadline', async () => {
  await withJevRun(async () => {
    const result = await Promise.race([
      safeCallJev(payload, { environment: {}, remainingBudgetMs: () => 20,
        callJev: async () => ({ ...valid(), extra: () => 'not transferable' }) }),
      new Promise((resolve) => setTimeout(() => resolve({ diagnostic: { code: 'STUCK' } }), 100)),
    ]);
    assert.equal(result.diagnostic.code, 'TYPESAFE_INVALID_RESPONSE');
    assert.equal(currentJevRun().inFlight.size, 0);
  });
});

test('last waiter timeout removes in-flight work and ignores its late response', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await withJevRun(async () => {
    const result = await safeCallJev(payload, { environment: {}, remainingBudgetMs: () => 5,
      callJev: async () => { await pending; return valid(); } });
    assert.equal(result.diagnostic.code, 'TYPESAFE_TIMEOUT');
    assert.equal(currentJevRun().inFlight.size, 0);
    release();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(currentJevRun().cache.size, 0);
  });
});

test('in-flight sharing map is bounded and abandoned callers leave no entries', async () => {
  await withJevRun(async () => {
    const abort = new AbortController();
    const calls = Array.from({ length: 129 }, (_, index) => safeCallJev({ ...payload, state: { request: `topic-${index}` } },
      { environment: {}, signal: abort.signal, callJev: () => new Promise(() => {}) }));
    assert.equal(currentJevRun().inFlight.size, 128);
    abort.abort();
    const results = await Promise.all(calls);
    assert.equal(results.every((result) => result.diagnostic.code === 'TYPESAFE_CANCELLED'), true);
    assert.equal(currentJevRun().inFlight.size, 0);
  });
});

for (const transport of ['callJev', 'fetchImpl']) {
  test(`changed ${transport} cannot reuse a completed inference in the same run`, async () => {
    let invalidCalls = 0;
    const first = async () => valid();
    const invalid = async () => { invalidCalls += 1; return null; };
    const shared = { environment: {}, callJev: (_payload, options) => options.fetchImpl(), fetchImpl: first };
    await withJevRun(async () => {
      assert.equal((await safeCallJev(payload, shared)).ok, true);
      const changed = { ...shared, [transport]: invalid };
      assert.equal((await safeCallJev(payload, changed)).diagnostic?.code, 'TYPESAFE_INVALID_RESPONSE');
      assert.equal(invalidCalls, 1);
    });
  });
}

for (const transport of ['callJev', 'fetchImpl']) {
  test(`changed ${transport} cannot join an in-flight inference`, async () => {
    let release;
    let started;
    let invalidCalls = 0;
    const waiting = new Promise((resolve) => { release = resolve; });
    const began = new Promise((resolve) => { started = resolve; });
    const first = async () => { started(); await waiting; return valid(); };
    const invalid = async () => { invalidCalls += 1; return null; };
    const shared = { environment: {}, callJev: (_payload, options) => options.fetchImpl(), fetchImpl: first };
    await withJevRun(async () => {
      const pending = safeCallJev(payload, shared);
      await began;
      const changed = { ...shared, [transport]: invalid };
      try {
        const result = await safeCallJev(payload, changed);
        assert.equal(result.diagnostic?.code, 'TYPESAFE_INVALID_RESPONSE');
        assert.equal(invalidCalls, 1);
      } finally {
        release();
        await pending;
      }
    });
  });
}
