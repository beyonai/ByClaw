import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as plugin from '../src/index.js';

// Explicit opt-in to preinstalled DSH packages. No npm install or running-service modification.
const moduleRoot = process.env.DSH_NODE_MODULES;
test('real Cordis loader, DSH tools/fs, output validation, scope isolation and unload', { skip: !moduleRoot }, async (t) => {
  const load = (name) => import(pathToFileURL(join(resolve(moduleRoot), '@deepseek-ai', name, 'lib/index.js')).href);
  const [{ Context }, { default: SystemPrompt }, { default: ToolRuntime }, { default: LocalFs }, { createScope }] = await Promise.all([
    load('cordis'), load('dsh-system-prompt'), load('dsh-tools'), load('dsh-fs-local'), load('dsh-scope'),
  ]);
  const root = await mkdtemp(join(tmpdir(), 'byclaw-digital-human-'));
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  await ctx.plugin(SystemPrompt, { personaPrefix: '' });
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(LocalFs, { cwd: root });
  const path = join(root, 'config.json');
  const config = { schemaVersion: 1, connectorCode: 'volcengine-digital-human', enabled: true, accessKeyId: 'runtime-ak', secretAccessKey: 'runtime-sk' };
  // Set up fixtures via the same real filesystem API used by a connector projection producer.
  await ctx.fs.writeText(await ctx.fs.resolve(path), JSON.stringify(config));
  const agent = { session: { header: { cwd: root } } };
  const scope = createScope(ctx, agent);
  agent.ctx = scope.ctx;
  const active = scope.ctx.plugin(plugin, { configPath: path });
  await active;
  const schemas = ctx.tools.schemas(agent);
  assert.equal(schemas.length, 5);
  assert.equal(ctx.tools.schemas({}).length, 0, 'Another scope must not gain tools');
  for (const schema of schemas) {
    assert.ok(schema.description.length <= 250);
    assert.equal(schema.parameters.additionalProperties, false);
    assert.deepEqual(schema.parameters.required, Object.keys(schema.parameters.properties).filter((key) => !/^(image|audio)(Url|Path)$/u.test(key)));
  }
  let calls = 0;
  let reply = { task_id: 'runtime-task' };
  let uploadDenied = false;
  const uploads = [];
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const parsed = new URL(url);
    if (parsed.host === 'fixture-digital.oss-cn-beijing.aliyuncs.com') {
      assert.equal(init.method, 'PUT');
      assert.equal(init.headers['x-oss-object-acl'], 'public-read');
      assert.equal(parsed.searchParams.get('x-oss-signature-version'), 'OSS4-HMAC-SHA256');
      assert.equal(parsed.searchParams.get('x-oss-expires'), '600');
      assert.equal(init.redirect, 'error');
      uploads.push({ url: `${parsed.origin}${parsed.pathname}`, type: init.headers['content-type'] });
      return uploadDenied ? new Response('fixture-secret-sk', { status: 403, headers: { 'x-oss-ec': '0016-00000901' } }) : new Response(null);
    }
    assert.equal(parsed.host, 'visual.volcengineapi.com');
    assert.match(init.headers.authorization, /Credential=runtime-ak\//);
    requests.push(JSON.parse(init.body));
    calls++;
    return Response.json({ code: 10000, data: reply });
  });
  const dispatch = (name, args) => ctx.tools.execute({ name, arguments: args, agent, signal: new AbortController().signal, callId: `call-${calls}` });
  const submit = await dispatch('digital_human_create_role', { mode: 'normal', imageUrl: 'https://assets.example/photo.png' });
  assert.equal(submit.isError, false, JSON.stringify(submit));
  assert.equal(JSON.parse(submit.content[0].text).status, 'submitted');
  const previousEnv = {};
  const ossEnv = { OSS_BUCKET: 'fixture-digital', OSS_REGION: 'cn-beijing', OSS_ACCESS_KEY_ID: 'fixture-oss-ak',
    OSS_ACCESS_KEY_SECRET: 'fixture-secret-sk', OSS_SESSION_TOKEN: '' };
  for (const [key, value] of Object.entries(ossEnv)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  await writeFile(join(root, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(join(root, 'voice.wav'), Buffer.from('RIFF0000WAVE0000'));
  await writeFile(join(root, 'disguised.jpg'), 'fixture-secret-sk');
  await symlink(join(root, 'photo.jpg'), join(root, 'symlink.jpg'));
  const localRole = await dispatch('digital_human_create_role', { mode: 'normal', imagePath: 'photo.jpg' });
  assert.equal(localRole.isError, false, JSON.stringify(localRole));
  assert.equal(uploads[0].type, 'image/jpeg');
  assert.equal(requests.at(-1).image_url, uploads[0].url);
  const localVideo = await dispatch('digital_human_create_video', { mode: 'normal', resourceId: 'runtime-role', audioPath: join(root, 'voice.wav') });
  assert.equal(localVideo.isError, false, JSON.stringify(localVideo));
  assert.equal(uploads[1].type, 'audio/wav');
  assert.equal(requests.at(-1).audio_url, uploads[1].url);
  const callsBeforeDenials = calls;
  for (const imagePath of ['symlink.jpg', 'disguised.jpg', '../outside.jpg']) {
    assert.equal((await dispatch('digital_human_create_role', { mode: 'normal', imagePath })).isError, true);
  }
  assert.equal(uploads.length, 2);
  uploadDenied = true;
  const denied = await dispatch('digital_human_create_role', { mode: 'normal', imagePath: 'photo.jpg' });
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied), /0016-00000901/u);
  assert.doesNotMatch(JSON.stringify(denied), /fixture-secret-sk/u);
  assert.equal(calls, callsBeforeDenials, 'Do not submit a Volcengine task when OSS rejects the upload');
  reply = { status: 'done', resp_data: '{"code":0,"resource_id":"runtime-role"}' };
  const done = await dispatch('digital_human_get_role', { mode: 'normal', taskId: 'runtime-task' });
  assert.equal(done.isError, false, JSON.stringify(done));
  assert.equal(JSON.parse(done.content[0].text).resourceId, 'runtime-role');
  reply = { status: 'done', video_url: 'https://video.example/out.mp4', resp_data: '{"code":0}' };
  const video = await dispatch('digital_human_get_video', { mode: 'loopyb', taskId: 'runtime-task' });
  assert.equal(video.isError, false, JSON.stringify(video));
  assert.deepEqual(JSON.parse(video.content[0].text).videoUrls, ['https://video.example/out.mp4']);
  const before = calls;
  const ready = await dispatch('digital_human_check_configuration', {});
  assert.equal(ready.isError, false);
  assert.deepEqual(JSON.parse(ready.content[0].text), { status: 'ready' });
  assert.equal(calls, before, 'Configuration check must not call the provider');
  for (const args of [{ mode: 'normal' }, { mode: 'wrong', taskId: 'runtime-task' }, { mode: 'normal', taskId: 'runtime-task', apiKey: 'injection' }]) {
    const rejected = await dispatch('digital_human_get_role', args);
    assert.equal(rejected.isError, true);
  }
  assert.equal(calls, before);
  await ctx.fs.writeText(await ctx.fs.resolve(path), JSON.stringify({ ...config, enabled: false }));
  const diagnostic = await dispatch('digital_human_check_configuration', {});
  assert.equal(diagnostic.isError, false);
  const configuration = JSON.parse(diagnostic.content[0].text);
  assert.deepEqual(configuration, { status: 'configuration_required', stage: 'validate', reason: 'CONNECTOR_DISABLED',
    connectorCode: 'volcengine-digital-human', message: configuration.message });
  assert.match(diagnostic.content[0].text, /MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=volcengine-digital-human;/u);
  const disabled = await dispatch('digital_human_get_role', { mode: 'normal', taskId: 'runtime-task' });
  assert.equal(disabled.isError, true);
  assert.match(JSON.stringify(disabled), /MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=volcengine-digital-human;/u);
  assert.doesNotMatch(JSON.stringify(disabled), /runtime-sk|runtime-ak/);
  assert.equal(calls, before);
  const destination = join(root, 'linked-config.json');
  await writeFile(destination, JSON.stringify(config));
  await rm(path);
  await symlink(destination, path);
  const linked = await dispatch('digital_human_get_role', { mode: 'normal', taskId: 'runtime-task' });
  assert.equal(linked.isError, true);
  assert.equal(calls, before);
  await active.dispose();
  assert.equal(ctx.tools.schemas(agent).length, 0);
  await scope.dispose();
});
