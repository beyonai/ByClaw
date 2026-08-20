import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createFwsAdapter } from './fws.mjs';
import { executable, readJson, runNode, tempCase } from '../test-helpers.mjs';

const knowledgeCollectionScript = new URL('../../knowledge-collection.mjs', import.meta.url).pathname;

async function larkFixture(root) {
  return executable(root, 'lark-cli', `#!/usr/bin/env node
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
require('node:fs').appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ args, home: process.env.HOME }) + '\\n');
if (process.env.FIXTURE_MODE === 'auth') {
  process.stderr.write('401 missing_scope drive:drive:readonly\\n');
  process.exit(1);
}
if (args[0] === 'drive' && args[1] === '+search') {
  const token = value('--page-token');
  if (process.env.FIXTURE_MODE === 'bad-pagination') {
    console.log(JSON.stringify({ ok: true, data: { docs: [{ token: 'doc-one', type: 'docx', title: 'One', url: 'https://acme.feishu.cn/docx/doc-one' }], page_token: token || 'loop', has_more: true } }));
  } else if (process.env.FIXTURE_MODE === 'pagination-error' && token) {
    process.stderr.write('temporary search outage\\n');
    process.exit(7);
  } else if (['binary-converter', 'missing-converter', 'per-item-failure'].includes(process.env.FIXTURE_MODE)) {
    const docs = [
      { token: 'doc-one', type: 'docx', title: 'One', url: 'https://acme.feishu.cn/docx/doc-one' },
      { token: 'binary-one', type: 'pdf', title: 'Binary one.pdf', url: 'https://acme.feishu.cn/file/binary-one' }
    ];
    if (process.env.FIXTURE_MODE === 'per-item-failure') docs.reverse();
    console.log(JSON.stringify({ ok: true, data: { docs } }));
  } else {
    console.log(JSON.stringify({ ok: true, data: { docs: [
      { token: 'doc-one', type: 'docx', title: 'One', url: 'https://acme.feishu.cn/docx/doc-one' },
      { token: 'wiki-node', type: 'wiki', title: 'Wiki One', url: 'https://acme.feishu.cn/wiki/wiki-node' },
      { token: 'doc-one', type: 'docx', title: 'Duplicate', url: 'https://acme.feishu.cn/docx/doc-one' }
    ], ...(process.env.FIXTURE_MODE === 'pagination-error' ? { page_token: 'next', has_more: true } : {}) } }));
  }
  process.exit(0);
}
if (args[0] === 'wiki' && args[1] === '+node-get') {
  if (value('--node-token') !== 'wiki-node') process.exit(21);
  console.log(JSON.stringify({ ok: true, data: { node: { obj_token: 'resolved-doc', obj_type: 'docx', title: 'Resolved Wiki One', space_id: 'space-1' } } }));
  process.exit(0);
}
if (args[0] === 'docs' && args[1] === '+fetch') {
  if (process.env.FIXTURE_MODE === 'materialization-auth') {
    process.stderr.write('401 missing_scope docs:document.content:read\\n');
    process.exit(1);
  }
  if (process.env.FIXTURE_MODE === 'download-error') {
    process.stderr.write('fetch unavailable\\n');
    process.exit(9);
  }
  console.log(JSON.stringify({ ok: true, data: { content: '# ' + value('--doc') + '\\n\\nFetched content.' } }));
  process.exit(0);
}
if (args[0] === 'drive' && args[1] === '+download') {
  if (process.env.FIXTURE_MODE === 'per-item-failure') {
    process.stderr.write('binary download unavailable\\n');
    process.exit(9);
  }
  const output = value('--output');
  if (!output) process.exit(33);
  require('node:fs').writeFileSync(output, '%PDF-1.4 fixture');
  console.log(JSON.stringify({ ok: true, data: { downloaded: output } }));
  process.exit(0);
}
process.exit(99);
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
  const testCase = await tempCase('fws-adapter-');
  const outputDir = join(testCase.root, `output-${mode}`);
  const log = join(testCase.root, 'calls.ndjson');
  const bin = await larkFixture(testCase.root);
  const larkHome = join(testCase.root, 'lark-home');
  const converterBin = mode === 'missing-converter' ? undefined : await converterFixture(testCase.root);
  const result = await createFwsAdapter({
    bin,
    ...(mode === 'missing-converter' ? { converterBin: null } : { converterBin }),
    env: { FIXTURE_MODE: mode, FIXTURE_LOG: log, LARK_HOME: larkHome },
  }).search({
    query: 'quarterly plan', outputDir, limit: 50, cursor: null, metadataOnly: false,
    spaceId: 'space-1', fileTypes: ['docx', 'wiki'], ...request,
  });
  const calls = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { ...testCase, outputDir, result, calls, larkHome };
}

test('FWS search preserves Drive rank, resolves Wiki nodes, and deduplicates stable source IDs', async () => {
  const fixture = await collect('search');
  try {
    assert.equal(fixture.result.status, 'complete', fixture.result.reason);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), ['doc-one', 'resolved-doc']);
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceUrl), [
      'https://acme.feishu.cn/docx/doc-one', 'https://acme.feishu.cn/docx/resolved-doc',
    ]);
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceType), ['docx', 'docx']);
    assert.equal(new Set(metadata.collection.items.map((item) => item.itemId)).size, 2);
    assert.equal(metadata.sourceMetadata.nativeOrdering, true);
    assert.equal(fixture.calls[0].args.includes('--space-ids'), true);
    assert.equal(fixture.calls[0].args.includes('--doc-types'), true);
    assert.equal(fixture.calls[0].home, fixture.larkHome);
    assert.equal(fixture.calls.some((call) => call.args[0] === 'wiki' && call.args[1] === '+node-get'), true);
    assert.equal((await runNode(knowledgeCollectionScript, ['inspect', '--session-dir', fixture.outputDir, '--full'])).code, 0);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('FWS adapter preserves the existing Feishu resource collection capability', () => {
  assert.equal(typeof createFwsAdapter().collectResource, 'function');
});

test('metadata-only FWS search keeps resolved inventory pending without fetching document content', async () => {
  const fixture = await collect('search', { metadataOnly: true });
  try {
    assert.equal(fixture.result.status, 'complete');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['pending', 'pending']);
    assert.equal(fixture.calls.some((call) => call.args[0] === 'docs' && call.args[1] === '+fetch'), false);
    assert.deepEqual((await readJson(join(fixture.outputDir, 'collection-result.json'))).items, []);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('FWS authentication failures are continuable auth_required outcomes', async () => {
  const fixture = await collect('auth');
  try {
    assert.equal(fixture.result.status, 'auth_required');
    assert.equal(fixture.result.continuable, true);
    assert.equal((await runNode(knowledgeCollectionScript, ['inspect', '--session-dir', fixture.outputDir, '--full'])).code, 0);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('FWS materialization authentication failures stop the connector and leave later candidates pending', async () => {
  const fixture = await collect('materialization-auth');
  try {
    assert.equal(fixture.result.status, 'auth_required');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['failed', 'pending']);
    assert.equal(fixture.calls.filter((call) => call.args[0] === 'docs' && call.args[1] === '+fetch').length, 1);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('bad FWS pagination and ordinary later-page failures preserve successful items as partial', async (t) => {
  for (const mode of ['bad-pagination', 'pagination-error']) {
    await t.test(mode, async () => {
      const fixture = await collect(mode);
      try {
        assert.equal(fixture.result.status, 'partial', fixture.result.reason);
        const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
        assert.equal(metadata.collection.status, 'partial');
        assert.match(metadata.sourceMetadata.pagination.reason, /repeated|exit 7/i);
      } finally { await rm(fixture.root, { recursive: true, force: true }); }
    });
  }
});

test('FWS search materializes native Feishu Docs and resolved Wiki documents as Markdown', async () => {
  const fixture = await collect('search');
  try {
    assert.equal(fixture.result.status, 'complete', fixture.result.reason);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['materialized', 'materialized']);
    assert.match(await readFile(join(fixture.outputDir, metadata.collection.items[1].materialization.sanitizedPath), 'utf8'), /Fetched content/);
    assert.equal(fixture.calls.filter((call) => call.args[0] === 'docs' && call.args[1] === '+fetch').length, 2);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('FWS search downloads binary files into raw evidence then converts them to Markdown', async () => {
  const fixture = await collect('binary-converter');
  try {
    assert.equal(fixture.result.status, 'complete', fixture.result.reason);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    const binary = metadata.collection.items.find((item) => item.sourceItemId === 'binary-one');
    assert.equal(binary.materialization.status, 'materialized');
    assert.equal(binary.rawArtifacts.some((path) => path.startsWith('raw/download-')), true);
    assert.equal(binary.rawArtifacts.some((path) => path.startsWith('raw/drive-download-')), true);
    assert.equal(binary.rawArtifacts.some((path) => path.startsWith('raw/converter-')), true);
    assert.match(await readFile(join(fixture.outputDir, binary.materialization.markdownPath), 'utf8'), /Converted binary/);
    assert.equal(fixture.calls.some((call) => call.args[0] === 'drive' && call.args[1] === '+download'), true);
    assert.equal(fixture.calls.some((call) => call.converter === true), true);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('FWS search retains successful items and records failed materialization evidence as partial', async () => {
  const fixture = await collect('per-item-failure');
  try {
    assert.equal(fixture.result.status, 'partial');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['failed', 'materialized']);
    assert.equal(metadata.collection.items[0].rawArtifacts.some((path) => path.startsWith('raw/failed-')), true);
    assert.equal(fixture.calls.some((call) => call.args[0] === 'docs' && call.args[1] === '+fetch'), true);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('FWS search treats an unavailable binary converter as one failed item and continues', async () => {
  const fixture = await collect('missing-converter');
  try {
    assert.equal(fixture.result.status, 'partial');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['materialized', 'failed']);
    assert.match(metadata.collection.items[1].materialization.reason, /converter/i);
    assert.equal(metadata.collection.items[1].rawArtifacts.some((path) => path.startsWith('raw/drive-download-')), true);
    assert.equal(metadata.collection.items[1].rawArtifacts.some((path) => path.startsWith('raw/failed-')), true);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('metadata-only FWS search never materializes or downloads candidate content', async () => {
  const fixture = await collect('binary-converter', { metadataOnly: true });
  try {
    assert.equal(fixture.result.status, 'complete');
    assert.equal(fixture.calls.some((call) => (call.args[0] === 'docs' && call.args[1] === '+fetch') || (call.args[0] === 'drive' && call.args[1] === '+download') || call.converter), false);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
