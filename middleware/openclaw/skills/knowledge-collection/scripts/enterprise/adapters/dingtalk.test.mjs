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
const record = { args, home: process.env.HOME, at: Date.now() };
require('node:fs').appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(record) + '\\n');
if (process.env.FIXTURE_MODE === 'auth') {
  process.stderr.write('AUTH_TOKEN_EXPIRED\\n');
  process.exit(1);
}
if (process.env.FIXTURE_MODE === 'json-auth') {
  process.stderr.write(JSON.stringify({ error: { category: 'auth', reason: 'auth_refresh_failed' } }));
  process.exit(1);
}
if (args[0] === 'doc' && args[1] === 'search') {
  const token = value('--cursor');
  if (process.env.FIXTURE_MODE === 'search-pagination-contract') {
    const cursor = value('--cursor');
    if (!cursor) {
      console.log(JSON.stringify({ success: true, result: [{ id: 'page-one', name: 'Page one', url: 'https://docs/page-one' }], nextCursor: 'cursor-2' }));
    } else if (cursor === 'cursor-2') {
      console.log(JSON.stringify({ success: true, result: [{ id: 'page-two', name: 'Page two', url: 'https://docs/page-two' }] }));
    } else {
      process.exit(34);
    }
    process.exit(0);
  }
  if (process.env.FIXTURE_MODE === 'partial-error' && token) {
    process.stderr.write('temporary search failure\\n');
    process.exit(7);
  }
  if (process.env.FIXTURE_MODE === 'v1-result') {
    console.log(JSON.stringify({ success: true, result: [{ id: 'v1-one', name: 'V1 result', type: 'doc', url: 'https://docs/v1-one' }] }));
  } else if (process.env.FIXTURE_MODE === 'unsupported-type') {
    console.log(JSON.stringify({ items: [{ id: 'sheet-one', name: 'Team sheet', type: 'sheet', url: 'https://docs/sheet-one' }] }));
  } else if (process.env.FIXTURE_MODE === 'bad-pagination') {
    console.log(JSON.stringify({ items: [{ id: 'one', name: 'One', url: 'https://docs/one' }], nextPageToken: token || 'loop' }));
  } else if (process.env.FIXTURE_MODE === 'native-success') {
    console.log(JSON.stringify({ items: [{ id: 'native-one', name: 'Native one', type: 'doc', url: 'https://docs/native-one' }] }));
  } else if (['binary-converter', 'missing-converter', 'per-item-failure', 'converter-failure'].includes(process.env.FIXTURE_MODE)) {
    console.log(JSON.stringify({ items: [
      { id: 'native-one', name: 'Native one', type: 'doc', url: 'https://docs/native-one' },
      { id: 'binary-one', name: 'Binary one.pdf', type: 'pdf', url: 'https://docs/binary-one' }
    ] }));
  } else if (['concurrent-materialization', 'materialization-auth'].includes(process.env.FIXTURE_MODE)) {
    console.log(JSON.stringify({ items: process.env.FIXTURE_MODE === 'materialization-auth' ? [
      { id: 'auth-one', name: 'Auth one', type: 'doc', url: 'https://docs/auth-one' },
      { id: 'slow-one', name: 'Slow one', type: 'doc', url: 'https://docs/slow-one' },
      { id: 'pending-one', name: 'Pending one', type: 'doc', url: 'https://docs/pending-one' },
      { id: 'pending-two', name: 'Pending two', type: 'doc', url: 'https://docs/pending-two' }
    ] : [
      { id: 'concurrent-one', name: 'Concurrent one', type: 'doc', url: 'https://docs/concurrent-one' },
      { id: 'concurrent-two', name: 'Concurrent two', type: 'doc', url: 'https://docs/concurrent-two' },
      { id: 'concurrent-three', name: 'Concurrent three', type: 'doc', url: 'https://docs/concurrent-three' },
      { id: 'concurrent-four', name: 'Concurrent four', type: 'doc', url: 'https://docs/concurrent-four' }
    ] }));
  } else if (process.env.FIXTURE_MODE === 'rate-limit-retry') {
    console.log(JSON.stringify({ items: [{ id: 'rate-one', name: 'Rate one', type: 'doc', url: 'https://docs/rate-one' }] }));
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
  const node = value('--node');
  if (process.env.FIXTURE_MODE === 'materialization-auth' && node === 'auth-one') {
    process.stderr.write(JSON.stringify({ error: { category: 'auth', reason: 'auth_refresh_failed' } }));
    process.exit(1);
  }
  if (process.env.FIXTURE_MODE === 'rate-limit-retry' && node === 'rate-one') {
    const calls = require('node:fs').readFileSync(process.env.FIXTURE_LOG, 'utf8').trim().split('\\n').filter(Boolean)
      .map(JSON.parse).filter((entry) => entry.args?.[0] === 'doc' && entry.args?.[1] === 'read' && entry.args.includes('rate-one'));
    if (calls.length === 1) {
      process.stderr.write(JSON.stringify({ error: { category: 'rate_limit', retryAfterMs: 0 } }));
      process.exit(1);
    }
  }
  if (process.env.FIXTURE_MODE === 'concurrent-materialization' || (process.env.FIXTURE_MODE === 'materialization-auth' && node === 'slow-one')) {
    setTimeout(() => {
      require('node:fs').appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ event: 'read-finished', node, at: Date.now() }) + '\\n');
      console.log(JSON.stringify({ markdown: '# Native document\\n\\nHello from DWS.' }));
    }, 80);
    return;
  }
  console.log(JSON.stringify({ markdown: '# Native document\\n\\nHello from DWS.' }));
  process.exit(0);
}
if (args[0] === 'drive' && args[1] === 'list') {
  const parent = value('--folder');
  if (parent === 'folder-root') console.log(JSON.stringify({ items: [
    { dentryUuid: 'folder-child', name: 'child', type: 'folder' },
    { dentryUuid: 'file-root', name: 'quarterly plan root.pdf', type: 'file' }
  ] }));
  else if (parent === 'folder-child') console.log(JSON.stringify({ items: [
    { dentryUuid: 'folder-root', name: 'loop', type: 'folder' },
    { dentryUuid: 'file-child', name: 'quarterly plan child.docx', type: 'file' }
  ] }));
  else process.exit(31);
  process.exit(0);
}
if (args[0] === 'drive' && args[1] === 'download') {
  if (process.env.FIXTURE_MODE === 'per-item-failure') {
    process.stderr.write('HTTP 403 permission denied\\n');
    process.exit(9);
  }
  const output = value('--output');
  if (!output || !value('--node')) process.exit(33);
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
if (process.env.FIXTURE_MODE === 'converter-failure') {
  process.stderr.write('converter failed after download');
  process.exit(42);
}
if (args[0] !== 'convert' || !value('--file-path')) process.exit(41);
if (args.includes('--dry-run')) { console.log(JSON.stringify({ ok: true, dryRun: true })); process.exit(0); }
if (!value('--output')) process.exit(41);
const { dirname } = require('node:path');
require('node:fs').mkdirSync(dirname(value('--output')), { recursive: true });
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
  const { rateLimitRetryDelay, ...searchRequest } = request;
  const adapter = createDingtalkAdapter({
    bin,
    ...(mode === 'missing-converter' ? { converterBin: null } : { converterBin }),
    env: { FIXTURE_MODE: mode, FIXTURE_LOG: log, DWS_HOME: dwsHome },
    ...(rateLimitRetryDelay ? { rateLimitRetryDelay } : {}),
  });
  const result = await adapter.search({
    query: 'quarterly plan', outputDir, limit: 50, concurrency: 4, cursor: null, metadataOnly: false, ...searchRequest,
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
    assert.equal(fixture.calls[0].args.includes('--limit'), true);
    assert.equal(fixture.calls[0].home, fixture.dwsHome);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS v1 result arrays are discovered without assuming a legacy response envelope', async () => {
  const fixture = await collect('v1-result', { metadataOnly: true });
  try {
    assert.equal(fixture.result.status, 'complete', fixture.result.reason);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), ['v1-one']);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS search uses v1 limit and cursor flags across pages', async () => {
  const fixture = await collect('search-pagination-contract', { metadataOnly: true });
  try {
    assert.equal(fixture.result.status, 'complete', fixture.result.reason);
    const searchCalls = fixture.calls.filter((call) => call.args[0] === 'doc' && call.args[1] === 'search');
    assert.equal(searchCalls.length, 2);
    assert.equal(searchCalls[0].args.includes('--limit'), true);
    assert.equal(searchCalls[0].args.includes('--page-size'), false);
    assert.equal(searchCalls[1].args.includes('--cursor'), true);
    assert.equal(searchCalls[1].args[searchCalls[1].args.indexOf('--cursor') + 1], 'cursor-2');
    assert.equal(searchCalls[1].args.includes('--page-token'), false);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('folder-scoped DWS discovery traverses drive safely and avoids cycles', async () => {
  const fixture = await collect('drive', { folderId: 'folder-root', limit: 50, concurrency: 2 });
  try {
    assert.equal(fixture.result.status, 'complete', fixture.result.reason);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), ['file-root', 'file-child']);
    const driveListCalls = fixture.calls.filter((call) => call.args[0] === 'drive' && call.args[1] === 'list');
    assert.equal(driveListCalls.length, 2);
    assert.equal(driveListCalls.every((call) => (
      call.args.includes('--folder') && call.args.includes('--limit') && !call.args.includes('--parent-id') && !call.args.includes('--max')
    )), true);
    assert.equal((await runNode(knowledgeCollectionScript, ['inspect', '--session-dir', fixture.outputDir, '--full'])).code, 0);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('folder-scoped DWS discovery applies requested extension filtering before ranking candidates', async () => {
  const fixture = await collect('drive', { folderId: 'folder-root', extensions: ['pdf'], metadataOnly: true });
  try {
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), ['file-root']);
    assert.deepEqual(metadata.collection.items.map((item) => item.collectionFilters.extensions), [['pdf']]);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('folder-scoped DWS search downloads generic drive files before conversion', async () => {
  const fixture = await collect('drive', { folderId: 'folder-root', extensions: ['pdf'] });
  try {
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.equal(fixture.result.status, 'complete', metadata.collection.items[0].materialization.reason);
    assert.equal(fixture.calls.some((call) => call.args[0] === 'drive' && call.args[1] === 'download'), true);
    assert.equal(fixture.calls.some((call) => call.args[0] === 'doc' && call.args[1] === 'read'), false);
    assert.match(await readFile(join(fixture.outputDir, 'sanitized/items', (await readJson(join(fixture.outputDir, 'collection-result.json'))).items[0].fileName.split('/').at(-1)), 'utf8'), /Converted binary/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('folder-scoped DWS discovery applies the required query to file titles', async () => {
  const fixture = await collect('drive', { folderId: 'folder-root', query: 'root', metadataOnly: true });
  try {
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), ['file-root']);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS discovery preserves native rank while deduplicating stable item IDs', async () => {
  const fixture = await collect('search');
  try {
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), ['one', 'two']);
    assert.equal(new Set(metadata.collection.items.map((item) => item.itemId)).size, 2);
    assert.equal(metadata.sourceMetadata.nativeOrdering, true);
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceRank), [1, 2]);
    assert.equal(metadata.sourceMetadata.discovery.uniqueRecords, 2);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS authentication failures are isolated as continuable auth_required outcomes', async () => {
  const fixture = await collect('auth');
  try {
    assert.equal(fixture.result.status, 'auth_required');
    assert.equal(fixture.result.continuable, true);
    assert.equal((await readJson(join(fixture.outputDir, 'raw/metadata.json'))).status, 'failed');
    assert.equal((await runNode(knowledgeCollectionScript, ['inspect', '--session-dir', fixture.outputDir, '--full'])).code, 0);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS JSON auth refresh failures are auth_required while ordinary 403 permission failures are per-item failures', async () => {
  const authFixture = await collect('json-auth');
  const permissionFixture = await collect('per-item-failure');
  try {
    assert.equal(authFixture.result.status, 'auth_required');
    assert.equal(permissionFixture.result.status, 'partial');
    const metadata = await readJson(join(permissionFixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['materialized', 'failed']);
  } finally {
    await rm(authFixture.root, { recursive: true, force: true });
    await rm(permissionFixture.root, { recursive: true, force: true });
  }
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
    assert.deepEqual(metadata.sourceMetadata.discovery, {
      pagesRequested: 2, pagesCompleted: 1, rawRecords: 3, duplicateRecords: 1, uniqueRecords: 2, limitReached: false, lastSafeCursor: 'next',
    });
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

test('DWS materializes candidates with the requested bounded concurrency and stable inventory order', async () => {
  const fixture = await collect('concurrent-materialization', { concurrency: 2 });
  try {
    assert.equal(fixture.result.status, 'complete', fixture.result.reason);
    const readCalls = fixture.calls.filter((call) => call.args?.[0] === 'doc' && call.args?.[1] === 'read');
    assert.equal(new Set(readCalls.map((call) => call.args[call.args.indexOf('--node') + 1])).size, 4);
    const finishes = fixture.calls.filter((call) => call.event === 'read-finished');
    assert.equal(finishes.length, 4);
    assert.equal(readCalls[2].at >= Math.min(finishes[0].at, finishes[1].at), true);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), [
      'concurrent-one', 'concurrent-two', 'concurrent-three', 'concurrent-four',
    ]);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS stops scheduling new candidates after materialization authentication failure and keeps them pending', async () => {
  const fixture = await collect('materialization-auth', { concurrency: 2 });
  try {
    assert.equal(fixture.result.status, 'auth_required', fixture.result.reason);
    const readNodes = fixture.calls.filter((call) => call.args?.[0] === 'doc' && call.args?.[1] === 'read')
      .map((call) => call.args[call.args.indexOf('--node') + 1]);
    assert.deepEqual(readNodes.sort(), ['auth-one', 'slow-one']);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['failed', 'materialized', 'pending', 'pending']);
    assert.deepEqual(fixture.result.counts, { discovered: 4, materialized: 1, pending: 2, failed: 1 });
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS retries only explicit rate-limit responses without waiting in tests', async () => {
  const fixture = await collect('rate-limit-retry', { rateLimitRetryDelay: async () => {} });
  try {
    assert.equal(fixture.result.status, 'complete', fixture.result.reason);
    assert.equal(fixture.calls.filter((call) => call.args?.[0] === 'doc' && call.args?.[1] === 'read').length, 2);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS binary conversion failures retain download and converter evidence in failed inventory', async () => {
  const fixture = await collect('converter-failure');
  try {
    assert.equal(fixture.result.status, 'partial', fixture.result.reason);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    const binary = metadata.collection.items.find((item) => item.sourceItemId === 'binary-one');
    assert.equal(binary.materialization.status, 'failed');
    assert.equal(binary.rawArtifacts.some((path) => path.startsWith('raw/download-')), true);
    assert.equal(binary.rawArtifacts.some((path) => path.startsWith('raw/drive-download-')), true);
    assert.equal(binary.rawArtifacts.some((path) => path.startsWith('raw/converter-')), true);
    assert.equal(binary.rawArtifacts.some((path) => path.startsWith('raw/failed-')), true);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('metadata-only DWS search never materializes or downloads candidate content', async () => {
  const fixture = await collect('binary-converter', { metadataOnly: true });
  try {
    assert.equal(fixture.result.status, 'complete');
    assert.equal(fixture.calls.some((call) => ['read'].includes(call.args[1]) || (call.args[0] === 'drive' && call.args[1] === 'download') || call.converter), false);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('metadata-only DWS discovery retains candidates that cannot yet be materialized', async () => {
  const fixture = await collect('unsupported-type', { metadataOnly: true });
  try {
    assert.equal(fixture.result.status, 'complete');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), ['sheet-one']);
    assert.equal(metadata.collection.items[0].materialization.status, 'pending');
    assert.equal(metadata.sourceMetadata.discovery.duplicateRecords, 0);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS automatic search reports failed when every discovered candidate fails materialization', async () => {
  const fixture = await collect('unsupported-type');
  try {
    assert.equal(fixture.result.status, 'failed');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'failed');
    assert.deepEqual(fixture.result.counts, { discovered: 1, materialized: 0, pending: 0, failed: 1 });
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS materializes selected metadata-only candidates into a new session', async () => {
  const fixture = await collect('native-success', { metadataOnly: true });
  const materializedOutput = join(fixture.root, 'materialized');
  try {
    const discovery = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    const selectedItemId = discovery.collection.items[0].itemId;
    const result = await createDingtalkAdapter({
      bin: join(fixture.root, 'dws'),
      converterBin: join(fixture.root, 'by-doc-to-markdown'),
      env: { FIXTURE_MODE: 'native-success', FIXTURE_LOG: fixture.log, DWS_HOME: fixture.dwsHome },
    }).materialize({ sessionDir: fixture.outputDir, itemIds: [selectedItemId], outputDir: materializedOutput, concurrency: 2 });
    assert.equal(result.status, 'complete', result.reason);
    const metadata = await readJson(join(materializedOutput, 'sanitized/metadata.json'));
    assert.equal(metadata.sourceMetadata.resumedFrom, fixture.outputDir);
    assert.deepEqual(metadata.sourceMetadata.selectedItemIds, [selectedItemId]);
    assert.equal(metadata.collection.items[0].rawArtifacts.some((artifact) => artifact.startsWith('raw/discovery/')), true);
    assert.match(await readFile(join(materializedOutput, metadata.collection.items[0].materialization.sanitizedPath), 'utf8'), /Hello from DWS/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('DWS selected materialization reports failed when every selected candidate fails', async () => {
  const fixture = await collect('unsupported-type', { metadataOnly: true });
  const materializedOutput = join(fixture.root, 'materialized-failed');
  try {
    const discovery = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    const result = await createDingtalkAdapter({
      bin: join(fixture.root, 'dws'),
      converterBin: join(fixture.root, 'by-doc-to-markdown'),
      env: { FIXTURE_MODE: 'unsupported-type', FIXTURE_LOG: fixture.log, DWS_HOME: fixture.dwsHome },
    }).materialize({
      sessionDir: fixture.outputDir,
      itemIds: [discovery.collection.items[0].itemId],
      outputDir: materializedOutput,
      concurrency: 1,
    });
    assert.equal(result.status, 'failed');
    assert.equal((await readJson(join(materializedOutput, 'sanitized/metadata.json'))).collection.status, 'failed');
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
