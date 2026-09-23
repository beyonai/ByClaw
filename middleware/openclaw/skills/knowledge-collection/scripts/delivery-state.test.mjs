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

test('explicit unified selection completes a strict subset while keeping pending inventory', () => {
  const value = session({ requiredContentGranularity: 'full-text', items: [
    { itemId: 'chosen', sourceSkill: 'project-cloud-knowledge', ...materialized('full-text') },
    { itemId: 'other', sourceSkill: 'project-cloud-knowledge', materialization: { status: 'pending' } },
  ], status: 'partial' });
  value.task.sourceScope = ['cloud-knowledge'];
  value.collection.sourceMetadata = { source: 'cloud-knowledge', operation: 'materialize' };
  value.task.selectedDelivery = { schemaVersion: '1.0', itemIds: ['chosen'] };
  assert.equal(deliveryCompleteForSession(value), true);
  value.collection.collection.items[0].materialization.status = 'failed';
  assert.equal(deliveryCompleteForSession(value), false);
});

test('all target and legacy selected sessions still require every inventory row', () => {
  const items = [
    { itemId: 'chosen', ...materialized('full-text') },
    { itemId: 'other', materialization: { status: 'pending' } },
  ];
  const legacy = session({ items, status: 'partial' });
  assert.equal(deliveryCompleteForSession(legacy), false);
  const all = session({ target: 'all', items, status: 'partial' });
  all.task.selectedDelivery = { schemaVersion: '1.0', itemIds: ['chosen'] };
  assert.equal(deliveryCompleteForSession(all), false);
});

test('selected completion retains source failure and rejects malformed or empty selections', () => {
  const value = session({ items: [{ itemId: 'chosen', source: 'public-internet', ...materialized('full-text') }] });
  value.task.sourceScope = ['public-internet'];
  value.collection.sourceMetadata = { operation: 'unified-search', sources: {
    publicInternet: { status: 'failed' }, cloudKnowledge: { status: 'complete' },
  } };
  value.task.selectedDelivery = { schemaVersion: '1.0', itemIds: ['chosen'] };
  assert.equal(deliveryCompleteForSession(value), false);
  delete value.collection.sourceMetadata;
  for (const itemIds of [[], ['unknown'], ['chosen', 'chosen']]) {
    value.task.selectedDelivery = { schemaVersion: '1.0', itemIds };
    assert.equal(deliveryCompleteForSession(value), false);
  }
});
