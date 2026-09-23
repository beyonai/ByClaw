import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSelectedRequest, selectedInventoryItems } from './selected-delivery.mjs';

const inventory = [
  { itemId: 'web-1', source: 'public-internet' },
  { itemId: 'cloud-1', source: 'cloud-knowledge' },
];

test('selection rejects malformed, duplicate, unknown and out-of-scope IDs', () => {
  for (const input of ['', ',', 'web-1,', 'web-1,,cloud-1', 'web-1,web-1', 'unknown', ['web-1', 4]]) {
    assert.throws(() => validateSelectedRequest(input, inventory, ['public-internet', 'cloud-knowledge']));
  }
  assert.throws(() => validateSelectedRequest('cloud-1', inventory, ['public-internet']));
  assert.throws(() => validateSelectedRequest('cloud-1', [
    { itemId: 'cloud-1', source: 'public-internet', sourceSkill: 'project-cloud-knowledge' },
  ], ['public-internet']));
});

test('validated selection accumulates earlier IDs and resolves only the chosen inventory', () => {
  const first = validateSelectedRequest('web-1', inventory, ['public-internet', 'cloud-knowledge']);
  const second = validateSelectedRequest(['cloud-1'], inventory, ['public-internet', 'cloud-knowledge'], first);
  assert.deepEqual(second, { schemaVersion: '1.0', itemIds: ['web-1', 'cloud-1'] });
  assert.deepEqual(selectedInventoryItems(inventory, first).map((item) => item.itemId), ['web-1']);
  assert.equal(selectedInventoryItems(inventory, { schemaVersion: '1.0', itemIds: [] }), null);
  assert.equal(selectedInventoryItems(inventory, first, ['cloud-knowledge']), null);
});
