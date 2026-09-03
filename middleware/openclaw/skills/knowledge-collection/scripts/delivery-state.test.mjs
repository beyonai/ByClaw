import assert from 'node:assert/strict';
import test from 'node:test';

import { deliveryCompleteForSession, summarizePromotedDelivery } from './delivery-state.mjs';

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

function promoted(id, group = id) {
  return {
    itemId: id,
    promotionId: `promotion-${id}`,
    duplicateGroup: group,
    verificationReceipt: `raw/probes/${id}/verification.json`,
    verifiedTopicStatus: 'matched',
    fullTextEvidence: { schemaVersion: '1.0', executor: 'web', artifact: `raw/${id}.json` },
    materialization: { status: 'materialized', contentGranularity: 'full-text' },
  };
}

test('quantity collection completes only after the requested unique promotions exist', () => {
  const value = session({
    requiredContentGranularity: 'full-text',
    items: [promoted('one')],
  });
  value.task.requestedItemCount = 2;
  value.task.publicCollectRun = { requestedCount: 2, status: 'running', deliverableItemIds: ['one'] };
  assert.deepEqual(summarizePromotedDelivery(value), {
    requestedItemCount: 2,
    deliverableArticleCount: 1,
    remainingCount: 1,
    deliverableItemIds: ['one'],
  });
  assert.equal(deliveryCompleteForSession(value), false);

  value.collection.collection.items.push(promoted('two'));
  value.task.publicCollectRun.deliverableItemIds.push('two');
  assert.equal(deliveryCompleteForSession(value), true);
});

test('failed, incomplete, and duplicate promotions do not satisfy requested count', () => {
  const duplicate = promoted('mirror', 'same');
  const original = promoted('original', 'same');
  const incomplete = promoted('incomplete');
  incomplete.materialization.contentGranularity = 'excerpt';
  const value = session({ items: [original, duplicate, incomplete] });
  value.task.requestedItemCount = 2;
  value.task.publicCollectRun = {
    requestedCount: 2,
    status: 'partial',
    deliverableItemIds: ['original', 'mirror', 'failed-probe'],
  };
  assert.equal(summarizePromotedDelivery(value).deliverableArticleCount, 1);
  assert.equal(deliveryCompleteForSession(value), false);
});
