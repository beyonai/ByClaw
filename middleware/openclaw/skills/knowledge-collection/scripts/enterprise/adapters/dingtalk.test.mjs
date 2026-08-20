import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDingtalkAdapter } from './dingtalk.mjs';
import { dispatchEnterprise } from '../dispatcher.mjs';
import { executable, readJson, runNode, tempCase } from '../test-helpers.mjs';

const knowledgeCollectionScript = new URL('../../knowledge-collection.mjs', import.meta.url).pathname;

async function dwsFixture(root) {
  return executable(root, 'dws', `#!/usr/bin/env node
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const record = { args, home: process.env.HOME };
require('node:fs').appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(record) + '\\n');
if (process.env.FIXTURE_MODE === 'auth') {
  process.stderr.write('AUTH_TOKEN_EXPIRED\\n');
  process.exit(1);
}
if (args[0] === 'doc' && args[1] === 'search') {
  const token = value('--page-token');
  if (process.env.FIXTURE_MODE === 'partial-error' && token) {
    process.stderr.write('temporary search failure\\n');
    process.exit(7);
  }
  if (process.env.FIXTURE_MODE === 'bad-pagination') {
    console.log(JSON.stringify({ items: [{ id: 'one', name: 'One', url: 'https://docs/one' }], nextPageToken: token || 'loop' }));
  } else if (process.env.FIXTURE_MODE === 'native-success') {
    console.log(JSON.stringify({ items: [{ id: 'native-one', name: 'Native one', type: 'doc', url: 'https://docs/native-one' }] }));
  } else if (['binary-converter', 'missing-converter', 'per-item-failure'].includes(process.env.FIXTURE_MODE)) {
    console.log(JSON.stringify({ items: [
      { id: 'native-one', name: 'Native one', type: 'doc', url: 'https://docs/native-one' },
      { id: 'binary-one', name: 'Binary one.pdf', type: 'pdf', url: 'https://docs/binary-one' }
    ] }));
  } else {
    const response = { items: [
      { id: 'one', name: 'One', url: 'https://docs/one' },
      { id: 'one', name: 'Duplicate', url: 'https://docs/one-copy' },
      { id: 'two', name: 'Two', url: 'https://docs/two' }
    ] };
    if (process.env.FIXTURE_MODE === 'partial-error') response.nextPageToken = 'next';
    console.log(JSON.stringify(response));
  }
  process.exit(0);
}
if (args[0] === 'doc' && args[1] === 'read') {
  console.log(JSON.stringify({ markdown: '# Native document\\n\\nHello from DWS.' }));
  process.exit(0);
}
if (args[0] === 'drive' && args[1] === 'list') {
  const parent = value('--parent-id');
  if (parent === 'folder-root') console.log(JSON.stringify({ items: [
    { dentryUuid: 'folder-child', name: 'child', type: 'folder' },
    { dentryUuid: 'file-root', name: 'root.pdf', type: 'file' }
  ] }));
  else if (parent === 'folder-child') console.log(JSON.stringify({ items: [
    { dentryUuid: 'folder-root', name: 'loop', type: 'folder' },
    { dentryUuid: 'file-child', name: 'child.docx', type: 'file' }
  ] }));
  else process.exit(31);
  process.exit(0);
}
if (args[0] === 'drive' && args[1] === 'download') {
  if (process.env.FIXTURE_MODE === 'per-item-failure') {
    process.stderr.write('binary download unavailable\\n');
    process.exit(9);
  }
  const output = value('--output');
  if (!output) process.exit(33);
  require('node:fs').writeFileSync(output, '%PDF-1.4 fixture');
  console.log(JSON.stringify({ downloaded: output }));
  process.exit(0);
}
process.exit(32);
`);
}

async function converterFixture(root) {
  return executable(root, 'by-doc-to-markdown', `#!/usr/bin/env node
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
require('node:fs').appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ converter: true, args }) + '\\n');
if (args[0] !== 'convert' || !value('--file-path') || !value('--output')) process.exit(41);
require('node:fs').writeFileSync(value('--output'), '# Converted binary\\n');
console.log(JSON.stringify({ ok: true }));
`);
}

async function collect(mode, request = {}) {
  const testCase = await tempCase('dingtalk-adapter-');
  const outputDir = join(testCase.root, `output-${mode}`);
  const log = join(testCase.root, 'calls.ndjson');
  const bin = await dwsFixture(testCase.root);
  const dwsHome = join(testCase.root, 'dws-home');
  await mkdir(dwsHome, { mode: 0o700 });
  const converterBin = mode === 'missing-converter' ? undefined : await converterFixture(testCase.root);
  const adapter = createDingtalkAdapter({
    bin,
    ...(mode === 'missing-converter' ? { converterBin: null } : { converterBin }),
    env: { FIXTURE_MODE: mode, FIXTURE_LOG: log, DWS_HOME: dwsHome },
  });
  const result = await adapter.search({
    query: 'quarterly plan', outputDir, limit: 50, concurrency: 4, cursor: null, metadataOnly: false, ...request,
  });
  const calls = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { ...testCase, outputDir, log, dwsHome, result, calls };
}

test('dispatcher supplies the default limit of 50 to DWS discovery', async () => {
  const fixture = await tempCase('dingtalk-dispatch-');
  const outputDir = join(fixture.root, 'output');
  const received = [];
  try {
    await dispatchEnterprise('search', {
      source: 'dingtalk', query: 'quarterly plan', 'output-dir': outputDir,
    }, { adapters: { dingtalk: { search: async (request) => { received.push(request); return { status: 'complete' }; } } } });
    assert.equal(received[0].limit, 50);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('metadata-only DWS discovery writes pending inventory with no canonical content', async () => {
  const fixture = await collect('search', { metadataOnly: true });
  try {
    assert.equal(fixture.result.status, 'complete', fixture.result.reason);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'complete');
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['pending', 'pending']);
    assert.deepEqual((await readJson(join(fixture.outputDir, 'collection-result.json'))).items, []);
    assert.equal(fixture.calls[0].args.includes('--page-size'), true);
    assert.equal(fixture.calls[0].home, fixture.dwsHome);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('folder-scoped DWS discovery traverses drive safely and avoids cycles', async () => {
  const fixture = await collect('drive', { folderId: 'folder-root', limit: 50, concurrency: 2 });
  try {
    assert.equal(fixture.result.status, 'complete', fixture.result.reason);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), ['file-root', 'file-child']);
    assert.equal(fixture.calls.filter((call) => call.args[0] === 'drive').length, 2);
    assert.equal((await runNode(knowledgeCollectionScript, ['inspect', '--session-dir', fixture.outputDir, '--full'])).code, 0);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS discovery preserves native rank while deduplicating stable item IDs', async () => {
  const fixture = await collect('search');
  try {
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), ['one', 'two']);
    assert.equal(new Set(metadata.collection.items.map((item) => item.itemId)).size, 2);
    assert.equal(metadata.sourceMetadata.nativeOrdering, true);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS authentication failures are isolated as continuable auth_required outcomes', async () => {
  const fixture = await collect('auth');
  try {
    assert.equal(fixture.result.status, 'auth_required');
    assert.equal(fixture.result.continuable, true);
    assert.equal((await runNode(knowledgeCollectionScript, ['inspect', '--session-dir', fixture.outputDir, '--full'])).code, 0);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('bad DWS pagination keeps discovered inventory and returns partial context', async () => {
  const fixture = await collect('bad-pagination');
  try {
    assert.equal(fixture.result.status, 'partial', fixture.result.reason);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'partial');
    assert.match(metadata.sourceMetadata.pagination.reason, /repeated/i);
    assert.equal(metadata.collection.items[0].materialization.status, 'materialized');
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('ordinary DWS pagination failures retain already discovered pending inventory', async () => {
  const fixture = await collect('partial-error');
  try {
    assert.equal(fixture.result.status, 'partial');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'partial');
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['materialized', 'materialized']);
    assert.match(metadata.sourceMetadata.pagination.reason, /exit 7/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS search materializes native documents from read-only Markdown responses', async () => {
  const fixture = await collect('native-success');
  try {
    assert.equal(fixture.result.status, 'complete');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.items[0].materialization.status, 'materialized');
    assert.match(await readFile(join(fixture.outputDir, metadata.collection.items[0].materialization.sanitizedPath), 'utf8'), /Hello from DWS/);
    assert.equal(fixture.calls.some((call) => call.args[0] === 'doc' && call.args[1] === 'read'), true);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS search downloads binary files into raw evidence then converts them to Markdown', async () => {
  const fixture = await collect('binary-converter');
  try {
    assert.equal(fixture.result.status, 'complete', fixture.result.reason);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    const binary = metadata.collection.items.find((item) => item.sourceItemId === 'binary-one');
    assert.equal(binary.materialization.status, 'materialized');
    assert.equal(binary.rawArtifacts.some((path) => path.startsWith('raw/download-')), true);
    assert.match(await readFile(join(fixture.outputDir, binary.materialization.markdownPath), 'utf8'), /Converted binary/);
    assert.equal(fixture.calls.some((call) => call.args[0] === 'drive' && call.args[1] === 'download'), true);
    assert.equal(fixture.calls.some((call) => call.converter === true), true);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS search retains successful items and records failed materialization evidence as partial', async () => {
  const fixture = await collect('per-item-failure');
  try {
    assert.equal(fixture.result.status, 'partial');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['materialized', 'failed']);
    const failed = metadata.collection.items[1];
    assert.equal(failed.rawArtifacts.some((path) => path.startsWith('raw/failed-')), true);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS search treats an unavailable binary converter as one failed item and continues', async () => {
  const fixture = await collect('missing-converter');
  try {
    assert.equal(fixture.result.status, 'partial');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['materialized', 'failed']);
    assert.match(metadata.collection.items[1].materialization.reason, /converter/i);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('metadata-only DWS search never materializes or downloads candidate content', async () => {
  const fixture = await collect('binary-converter', { metadataOnly: true });
  try {
    assert.equal(fixture.result.status, 'complete');
    assert.equal(fixture.calls.some((call) => ['read'].includes(call.args[1]) || (call.args[0] === 'drive' && call.args[1] === 'download') || call.converter), false);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
