import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { callTypeSafeJev } from './typesafe.mjs';
import { planDiscovery } from './query-planner.mjs';
import { rankCandidates } from './candidate-ranker.mjs';

// Real HTTP transport against an isolated fault server; never send production credentials.
test('HTTP faults preserve planner and ranker fallback, and custom model reaches the wire', async (t) => {
  let mode = 401;
  let requestedModel;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requestedModel = JSON.parse(raw).model;
    if (mode === 'body-timeout') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"answers":');
      return;
    }
    res.writeHead(mode, { 'content-type': 'application/json' });
    res.end(mode === 200 ? JSON.stringify({ answers: {}, model: requestedModel }) : 'fault');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const options = {
    environment: { TYPESAFE_API_KEY: 'isolated-test-key', TYPESAFE_MODEL: 'explicit-test-model' },
    fetchImpl: (_url, init) => fetch(`http://127.0.0.1:${server.address().port}/`, init),
  };
  const input = { query: 'DeepSeek', category: 'general', language: 'all', timeRange: null,
    categoryCandidates: ['general', 'it'] };
  const candidates = [{ url: 'https://example.com/article/123', title: 'DeepSeek' },
    { url: 'https://example.com/article/456', title: 'DeepSeek architecture' }];
  for (const status of [401, 403, 402, 429, 500, 503]) {
    mode = status;
    const planned = await planDiscovery(input, options);
    assert.equal(planned.effective.query, input.query);
    assert.equal(planned.jev.code, `TYPESAFE_HTTP_${status}`);
    const ranked = await rankCandidates(input.query, candidates, options);
    assert.equal(ranked.candidates, candidates);
    assert.equal(ranked.diagnostic.code, `TYPESAFE_HTTP_${status}`);
  }
  mode = 200;
  assert.equal((await callTypeSafeJev({ state: {}, questions: {} }, options)).ok, true);
  assert.equal(requestedModel, 'explicit-test-model');
  mode = 'body-timeout';
  const timeout = await callTypeSafeJev({ state: {}, questions: {} }, {
    ...options, remainingBudgetMs: () => 100,
  });
  assert.equal(timeout.diagnostic.code, 'TYPESAFE_TIMEOUT');
});
