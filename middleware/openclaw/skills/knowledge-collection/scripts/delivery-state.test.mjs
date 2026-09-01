import assert from 'node:assert/strict';
import test from 'node:test';

import { deliveryCompleteForSession } from './delivery-state.mjs';

function session({
  target = 'selected',
  requiredContentGranularity = 'any',
  items = [],
  status = 'complete',
} = {}) {
  return {
    task: { materializationTarget: target, requiredContentGranularity },
    collection: { collection: { status, items } },
  };
}

function materialized(contentGranularity) {
  return { materialization: { status: 'materialized', contentGranularity } };
}

test('selected and all delivery targets require at least one inventory item', () => {
  assert.equal(deliveryCompleteForSession(session({ target: 'selected' })), false);
  assert.equal(deliveryCompleteForSession(session({ target: 'all' })), false);
  assert.equal(deliveryCompleteForSession(session({ target: 'candidates' })), true);
});

test('an explicit full-text requirement rejects every lesser content granularity', () => {
  for (const contentGranularity of ['excerpt', 'abstract', 'unknown']) {
    assert.equal(deliveryCompleteForSession(session({
      requiredContentGranularity: 'full-text',
      items: [materialized(contentGranularity)],
    })), false, contentGranularity);
  }
  assert.equal(deliveryCompleteForSession(session({
    requiredContentGranularity: 'full-text',
    items: [materialized('full-text')],
  })), true);
});

test('ordinary collection completion remains independent of content granularity', () => {
  for (const contentGranularity of ['full-text', 'excerpt', 'abstract', 'unknown']) {
    assert.equal(deliveryCompleteForSession(session({
      items: [materialized(contentGranularity)],
    })), true, contentGranularity);
  }
});
