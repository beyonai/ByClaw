import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cmdInit } from './research-state.mjs';
import { loadSession, persistSession, sessionPaths } from './session.mjs';
import { runWeixinChannelsMaterialize } from './weixin-channels-materializer.mjs';

const URL = 'https://channels.weixin.qq.com/platform/statistic/post';
const ID = '18446744073709551615';
const CLI = fileURLToPath(new globalThis.URL('./knowledge-collection.mjs', import.meta.url));
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

function fixture(t, { registered = true, fullText = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'channels-materializer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  cmdInit({ 'session-dir': root, query: '视频号统计数据', 'source-scope': '["public-internet"]',
    'direct-urls': JSON.stringify([URL]), 'required-content-granularity': fullText ? 'full-text' : 'any' });
  const paths = sessionPaths(root);
  const itemId = 'channels-statistics';
  const raw = `raw/bycli/weixin-channels/${itemId}`;
  fs.mkdirSync(path.join(root, raw), { recursive: true });
  const datasets = [
    { command: 'overview', data: [{ start_date: '2026-10-06', end_date: '2026-10-12', views: 3 }] },
    { command: 'trend', data: [{ date: '2026-10-06', views: 3, follows: -1 }] },
    { command: 'sources', data: [{ source: '推荐', views: 1, views_pct: 33.33 }, { source: '未知', views: null, views_pct: null }] },
    { command: 'posts', data: [{ id: ID, title: '<script>example</script>' }] },
    { command: 'post-detail', postId: ID, data: [{ id: ID, data_details: [{ date: '2026-10-06', source_id: 1, follows: -1, likes: 0, views: null }] }] },
  ];
  const results = datasets.map((entry, index) => {
    const artifact = `${raw}/${entry.command}-${index}.json`;
    const content = `${JSON.stringify(entry.data, null, 2)}\n`;
    fs.writeFileSync(path.join(root, artifact), content);
    return { command: entry.command, ...(entry.postId ? { postId: entry.postId } : {}), artifact,
      size: Buffer.byteLength(content), sha256: digest(content) };
  });
  const artifact = `${raw}/executor-result.json`;
  const executor = { schemaVersion: '1.0', executor: 'bycli', adapter: 'weixin-channels', status: 'saved',
    exitCode: 0, sourceUrl: URL, itemId, days: 7, limit: 20, results, timing: { totalMs: 1 } };
  const writeReceipt = () => {
    const content = `${JSON.stringify(executor, null, 2)}\n`;
    fs.writeFileSync(path.join(root, artifact), content);
    if (registered) {
      const { session } = loadSession(paths);
      session.task.weixinChannelsAcquisitions = [{ itemId, sourceUrl: URL, artifact, sha256: digest(content) }];
      persistSession(paths, session);
    }
  };
  writeReceipt();
  return { root, paths, itemId, executor, artifact, writeReceipt };
}

function cli(root, command, args = []) {
  const result = spawnSync(process.execPath, [CLI, command, '--session-dir', root, ...args], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  return { code: result.status, value: JSON.parse(result.stdout) };
}

function materialize(f, file = path.join(f.root, f.artifact)) {
  return cli(f.root, 'materialize-weixin-channels', ['--item-id', f.itemId, '--executor-result-file', file]);
}

test('registered statistics become an unknown data artifact consumable by collect and status', t => {
  const f = fixture(t);
  const result = materialize(f);
  assert.equal(result.code, 0, result.value.error);
  assert.equal(result.value.materialization.contentGranularity, 'unknown');
  const payload = JSON.parse(fs.readFileSync(result.value.collectPayloadPath, 'utf8'));
  assert.equal(payload.contentGranularity, 'unknown');
  assert.equal(payload.fullTextEvidence, undefined);
  assert.equal(payload.canonicalItem.url, URL);
  const markdown = fs.readFileSync(path.join(f.root, payload.sanitizedPath), 'utf8');
  for (const expected of [ID, 'data_details', '33.33', 'null', '-1', '统计数据']) assert.ok(markdown.includes(expected), expected);
  const collected = cli(f.root, 'collect', ['--item-json-file', result.value.collectPayloadPath]);
  assert.equal(collected.code, 0, collected.value.error);
  const status = cli(f.root, 'status').value;
  assert.equal(status.collection.deliveryComplete, true);
  assert.equal(status.collection.contentGranularity.unknown, 1);
  assert.equal(status.collection.contentGranularity['full-text'], 0);
  assert.equal(status.downstreamInput.files.length, 1);
  assert.equal(loadSession(f.paths).session.task.fullTextEvidenceReceipts, undefined);
});

test('an unregistered hand-made receipt cannot create sanitized statistics', t => {
  const f = fixture(t, { registered: false });
  const result = materialize(f);
  assert.equal(result.code, 1);
  assert.match(result.value.error, /ACQUISITION_NOT_REGISTERED/);
  assert.equal(fs.existsSync(path.join(f.root, 'sanitized/items', f.itemId)), false);
});

test('changed raw JSON fails integrity validation before producing Markdown', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, f.executor.results[0].artifact), ' ');
  const result = materialize(f);
  assert.equal(result.code, 1);
  assert.match(result.value.error, /INTEGRITY/);
  assert.equal(fs.existsSync(path.join(f.root, 'sanitized/items', f.itemId)), false);
});

test('a missing post-detail cannot silently claim the collected post sample is complete', t => {
  const f = fixture(t);
  f.executor.results.pop();
  f.writeReceipt();
  const result = materialize(f);
  assert.equal(result.code, 1);
  assert.match(result.value.error, /INCOMPLETE/);
});

test('raw artifacts outside the controlled item directory and symbolic links are rejected', t => {
  const f = fixture(t);
  const entry = f.executor.results[0];
  const outside = path.join(f.root, 'raw/outside.json');
  fs.copyFileSync(path.join(f.root, entry.artifact), outside);
  fs.unlinkSync(path.join(f.root, entry.artifact));
  fs.symlinkSync(outside, path.join(f.root, entry.artifact));
  const result = materialize(f);
  assert.equal(result.code, 1);
  assert.match(result.value.error, /符号链接|SYMLINK/);
});

test('statistics cannot fulfill a full-text article task', t => {
  const f = fixture(t, { fullText: true });
  const result = materialize(f);
  assert.equal(result.code, 1);
  assert.match(result.value.error, /full-text|全文/);
});

test('a public-collect-owned session remains exclusive even after its run ends', t => {
  const f = fixture(t);
  const { session } = loadSession(f.paths);
  session.task.workflow = 'public-collect';
  persistSession(f.paths, session);
  const result = materialize(f);
  assert.equal(result.code, 1);
  assert.match(result.value.error, /SESSION_OWNED_BY_PUBLIC_COLLECT/);
  assert.equal(fs.existsSync(path.join(f.root, 'sanitized/items', f.itemId)), false);
});

test('existing output files are preserved rather than overwritten', t => {
  const f = fixture(t);
  const output = path.join(f.root, 'sanitized/items', f.itemId, 'index.md');
  fs.mkdirSync(path.dirname(output));
  fs.writeFileSync(output, 'existing user file');
  const result = materialize(f);
  assert.equal(result.code, 1);
  assert.match(result.value.error, /CONFLICT|已存在/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'existing user file');
});

test('a failed output write rolls back only newly created copies and can resume from the same raw evidence', t => {
  const f = fixture(t);
  const outputDirectory = path.join(f.root, 'sanitized/items', f.itemId);
  fs.mkdirSync(outputDirectory, { mode: 0o500 });
  const result = materialize(f);
  assert.equal(result.code, 1);
  assert.match(result.value.error, /EACCES|permission/);
  assert.equal(fs.existsSync(path.join(f.root, 'markdown/items', f.itemId, 'index.md')), false);
  assert.equal(fs.existsSync(path.join(f.root, f.artifact)), true);
  fs.chmodSync(outputDirectory, 0o700);
  const resumed = materialize(f);
  assert.equal(resumed.code, 0, resumed.value.error);
  assert.equal(fs.existsSync(resumed.value.collectPayloadPath), true);
});

test('a partial disk write is owned before writing and does not leave an unrecoverable file', t => {
  const f = fixture(t);
  const write = fs.writeFileSync;
  let injected = false;
  fs.writeFileSync = (target, contents, options) => {
    if (!injected && (typeof target === 'number' || String(target).endsWith(`/markdown/items/${f.itemId}/index.md`))) {
      injected = true;
      write(target, contents.slice(0, 40), options);
      throw Object.assign(new Error('ENOSPC injected after partial write'), { code: 'ENOSPC' });
    }
    return write(target, contents, options);
  };
  const args = { 'item-id': f.itemId, 'executor-result-file': path.join(f.root, f.artifact) };
  try { assert.throws(() => runWeixinChannelsMaterialize(f.paths, args), /ENOSPC/); }
  finally { fs.writeFileSync = write; }
  assert.equal(fs.existsSync(path.join(f.root, 'markdown/items', f.itemId, 'index.md')), false);
  assert.equal(fs.existsSync(path.join(f.root, f.artifact)), true);
  const recovered = runWeixinChannelsMaterialize(f.paths, args);
  assert.equal(recovered.ok, true);
});

test('the actual CLI exposes bounded statistical tool schemas to its consumer', () => {
  const result = spawnSync(process.execPath, [CLI, 'command-schema'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const { commands } = JSON.parse(result.stdout);
  const acquire = commands['acquire-weixin-channels'];
  const materialize = commands['materialize-weixin-channels'];
  assert.deepEqual(acquire.required, ['session-dir', 'item-id', 'source-url']);
  assert.deepEqual(acquire.properties['source-url'].enum, [URL]);
  assert.equal(acquire.properties.days.maximum, 366);
  assert.equal(acquire.properties.limit.maximum, 100);
  for (const [name, command] of [['acquire-weixin-channels', acquire], ['materialize-weixin-channels', materialize]]) {
    const help = spawnSync(process.execPath, [CLI, name, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    const spec = JSON.parse(help.stdout);
    assert.ok(spec.title.length <= 250);
    for (const description of Object.values(spec.args)) assert.ok(description.length <= 150);
    assert.equal(command.additionalProperties, false);
  }
});

test('CLI rejects an excessive post sample before calling the browser executor', t => {
  const f = fixture(t);
  const result = cli(f.root, 'acquire-weixin-channels', [
    '--item-id', 'invalid-sample', '--source-url', URL, '--limit', '101',
  ]);
  assert.equal(result.code, 1);
  assert.match(result.value.error, /limit/);
  assert.equal(fs.existsSync(path.join(f.root, 'raw/bycli/weixin-channels/invalid-sample')), false);
});

test('a controlled acquisition failure has a nonzero CLI exit code and preserves a failed item', t => {
  const f = fixture(t);
  const bin = path.join(f.root, 'raw/test-bin');
  fs.mkdirSync(bin);
  const executable = path.join(bin, 'bycli');
  fs.writeFileSync(executable, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv[2] === 'list' ? [] : {site:'weixin-channels',commands:[]}));\n`, { mode: 0o700 });
  const result = spawnSync(process.execPath, [CLI, 'acquire-weixin-channels', '--session-dir', f.root,
    '--item-id', 'blocked-sample', '--source-url', URL], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.errorCode, 'ADAPTER_UNAVAILABLE');
  assert.equal(result.status, 1);
  const status = cli(f.root, 'status').value;
  assert.equal(status.collection.failed, 1);
  assert.equal(status.collection.deliveryComplete, false);
});
