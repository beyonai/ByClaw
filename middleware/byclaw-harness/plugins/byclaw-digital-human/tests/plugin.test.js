import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { apply } from '../src/index.js';
import { readConfiguration, DEFAULT_CONFIG_PATH } from '../src/config.js';
import { invoke, normalizeResult, publicUrl, signedRequest } from '../src/volcengine.js';

const credentials = { accessKeyId: 'fixture-ak', secretAccessKey: 'fixture-sk' };
const config = { ...credentials, schemaVersion: 1, connectorCode: 'volcengine-digital-human', enabled: true };
function filesystem(value = config) {
  const reads = [];
  return {
    reads, value,
    async lstat(path) { reads.push(['lstat', path]); return { type: 'file', size: 256 }; },
    async resolve(path) { reads.push(['resolve', path]); return { targetKey: {}, displayPath: 'remote://opaque-config' }; },
    async readBytes(target, signal, max) {
      reads.push(['readBytes', target, max]);
      return Buffer.from(typeof this.value === 'string' ? this.value : JSON.stringify(this.value));
    },
  };
}
function mount(fs = filesystem()) {
  const tools = new Map();
  const disposers = [];
  apply({ get(name) { return name === 'fs' ? fs : undefined; }, tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } }, effect(fn) { disposers.push(fn()); } });
  return { tools, fs, dispose: () => disposers.forEach((fn) => fn()) };
}
const success = (data) => Response.json({ code: 10000, data, request_id: 'fixture-request' });

test('standalone registration, description budgets, closed schemas and no credential parameters', () => {
  const { tools, dispose } = mount();
  assert.equal(tools.size, 5);
  for (const tool of tools.values()) {
    assert.ok(tool.description.length <= 250, tool.name);
    assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual(tool.parameters.required, Object.keys(tool.parameters.properties).filter((key) => !/^(image|audio)(Url|Path)$/u.test(key)));
    assert.doesNotMatch(JSON.stringify(tool.parameters), /secret|accessKey|configPath|endpoint/iu);
    for (const field of Object.values(tool.parameters.properties)) assert.ok(field.description.length <= 150);
  }
  dispose();
  assert.equal(tools.size, 0);
});

test('reads live config only via ctx.fs with opaque targets and a bounded byte read', async () => {
  assert.equal(DEFAULT_CONFIG_PATH, '/by/.connector-auth/.model/digital-human.json');
  const fs = filesystem();
  assert.deepEqual(await readConfiguration(fs, DEFAULT_CONFIG_PATH), { ...credentials, securityToken: undefined });
  assert.deepEqual(fs.reads[0], ['lstat', DEFAULT_CONFIG_PATH]);
  assert.equal(fs.reads[2][2], 16 * 1024);
  fs.value = { ...config, secretAccessKey: 'rotated-sk' };
  assert.equal((await readConfiguration(fs, DEFAULT_CONFIG_PATH)).secretAccessKey, 'rotated-sk');
  fs.value.enabled = false;
  await assert.rejects(readConfiguration(fs, DEFAULT_CONFIG_PATH), { code: 'DIGITAL_HUMAN_CONFIGURATION_REQUIRED' });
});

test('config failures never expose source text, filesystem errors or credentials', async () => {
  for (const value of ['{fixture-sk', {}, { ...config, connectorCode: 'other' }, { ...config, secretAccessKey: '' },
    { ...config, accessKeyId: 'bad\nkey' }, { ...config, expiresAt: '2020-01-01' }, { ...config, securityToken: 42 },
    { schemaVersion: 1, connectorCode: 'volcengine-digital-human', enabled: true, apiToken: 'fixture-token' },
    { schemaVersion: 1, connectorCode: 'volcengine-digital-human', enabled: true, securityToken: 'fixture-sts' }]) {
    await assert.rejects(readConfiguration(filesystem(value), '/config'), (error) => {
      assert.equal(error.code, 'DIGITAL_HUMAN_CONFIGURATION_REQUIRED');
      assert.doesNotMatch(JSON.stringify(error) + error.message, /fixture-sk|bad|SyntaxError/);
      return true;
    });
  }
  for (const info of [undefined, { type: 'symlink' }, { type: 'directory' }, { type: 'file', size: 16385 }]) {
    const fs = filesystem(); fs.lstat = async () => info;
    await assert.rejects(readConfiguration(fs, '/config'), { code: 'DIGITAL_HUMAN_CONFIGURATION_REQUIRED' });
    assert.equal(fs.reads.length, 0);
  }
});

test('bad arguments and credential injection fail before filesystem or network access', async () => {
  const { tools, fs } = mount();
  const tool = tools.get('digital_human_create_role');
  for (const args of [null, {}, { mode: 'normal' },
    { mode: 'normal', imageUrl: 'https://assets.example/image.png', imagePath: 'photo.png' },
    { mode: 'invalid', imageUrl: 'https://assets.example/image.png' },
    { mode: 'normal', imageUrl: 'https://assets.example/image.png', secretAccessKey: 'injected' }]) {
    await assert.rejects(tool.execute(args), /DIGITAL_HUMAN_INVALID_ARGUMENT/);
  }
  assert.equal(fs.reads.length, 0);
});

test('URLs reject local inputs and credentials without echoing the input', () => {
  for (const value of ['/by/image.png', 'data:image/png;base64,AA', 'http://127.0.0.1/x', 'http://10.0.0.1/x',
    'http://[::1]/x', 'https://user:secret@assets.example/x', 'https://localhost/x', 'http://meta.internal/x', 'file:///secret']) {
    assert.throws(() => publicUrl(value), /DIGITAL_HUMAN_INVALID_URL/);
  }
  assert.equal(publicUrl('https://assets.example/image.png?signature=example'), 'https://assets.example/image.png?signature=example');
});

test('all three modes use documented role/video keys and CVSubmitTask/CVGetResult routes', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return new URL(url).searchParams.get('Action') === 'CVSubmitTask'
      ? success({ task_id: 'task-1' }) : success({ status: 'generating' });
  });
  const { tools } = mount();
  for (const mode of ['normal', 'loopy', 'loopyb']) {
    const suffix = mode === 'normal' ? '' : `_${mode}`;
    for (const stage of ['role', 'video']) {
      const submit = await tools.get(`digital_human_create_${stage}`).execute({ mode,
        ...(stage === 'role' ? { imageUrl: 'https://assets.example/portrait.png' } : { resourceId: 'role-1', audioUrl: 'https://assets.example/voice.wav' }) });
      assert.equal(submit.status, 'submitted');
      const result = await tools.get(`digital_human_get_${stage}`).execute({ mode, taskId: submit.taskId });
      assert.equal(result.status, 'generating');
      assert.equal(result.pollAfterSeconds, 10);
      const expectedKey = stage === 'role' ? `realman_avatar_picture_create_role${suffix}` : `realman_avatar_picture_${mode === 'normal' ? 'v2' : mode}`;
      for (const call of calls.slice(-2)) {
        assert.equal(JSON.parse(call.init.body).req_key, expectedKey);
        assert.equal(call.init.redirect, 'error');
        assert.equal(call.init.headers['x-date'].length, 16);
        assert.match(call.init.headers.authorization, /cn-north-1\/cv\/request/);
      }
    }
  }
  assert.equal(calls.length, 12);
});

test('separate plugin contexts use isolated filesystem capabilities without a credential cache', async (t) => {
  const auth = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => { auth.push(init.headers.authorization); return success({ task_id: 'task-1' }); });
  const { tools, fs } = mount();
  const scoped = filesystem({ ...config, accessKeyId: 'second-user-ak' });
  const second = mount(scoped);
  const tool = second.tools.get('digital_human_create_role');
  const args = { mode: 'normal', imageUrl: 'https://assets.example/photo.png' };
  await tool.execute(args);
  scoped.value.accessKeyId = 'rotated-user-ak';
  await tool.execute(args);
  assert.equal(fs.reads.length, 0);
  assert.match(auth[0], /Credential=second-user-ak\//);
  assert.match(auth[1], /Credential=rotated-user-ak\//);
  await tools.get('digital_human_create_role').execute(args);
  assert.match(auth[2], /Credential=fixture-ak\//);
});

test('normalizes nested results, direct wide-frame URL and terminal states', () => {
  const role = normalizeResult({ data: { status: 'done', resp_data: JSON.stringify({ code: 0, resource_id: 'role-1', status: 0 }) } }, 'role', 'normal', { taskId: 'task-1' }, true);
  assert.equal(role.resourceId, 'role-1');
  for (const data of [{ status: 'done', resp_data: JSON.stringify({ code: 0, preview_url: ['https://video.example/result.mp4'] }) },
    { status: 'done', video_url: 'https://video.example/result.mp4', resp_data: '{"code":0}' }]) {
    assert.deepEqual(normalizeResult({ data }, 'video', 'loopyb', { taskId: 'task-1' }, true).videoUrls, ['https://video.example/result.mp4']);
  }
  for (const status of ['in_queue', 'generating', 'expired', 'not_found']) {
    assert.equal(normalizeResult({ data: { status } }, 'video', 'normal', { taskId: 'task-1' }, true).status, status);
  }
  for (const data of [{ status: 'done', resp_data: '{bad' }, { status: 'done', resp_data: '{"code":42}' },
    { status: 'done', resp_data: '{"algorithm_status_code":42}' }, { status: 'done', resp_data: '{}' }, { status: 'unknown' }]) {
    assert.throws(() => normalizeResult({ data }, 'video', 'normal', { taskId: 'task-1' }, true), /DIGITAL_HUMAN_/);
  }
});

test('provider failures and connection loss are sanitized and never retried', async (t) => {
  let calls = 0;
  const options = { mode: 'normal', imageUrl: 'https://assets.example/photo.png' };
  for (const response of [Response.json({ code: 50430, message: 'fixture-sk' }, { status: 429 }),
    Response.json({ message: 'fixture-sk' }, { status: 401 }), new Response('fixture-sk', { status: 500 })]) {
    t.mock.method(globalThis, 'fetch', async () => { calls++; return response; });
    await assert.rejects(invoke(credentials, 'role', 'normal', options, false), (error) => {
      assert.doesNotMatch(error.message + JSON.stringify(error), /fixture-sk/); return true;
    });
  }
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('fixture-sk'); });
  await assert.rejects(invoke(credentials, 'role', 'normal', options, false), { code: 'DIGITAL_HUMAN_REQUEST_UNCERTAIN', retryable: false });
  assert.equal(calls, 4);
});

test('cancellation before and during IO propagates without resubmission', async (t) => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readConfiguration(filesystem(), '/config', controller.signal), { name: 'AbortError' });
  const next = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  });
  const result = invoke(credentials, 'role', 'normal', { imageUrl: 'https://assets.example/photo.png' }, false, next.signal);
  next.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('bounded upstream body rejects oversized response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(1024 * 1024 + 1)));
  await assert.rejects(invoke(credentials, 'role', 'normal', { imageUrl: 'https://assets.example/photo.png' }, false), { code: 'DIGITAL_HUMAN_INVALID_RESPONSE' });
});

test('signing covers payload, action, date and optional security token', () => {
  const now = new Date('2026-11-05T02:03:04.000Z');
  const signed = signedRequest(credentials, 'CVSubmitTask', { req_key: 'test', image_url: 'https://assets.example/a.png' }, now);
  assert.equal(signed.init.headers['x-date'], '20261105T020304Z');
  assert.equal(signed.init.headers.authorization, 'HMAC-SHA256 Credential=fixture-ak/20261105/cn-north-1/cv/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=6df2f5746956634389204f7202d9f032adaeff1042d3ad5b77570ef140f8286e');
  const temporary = signedRequest({ ...credentials, securityToken: 'fixture-sts' }, 'CVGetResult', {}, now);
  assert.equal(temporary.init.headers['x-security-token'], 'fixture-sts');
  assert.match(temporary.init.headers.authorization, /SignedHeaders=content-type;host;x-content-sha256;x-date;x-security-token/);
  assert.notEqual(temporary.init.headers.authorization, signed.init.headers.authorization);
});

test('package and sources have no other plugin dependencies or host filesystem bypass', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), ['ali-oss']);
  for (const name of await readdir(new URL('../src/', import.meta.url))) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /node:fs|from ['"]@byclaw|byclaw\/session-setup/u);
    if (name !== 'oss.js') assert.doesNotMatch(source, /process\.env/u);
  }
});
