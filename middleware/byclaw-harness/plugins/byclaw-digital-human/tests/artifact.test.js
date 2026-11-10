import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveArtifactBackend } from '../src/backend.js';
import { uploadMedia } from '../src/artifact.js';
import { RegistryKeys } from '@byclaw/by-framework';

const signal = () => new AbortController().signal;
const backend = async () => ({ url: 'http://backend.internal:8080/byaiService/open/api/v1/artifacts', token: 'login-secret', userCode: 'alice' });
const publication = (changes = {}) => ({ code: 0, data: { artifactId: 'fixture-id', status: 'READY', kind: 'FILE',
  previewUrl: 'https://preview.example/artifact-preview/fixture-id/', accessKey: 'management-secret',
  expiresAt: new Date(Date.now() + 86400000).toISOString(), ...changes } });
function filesystem() {
  return {
    async resolve(path) { return path; }, contains(root, path) { return path.startsWith(root); },
    async lstat() { return { type: 'file', size: 4 }; }, async readBytes() { return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); },
  };
}
function redisFixture() {
  let token = 'alice-secret';
  let closed = 0;
  const keys = [];
  const createClient = () => ({
    on() {}, async connect() {}, disconnect() { closed++; },
    async get(key) { keys.push(key); return key.endsWith('alice') ? '1' : key.endsWith('bob') ? '2' : null; },
    async hget(key, field) { keys.push([key, field]); return key === 'user:1:login:auth' ? token : 'bob-secret'; },
    async hgetall(key) { keys.push(key); return { be: JSON.stringify({ host: 'backend.internal', port: 8080, protocol: 'http', path_prefix: 'byaiService' }) }; },
  });
  return { createClient, keys, rotate(value) { token = value; }, get closed() { return closed; } };
}

test('Redis identity matches project-cloud-knowledge, rotates tokens and isolates users', async () => {
  const fixture = redisFixture();
  const options = { createClient: fixture.createClient, environment: { BEYOND_TOKEN: 'wrong-host-secret' } };
  const first = await resolveArtifactBackend('alice', signal(), options);
  assert.equal(first.token, 'alice-secret');
  assert.equal(first.url, 'http://backend.internal:8080/byaiService/open/api/v1/artifacts');
  fixture.rotate('rotated-secret');
  assert.equal((await resolveArtifactBackend('alice', signal(), options)).token, 'rotated-secret');
  assert.equal((await resolveArtifactBackend('bob', signal(), options)).token, 'bob-secret');
  assert.deepEqual(fixture.keys.slice(0, 3), ['SHARE_BFM_USER_CODE_alice', ['user:1:login:auth', 'Beyond-Token'], RegistryKeys.sd_instance_details('ByaiService')]);
  assert.equal(fixture.closed, 3);
});

test('explicit backend addresses retain their prefix; invalid address/login never leaks source data', async () => {
  const fixture = redisFixture();
  const options = { createClient: fixture.createClient, environment: { BYCLAW_DSH_BASE_URL: 'https://backend.example/custom/' } };
  assert.equal((await resolveArtifactBackend('alice', signal(), options)).url, 'https://backend.example/custom/open/api/v1/artifacts');
  for (const base of ['https://user:secret@backend.example', 'file:///tmp', 'https://backend.example/?token=secret']) {
    options.environment.BYCLAW_DSH_BASE_URL = base;
    await assert.rejects(resolveArtifactBackend('alice', signal(), options), /DIGITAL_HUMAN_BACKEND_UNAVAILABLE/);
  }
  for (const user of ['unknown', '../alice', '']) await assert.rejects(resolveArtifactBackend(user, signal(), options), /DIGITAL_HUMAN_BACKEND_UNAVAILABLE/);
  fixture.rotate('');
  await assert.rejects(resolveArtifactBackend('alice', signal(), options), /DIGITAL_HUMAN_BACKEND_UNAVAILABLE/);
  const failing = { createClient: () => { throw new Error('redis://login-secret@private'); } };
  await assert.rejects(resolveArtifactBackend('alice', signal(), failing), (error) => {
    assert.doesNotMatch(error.message, /login-secret|private/u); return true;
  });
});

test('Redis cancellation disconnects only the operation-owned client', async () => {
  const controller = new AbortController();
  let closed = 0;
  const createClient = () => ({ on() {}, connect: () => new Promise(() => {}), disconnect() { closed++; } });
  const pending = resolveArtifactBackend('alice', controller.signal, { createClient });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(closed, 1);
});

test('Artifact multipart publishes validated bytes and only returns the anonymous URL', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, (await backend()).url);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['Beyond-Token'], 'login-secret');
    assert.equal(init.headers['Content-Type'], undefined, 'fetch must generate the multipart boundary');
    assert.equal(init.body.get('file').type, 'image/jpeg');
    assert.deepEqual(Buffer.from(await init.body.get('file').arrayBuffer()), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    assert.equal(init.body.get('publishMode'), 'FILE');
    assert.equal(init.body.get('expiresInSeconds'), '86400');
    return Response.json(publication());
  });
  assert.equal(await uploadMedia(filesystem(), '/workspace', '/workspace/photo.jpg', 'image', backend, signal()), publication().data.previewUrl);
});

test('publication failures, malformed/relative/private URLs and short expiry fail without retry or secret output', async (t) => {
  let calls = 0;
  const responses = [new Response('login-secret', { status: 403 }), new Response('management-secret'),
    Response.json({ code: -1, msg: 'login-secret', data: publication().data }),
    ...[{ previewUrl: '/artifact-preview/id/' }, { previewUrl: 'http://preview.example/file' },
      { previewUrl: 'https://127.0.0.1/file' }, { status: 'UPLOADING' }, { kind: 'SITE' },
      { expiresAt: new Date(Date.now() + 600000).toISOString() }, { expiresAt: 'invalid' }].map(value => Response.json(publication(value))),
    new Response('x'.repeat(1024 * 1024 + 1))];
  for (const response of responses) {
    t.mock.method(globalThis, 'fetch', async () => { calls++; return response; });
    await assert.rejects(uploadMedia(filesystem(), '/workspace', '/workspace/photo.jpg', 'image', backend, signal()), (error) => {
      assert.match(error.message, /DIGITAL_HUMAN_ARTIFACT_/u);
      assert.doesNotMatch(error.message, /login-secret|management-secret|MEDIA_CONNECTOR_CONFIGURATION_REQUIRED/u); return true;
    });
  }
  assert.equal(calls, responses.length);
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('login-secret'); });
  await assert.rejects(uploadMedia(filesystem(), '/workspace', '/workspace/photo.jpg', 'image', backend, signal()), /DIGITAL_HUMAN_ARTIFACT_UPLOAD_UNCERTAIN/);
  assert.equal(calls, responses.length + 1);
});

test('bad files fail before backend authentication; cancellation during upload propagates', async (t) => {
  let authenticated = false;
  const resolver = async () => { authenticated = true; return backend(); };
  await assert.rejects(uploadMedia(filesystem(), '/workspace', '/outside/photo.jpg', 'image', resolver, signal()), /MEDIA_UNREADABLE/);
  assert.equal(authenticated, false);
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    controller.abort(); init.signal.throwIfAborted();
  });
  await assert.rejects(uploadMedia(filesystem(), '/workspace', '/workspace/photo.jpg', 'image', backend, controller.signal), { name: 'AbortError' });
});
