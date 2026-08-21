import assert from 'node:assert/strict';
import { readFile, realpath, rm } from 'node:fs/promises';
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
require('node:fs').appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ args, cwd: process.cwd(), home: process.env.HOME }) + '\\n');
if (process.env.FIXTURE_MODE === 'auth') {
  process.stderr.write('authentication required: token expired\\n');
  process.exit(1);
}
if (process.env.FIXTURE_MODE === 'structured-auth') {
  process.stderr.write(JSON.stringify({ error: { type: 'missing_scope', message: 'scope is missing' } }));
  process.exit(1);
}
  if (args[0] === 'drive' && args[1] === '+search') {
  if (process.env.FIXTURE_MODE === 'rate-limit-retry' && !require('node:fs').existsSync(process.env.FIXTURE_RATE_STATE)) {
    require('node:fs').writeFileSync(process.env.FIXTURE_RATE_STATE, 'limited');
    process.stderr.write(JSON.stringify({ error: { code: 429, type: 'rate_limit', retryAfterMs: 0 } }));
    process.exit(1);
  }
  const token = value('--page-token');
  if (process.env.FIXTURE_MODE === 'unsupported-type') {
    console.log(JSON.stringify({ ok: true, data: { docs: [{ token: 'sheet-one', type: 'sheet', title: 'Team sheet', url: 'https://acme.feishu.cn/sheet/sheet-one' }] } }));
  } else if (process.env.FIXTURE_MODE === 'bad-pagination') {
    console.log(JSON.stringify({ ok: true, data: { docs: [{ token: 'doc-one', type: 'docx', title: 'One', url: 'https://acme.feishu.cn/docx/doc-one' }], page_token: token || 'loop', has_more: true } }));
  } else if (process.env.FIXTURE_MODE === 'pagination-error' && token) {
    process.stderr.write('temporary search outage\\n');
    process.exit(7);
  } else if (['binary-converter', 'missing-converter', 'per-item-failure', 'forbidden-continue'].includes(process.env.FIXTURE_MODE)) {
    const docs = [
      { token: 'doc-one', type: 'docx', title: 'One', url: 'https://acme.feishu.cn/docx/doc-one' },
      { token: 'binary-one', type: 'pdf', title: 'Binary one.pdf', url: 'https://acme.feishu.cn/file/binary-one' }
    ];
    if (process.env.FIXTURE_MODE === 'forbidden-continue') docs[1] = { token: 'doc-two', type: 'docx', title: 'Two', url: 'https://acme.feishu.cn/docx/doc-two' };
    if (process.env.FIXTURE_MODE === 'per-item-failure') docs.reverse();
    console.log(JSON.stringify({ ok: true, data: { docs } }));
  } else if (['concurrency', 'concurrent-auth'].includes(process.env.FIXTURE_MODE)) {
    console.log(JSON.stringify({ ok: true, data: { docs: [
      { token: 'doc-one', type: 'docx', title: 'One', url: 'https://acme.feishu.cn/docx/doc-one' },
      { token: 'doc-two', type: 'docx', title: 'Two', url: 'https://acme.feishu.cn/docx/doc-two' },
      { token: 'doc-three', type: 'docx', title: 'Three', url: 'https://acme.feishu.cn/docx/doc-three' }
    ] } }));
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
  const doc = value('--doc');
  if (process.env.FIXTURE_MODE === 'materialization-auth') {
    process.stderr.write('authentication required: token expired\\n');
    process.exit(1);
  }
  if (process.env.FIXTURE_MODE === 'forbidden-continue' && doc.endsWith('doc-one')) {
    process.stderr.write('403 resource permission denied\\n');
    process.exit(1);
  }
  if (process.env.FIXTURE_MODE === 'concurrent-auth' && doc.endsWith('doc-one')) {
    process.stderr.write('authentication required: token expired\\n');
    process.exit(1);
  }
  if (['concurrency', 'concurrent-auth'].includes(process.env.FIXTURE_MODE)) {
    require('node:fs').appendFileSync(process.env.FIXTURE_ACTIVITY_LOG, JSON.stringify({ event: 'start', doc }) + '\\n');
    setTimeout(() => {
      require('node:fs').appendFileSync(process.env.FIXTURE_ACTIVITY_LOG, JSON.stringify({ event: 'end', doc }) + '\\n');
      console.log(JSON.stringify({ ok: true, data: { document: { content: '# ' + doc + '\\n\\nFetched content.' } } }));
    }, 80);
    return;
  }
  if (process.env.FIXTURE_MODE === 'download-error') {
    process.stderr.write('fetch unavailable\\n');
    process.exit(9);
  }
  console.log(JSON.stringify({ ok: true, data: { document: { content: '# ' + value('--doc') + '\\n\\nFetched content.' } } }));
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
if (args[0] !== 'convert' || !value('--file-path')) process.exit(41);
if (args.includes('--dry-run')) { console.log(JSON.stringify({ ok: true, dryRun: true })); process.exit(0); }
if (!value('--output')) process.exit(41);
require('node:fs').writeFileSync(value('--output'), '# Converted binary\\n');
console.log(JSON.stringify({ ok: true }));
`);
}

async function collect(mode, request = {}) {
  const testCase = await tempCase('fws-adapter-');
  const outputDir = join(testCase.root, `output-${mode}`);
  const log = join(testCase.root, 'calls.ndjson');
  const activityLog = join(testCase.root, 'activity.ndjson');
  const rateState = join(testCase.root, 'rate-state');
  const bin = await larkFixture(testCase.root);
  const larkHome = join(testCase.root, 'lark-home');
  const converterBin = mode === 'missing-converter' ? undefined : await converterFixture(testCase.root);
  const result = await createFwsAdapter({
    bin,
    ...(mode === 'missing-converter' ? { converterBin: null } : { converterBin }),
    env: { FIXTURE_MODE: mode, FIXTURE_LOG: log, FIXTURE_ACTIVITY_LOG: activityLog, FIXTURE_RATE_STATE: rateState, LARK_HOME: larkHome },
    ...(request.rateLimitRetryDelay ? { rateLimitRetryDelay: request.rateLimitRetryDelay } : {}),
  }).search({
    query: 'quarterly plan', outputDir, limit: 50, cursor: null, metadataOnly: false,
    spaceId: 'space-1', fileTypes: ['docx', 'wiki'], ...request,
  });
  const calls = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const activity = await readFile(activityLog, 'utf8').catch(() => '');
  return { ...testCase, outputDir, result, calls, activities: activity.trim().split('\n').filter(Boolean).map(JSON.parse), larkHome };
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
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceRank), [1, 2]);
    assert.deepEqual(metadata.sourceMetadata.discovery, {
      pagesRequested: 1, pagesCompleted: 1, rawRecords: 3, duplicateRecords: 1, uniqueRecords: 2, limitReached: false, lastSafeCursor: null,
    });
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

test('metadata-only FWS discovery retains candidates that cannot yet be materialized', async () => {
  const fixture = await collect('unsupported-type', { metadataOnly: true, fileTypes: ['sheet'] });
  try {
    assert.equal(fixture.result.status, 'complete');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), ['sheet-one']);
    assert.equal(metadata.collection.items[0].materialization.status, 'pending');
    assert.equal(metadata.sourceMetadata.discovery.duplicateRecords, 0);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('FWS automatic search reports failed when every discovered candidate fails materialization', async () => {
  const fixture = await collect('unsupported-type', { fileTypes: ['sheet'] });
  try {
    assert.equal(fixture.result.status, 'failed');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'failed');
    assert.deepEqual(fixture.result.counts, { discovered: 1, materialized: 0, pending: 0, failed: 1 });
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

test('FWS recognizes structured missing scope failures and retries explicit rate limits', async () => {
  const auth = await collect('structured-auth');
  const retry = await collect('rate-limit-retry', { rateLimitRetryDelay: async () => {} });
  try {
    assert.equal(auth.result.status, 'auth_required');
    assert.equal(retry.result.status, 'complete', retry.result.reason);
    assert.equal(retry.calls.filter((call) => call.args[0] === 'drive' && call.args[1] === '+search').length, 2);
  } finally {
    await rm(auth.root, { recursive: true, force: true });
    await rm(retry.root, { recursive: true, force: true });
  }
});

test('FWS materialization authentication failures stop the connector and leave later candidates pending', async () => {
  const fixture = await collect('materialization-auth');
  try {
    assert.equal(fixture.result.status, 'auth_required');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['failed', 'pending']);
    assert.deepEqual(fixture.result.counts, { discovered: 2, materialized: 0, pending: 1, failed: 1 });
    assert.equal(fixture.calls.filter((call) => call.args[0] === 'docs' && call.args[1] === '+fetch').length, 1);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('FWS records ordinary resource 403 failures and continues materializing later candidates', async () => {
  const fixture = await collect('forbidden-continue');
  try {
    assert.equal(fixture.result.status, 'partial');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['failed', 'materialized']);
    assert.equal(fixture.calls.filter((call) => call.args[0] === 'docs' && call.args[1] === '+fetch').length, 2);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('FWS materialization honors bounded concurrency and keeps discovery order', async () => {
  const fixture = await collect('concurrency', { concurrency: 2 });
  try {
    assert.equal(fixture.result.status, 'complete');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), ['doc-one', 'doc-two', 'doc-three']);
    let active = 0;
    let maxActive = 0;
    for (const event of fixture.activities) {
      active += event.event === 'start' ? 1 : -1;
      maxActive = Math.max(maxActive, active);
    }
    assert.equal(maxActive, 2);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('FWS settles started work but leaves unclaimed candidates pending after an authentication failure', async () => {
  const fixture = await collect('concurrent-auth', { concurrency: 2 });
  try {
    assert.equal(fixture.result.status, 'auth_required');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.deepEqual(metadata.collection.items.map((item) => item.materialization.status), ['failed', 'materialized', 'pending']);
    const fetches = fixture.calls.filter((call) => call.args[0] === 'docs' && call.args[1] === '+fetch');
    assert.equal(fetches.length, 2);
    assert.equal(fetches.some((call) => call.args.includes('https://acme.feishu.cn/docx/doc-three')), false);
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
        if (mode === 'pagination-error') {
          assert.deepEqual(metadata.sourceMetadata.discovery, {
            pagesRequested: 2, pagesCompleted: 1, rawRecords: 3, duplicateRecords: 1, uniqueRecords: 2, limitReached: false, lastSafeCursor: 'next',
          });
        }
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
    const converterArtifact = binary.rawArtifacts.find((path) => path.startsWith('raw/converter-'));
    const converterEvidence = await readJson(join(fixture.outputDir, converterArtifact));
    assert.equal(converterEvidence.args.some((argument) => argument.startsWith('/')), false);
    assert.match(await readFile(join(fixture.outputDir, binary.materialization.markdownPath), 'utf8'), /Converted binary/);
    assert.equal(fixture.calls.some((call) => call.args[0] === 'drive' && call.args[1] === '+download'), true);
    const download = fixture.calls.find((call) => call.args[0] === 'drive' && call.args[1] === '+download');
    const outputIndex = download.args.indexOf('--output');
    assert.equal(download.args[outputIndex + 1].startsWith('/'), false);
    assert.equal(download.cwd, await realpath(join(fixture.outputDir, 'raw')));
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

test('FWS materializes selected metadata-only candidates into a new session', async () => {
  const fixture = await collect('search', { metadataOnly: true });
  const materializedOutput = join(fixture.root, 'materialized');
  try {
    const discovery = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    const selectedItemId = discovery.collection.items[0].itemId;
    const result = await createFwsAdapter({
      bin: join(fixture.root, 'lark-cli'),
      converterBin: join(fixture.root, 'by-doc-to-markdown'),
      env: {
        FIXTURE_MODE: 'search',
        FIXTURE_LOG: join(fixture.root, 'calls.ndjson'),
        FIXTURE_ACTIVITY_LOG: join(fixture.root, 'activity.ndjson'),
        FIXTURE_RATE_STATE: join(fixture.root, 'rate-state'),
        LARK_HOME: fixture.larkHome,
      },
    }).materialize({ sessionDir: fixture.outputDir, itemIds: [selectedItemId], outputDir: materializedOutput, concurrency: 2 });
    assert.equal(result.status, 'complete', result.reason);
    const metadata = await readJson(join(materializedOutput, 'sanitized/metadata.json'));
    assert.equal(metadata.sourceMetadata.resumedFrom, fixture.outputDir);
    assert.deepEqual(metadata.sourceMetadata.selectedItemIds, [selectedItemId]);
    assert.equal(metadata.collection.items[0].rawArtifacts.some((artifact) => artifact.startsWith('raw/discovery/')), true);
    assert.match(await readFile(join(materializedOutput, metadata.collection.items[0].materialization.sanitizedPath), 'utf8'), /Fetched content/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('FWS selected materialization reports failed when every selected candidate fails', async () => {
  const fixture = await collect('unsupported-type', { metadataOnly: true, fileTypes: ['sheet'] });
  const materializedOutput = join(fixture.root, 'materialized-failed');
  try {
    const discovery = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    const result = await createFwsAdapter({
      bin: join(fixture.root, 'lark-cli'),
      converterBin: join(fixture.root, 'by-doc-to-markdown'),
      env: {
        FIXTURE_MODE: 'unsupported-type',
        FIXTURE_LOG: join(fixture.root, 'calls.ndjson'),
        FIXTURE_ACTIVITY_LOG: join(fixture.root, 'activity.ndjson'),
        FIXTURE_RATE_STATE: join(fixture.root, 'rate-state'),
        LARK_HOME: fixture.larkHome,
      },
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
