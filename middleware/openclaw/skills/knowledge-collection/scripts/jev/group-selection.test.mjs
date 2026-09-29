import assert from 'node:assert/strict';
import test from 'node:test';
import { prioritizeGroups } from './group-selection.mjs';

const chooseGuide = async (payload) => ({ ok: true, document: { answers: Object.fromEntries(
  Object.keys(payload.questions).map((key, index) => [key, {
    type: 'choice', choice: index === 1 ? 'high' : 'low', confidence: 0.95,
  }]),
) } });

test('large candidate list selects path groups once and retains every original entry in group order', async () => {
  const entries = Array.from({ length: 120 }, (_, index) => ({
    id: index, group: index % 2 ? 'guide' : 'api',
  }));
  let calls = 0;
  const result = await prioritizeGroups('guide', entries, (entry) => ({ key: entry.group, title: entry.group }), {
    callJev: async (payload) => { calls += 1; return chooseGuide(payload); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.items.map((entry) => entry.id), [
    ...Array.from({ length: 60 }, (_, index) => index * 2 + 1),
    ...Array.from({ length: 60 }, (_, index) => index * 2),
  ]);
});

test('failed or uncertain selection returns the exact original array and objects', async () => {
  const entries = [{ id: 'a', group: 'a' }, { id: 'b', group: 'b' }];
  for (const callJev of [async () => { throw new Error('failed'); },
    async (payload) => ({ ok: true, document: { answers: Object.fromEntries(Object.keys(payload.questions)
      .map((key) => [key, { type: 'choice', choice: 'high', confidence: 0.2 }])) } })]) {
    const result = await prioritizeGroups('query', entries, (entry) => ({ key: entry.group, title: entry.group }), { callJev });
    assert.strictEqual(result.items, entries);
    assert.deepEqual(result.items, entries);
  }
});

test('two-level selection can put a later group first without losing any group', async () => {
  const entries = Array.from({ length: 120 }, (_, index) => ({ id: index, title: `group-${index}` }));
  let calls = 0;
  const result = await prioritizeGroups('group-110', entries, (entry) => ({
    key: entry.title, title: entry.title,
  }), { callJev: async (payload) => {
    calls += 1;
    const answers = Object.fromEntries(Object.entries(payload.state.items).map(([key, item]) => [key, {
      type: 'choice', choice: `${item.title} ${item.text}`.includes('group-110') ? 'high' : 'low', confidence: 0.95,
    }]));
    return { ok: true, document: { answers } };
  } });
  assert.equal(calls, 2);
  assert.equal(result.items[0].id, 110);
  assert.deepEqual(new Set(result.items.map((entry) => entry.id)), new Set(entries.map((entry) => entry.id)));
});

test('coarse selection exposes meaningful suffixes after a long shared title prefix', async () => {
  const entries = Array.from({ length: 120 }, (_, index) => ({ id: index,
    title: `very-long-shared-hostname.example.com/path-${index}${index === 110 ? '-critical-memory-guide' : ''}` }));
  const result = await prioritizeGroups('critical memory guide', entries, (entry) => ({
    key: entry.title, title: entry.title,
  }), { callJev: async (payload) => ({ ok: true, document: { answers: Object.fromEntries(
    Object.entries(payload.state.items).map(([key, item]) => [key, { type: 'choice',
      choice: `${item.title} ${item.text}`.includes('critical-memory-guide') ? 'high' : 'low', confidence: 0.95 }]),
  ) } }) });
  assert.equal(result.items[0].id, 110);
});

test('second-stage failure restores exact original array and one deadline applies to both stages', async () => {
  const entries = Array.from({ length: 120 }, (_, index) => ({ id: index }));
  let calls = 0;
  const result = await prioritizeGroups('query', entries, (entry) => ({ key: String(entry.id), title: `group-${entry.id}` }), {
    callJev: async (payload) => {
      calls += 1;
      if (calls === 2) return { ok: false, diagnostic: { code: 'SECOND_STAGE_FAILURE' } };
      return { ok: true, document: { answers: Object.fromEntries(Object.keys(payload.questions).map((key) => [key,
        { type: 'choice', choice: 'high', confidence: 0.95 }])) } };
    },
  });
  assert.equal(calls, 2);
  assert.strictEqual(result.items, entries);

  let clock = 0;
  let budgetCalls = 0;
  const timed = await prioritizeGroups('query', entries, (entry) => ({ key: String(entry.id), title: `group-${entry.id}` }), {
    now: () => clock,
    callJev: async (payload) => {
      budgetCalls += 1;
      clock = 2000;
      return { ok: true, document: { answers: Object.fromEntries(Object.keys(payload.questions).map((key) => [key,
        { type: 'choice', choice: 'high', confidence: 0.95 }])) } };
    },
  });
  assert.equal(budgetCalls, 1);
  assert.strictEqual(timed.items, entries);
});

test('more than 500 groups never calls inference and returns the original list', async () => {
  const entries = Array.from({ length: 501 }, (_, index) => ({ id: index }));
  const result = await prioritizeGroups('query', entries, (entry) => ({ key: String(entry.id), title: String(entry.id) }), {
    callJev: () => { throw new Error('must not call'); },
  });
  assert.strictEqual(result.items, entries);
});
