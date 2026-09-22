import assert from 'node:assert/strict';
import test from 'node:test';

import { callTypeSafeJev, resolveTypeSafeCapability } from './typesafe.mjs';

test('derives TypeSafe availability only from the API key and keeps a fixed timeout', () => {
  assert.deepEqual(resolveTypeSafeCapability({}), {
    status: 'unavailable',
    code: 'TYPESAFE_API_KEY_MISSING',
    model: 'jev-latest',
    timeoutMs: 10_000,
  });
  assert.deepEqual(resolveTypeSafeCapability({
    TYPESAFE_API_KEY: 'top-secret',
  }), {
    status: 'configured',
    model: 'jev-latest',
    timeoutMs: 10_000,
  });

  const configured = resolveTypeSafeCapability({
    TYPESAFE_API_KEY: 'top-secret',
    TYPESAFE_MODEL: 'jev-custom',
  });
  assert.deepEqual(configured, { status: 'configured', model: 'jev-custom', timeoutMs: 10_000 });
  assert.equal(JSON.stringify(configured).includes('top-secret'), false);
});

test('posts the System One contract and normalizes a successful response', async () => {
  let observed;
  const result = await callTypeSafeJev({
    state: { request: 'agent memory' },
    questions: { relevant: { type: 'noul', instructions: 'Is it relevant?' } },
  }, {
    environment: { TYPESAFE_API_KEY: 'secret-value', TYPESAFE_MODEL: 'jev-custom' },
    fetchImpl: async (url, init) => {
      observed = { url, init };
      return new Response(JSON.stringify({
        model: 'jev-custom-1',
        answers: { relevant: { type: 'noul', noul: 0.9 } },
        usage: { input_tokens: 12, output_tokens: 3 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(observed.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(observed.init.headers.Authorization, 'Bearer secret-value');
  assert.deepEqual(JSON.parse(observed.init.body), {
    state: { request: 'agent memory' },
    model: 'jev-custom',
    questions: { relevant: { type: 'noul', instructions: 'Is it relevant?' } },
  });
  assert.deepEqual(result, {
    ok: true,
    document: {
      model: 'jev-custom-1',
      answers: { relevant: { type: 'noul', noul: 0.9 } },
      usage: { input_tokens: 12, output_tokens: 3 },
    },
    diagnostic: { status: 'success', model: 'jev-custom-1' },
  });
});

test('returns unavailable without calling fetch when the token is missing', async () => {
  let calls = 0;
  const result = await callTypeSafeJev({ state: {}, questions: {} }, {
    environment: {},
    fetchImpl: async () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.status, 'unavailable');
  assert.equal(result.diagnostic.code, 'TYPESAFE_API_KEY_MISSING');
});

for (const [status, category, code] of [
  [401, 'authentication', 'TYPESAFE_HTTP_401'],
  [402, 'payment', 'TYPESAFE_HTTP_402'],
  [429, 'rate-limit', 'TYPESAFE_HTTP_429'],
  [503, 'provider', 'TYPESAFE_HTTP_503'],
]) {
  test(`sanitizes TypeSafe HTTP ${status} failures`, async () => {
    const result = await callTypeSafeJev({ state: {}, questions: {} }, {
      environment: { TYPESAFE_API_KEY: 'secret-value' },
      fetchImpl: async () => new Response('upstream secret-value details', { status }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.category, category);
    assert.equal(result.diagnostic.code, code);
    assert.equal(JSON.stringify(result).includes('secret-value'), false);
    assert.equal(JSON.stringify(result).includes('upstream'), false);
  });
}

test('rejects malformed success responses without leaking the body', async () => {
  const result = await callTypeSafeJev({ state: {}, questions: {} }, {
    environment: { TYPESAFE_API_KEY: 'secret-value' },
    fetchImpl: async () => new Response('{"answers":[]}', { status: 200 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.category, 'invalid-response');
  assert.equal(JSON.stringify(result).includes('secret-value'), false);
});

test('classifies an aborted request without exposing the abort reason', async () => {
  const controller = new AbortController();
  controller.abort(new Error('private abort reason'));
  const result = await callTypeSafeJev({ state: {}, questions: {} }, {
    environment: { TYPESAFE_API_KEY: 'secret-value' },
    signal: controller.signal,
    fetchImpl: async (_url, init) => {
      throw init.signal.reason;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.category, 'cancelled');
  assert.equal(JSON.stringify(result).includes('private abort reason'), false);
});
