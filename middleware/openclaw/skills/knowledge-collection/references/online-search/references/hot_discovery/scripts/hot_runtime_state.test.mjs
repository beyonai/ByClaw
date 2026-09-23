import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as state from './hot_runtime_state.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hot-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, '.collection-inputs');
  await mkdir(directory);
  return { root, directory, runId: 'run-1', waveId: 'wave-1', declarationIdentity: 'decl-1',
    executableIdentity: 'exe-1', now: () => 1000 };
}

test('runtime cache reuses only allowlisted metadata within the same run', async (t) => {
  assert.equal(typeof state.createHotRuntimeState, 'function');
  const options = await fixture(t);
  const store = await state.createHotRuntimeState(options);
  await store.saveRuntime({ version: 'v1', secret: 'do-not-store', catalog: new Map([['a/search', {
    site: 'a', name: 'search', browser: false, strategy: 'public', columns: ['url', 'title'],
    args: [{ name: 'limit', positional: false, default: 'do-not-store' }], cookie: 'do-not-store',
  }]]) });
  const reused = await store.loadRuntime();
  assert.equal(reused.version, 'v1');
  assert.equal(reused.catalog.get('a/search').browser, false);
  assert.equal((await readFile(store.runtimePath, 'utf8')).includes('do-not-store'), false);
  for (const changed of [{ runId: 'run-2' }, { declarationIdentity: 'decl-2' },
    { executableIdentity: 'exe-2' }, { now: () => 400000 }, { now: () => 0 }]) {
    assert.equal(await (await state.createHotRuntimeState({ ...options, ...changed })).loadRuntime(), null);
  }
  const valid = JSON.parse(await readFile(store.runtimePath, 'utf8'));
  for (const rows of [[{ site: 'a', name: 'search', columns: 'url', args: [] }],
    [{ site: 'a', name: 'search', columns: [], args: [{ name: 'limit', positional: 'false' }] }],
    [...valid.payload.rows, ...valid.payload.rows]]) {
    await writeFile(store.runtimePath, JSON.stringify({ ...valid, payload: { ...valid.payload, rows } }));
    assert.equal(await store.loadRuntime(), null);
  }
  await writeFile(store.runtimePath, '{invalid');
  assert.equal(await store.loadRuntime(), null);
});

test('checkpoint recovery validates run, wave and request identity', async (t) => {
  assert.equal(typeof state.createHotRuntimeState, 'function');
  const options = { ...await fixture(t), requestIdentity: 'request-1' };
  const store = await state.createHotRuntimeState(options);
  const document = { channel: 'hot_discovery', query: 'q', candidates: [{ url: 'https://e.test/a', title: 'a' }],
    adapterStats: { a: { status: 'ok' } }, requiresUserAction: { kind: 'captcha' } };
  await store.saveCheckpoint(document);
  assert.deepEqual(await store.loadCheckpoint(), document);
  for (const changed of [{ runId: 'run-2' }, { waveId: 'wave-2' }, { requestIdentity: 'request-2' }]) {
    assert.equal(await (await state.createHotRuntimeState({ ...options, ...changed })).loadCheckpoint(), null);
  }
});

test('state rejects paths outside internal directory and does not read or overwrite symlink targets', async (t) => {
  assert.equal(typeof state.createHotRuntimeState, 'function');
  const options = await fixture(t);
  await assert.rejects(state.createHotRuntimeState({ ...options, directory: options.root }));
  await assert.rejects(state.createHotRuntimeState({ ...options, runId: '../escape' }));
  const store = await state.createHotRuntimeState(options);
  const outside = join(options.root, 'unchanged.json');
  await writeFile(outside, 'original');
  await symlink(outside, store.runtimePath);
  assert.equal(await store.loadRuntime(), null);
  await store.saveRuntime({ version: 'v1', catalog: new Map() });
  assert.equal(await readFile(outside, 'utf8'), 'original');
  const aliasParent = join(options.root, 'alias');
  await mkdir(aliasParent);
  await symlink(options.directory, join(aliasParent, '.collection-inputs'));
  await assert.rejects(state.createHotRuntimeState({ ...options, directory: join(aliasParent, '.collection-inputs') }));
});

test('executable identity changes when the executable or its package version changes', async (t) => {
  assert.equal(typeof state.bycliExecutableIdentity, 'function');
  const { root } = await fixture(t);
  const bin = join(root, 'bycli');
  await writeFile(bin, '#!/usr/bin/env node\n', { mode: 0o700 });
  await writeFile(join(root, 'package.json'), '{"version":"1"}');
  const first = await state.bycliExecutableIdentity({ PATH: root });
  assert.ok(first);
  await writeFile(join(root, 'package.json'), '{"version":"2"}');
  const second = await state.bycliExecutableIdentity({ PATH: root });
  assert.notEqual(first, second);
  await writeFile(bin, '#!/usr/bin/env node\n// changed');
  assert.notEqual(second, await state.bycliExecutableIdentity({ PATH: root }));
  assert.equal(await state.bycliExecutableIdentity({ PATH: '' }), null);
});
