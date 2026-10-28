import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMessage, matchesRequest, summarize, percentile } from './shared-websocket-load.mjs';

test('decodes string data and correlates request IDs', () => {
  const m = decodeMessage(JSON.stringify({ data: JSON.stringify({ event: 'finalAnswer', clientRequestId: 'a' }) }));
  assert.equal(m.event, 'finalAnswer');
  assert.equal(matchesRequest(m, 'a', null), true);
});
test('rejects stale request on the same session and null-session cross talk', () => {
  assert.equal(matchesRequest(decodeMessage('{"clientRequestId":"old","sessionId":"s"}'), 'new', 's'), false);
  assert.equal(matchesRequest(decodeMessage('{"sessionId":null}'), 'new', null), false);
  assert.equal(matchesRequest(decodeMessage('{"sessionId":42}'), 'new', '42'), true);
});
test('nearest-rank percentiles include slowest user at p95 with ten users', () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 0.95), 100);
  assert.equal(percentile([], 0.5), null);
});
test('reports failures separately from successful latency', () => {
  const s = summarize([{ scenario: 'cold', status: 'passed', elapsedMs: 10, firstAnswerMs: 8 }, { scenario: 'cold', status: 'timeout', elapsedMs: 200 }]);
  assert.equal(s.cold.total, 2); assert.equal(s.cold.passed, 1); assert.equal(s.cold.elapsedMs.max, 10);
});
