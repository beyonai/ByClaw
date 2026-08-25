import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createImaAdapter } from './ima.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ima-adapter-'));
  const bin = join(root, 'ima-fixture.mjs');
  await writeFile(bin, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const out = (value) => process.stdout.write(JSON.stringify(value));
if (process.env.IMA_CALLS_PATH) appendFileSync(process.env.IMA_CALLS_PATH, JSON.stringify(args) + '\\n');
if (args[0] === 'auth' && args[1] === 'check') out({ checks: { token_fetch: true } });
else if (args[0] === 'ima' && args[1] === 'knowledge' && process.env.BYCLI_SUCCESS === 'true') out([{ mediaId: 'wiki-bycli-1', title: 'ByCLI roadmap', url: 'https://ima.qq.com/wiki-bycli-1', folderPath: '/Roadmap', abstract: 'bycli preview' }]);
else if (args[0] === 'ima' && args[1] === 'knowledge') { process.stderr.write('bycli knowledge failed'); process.exit(2); }
else if (args[0] === 'wiki' && args[1] === 'search-base') out({ knowledge_bases: [{ id: 'kb-id', name: args[2] }] });
else if (args[0] === 'note' && args[1] === 'search') out({ items: [{ doc_id: 'note-1', title: 'Roadmap', content: 'note preview' }] });
else if (args[0] === 'wiki' && args[1] === 'search' && process.env.WIKI_FAILURE_MODE === 'true') { process.stderr.write('wiki search failed'); process.exit(2); }
else if (args[0] === 'wiki' && args[1] === 'search' && process.env.BYCLI_FALLBACK_MODE === 'true') out({ items: [{ id: 'wiki-fallback-1', title: 'Wiki fallback', content: 'fallback body' }] });
else if (args[0] === 'wiki' && args[1] === 'search') out({ items: [{ id: 'wiki-1', title: 'Wiki roadmap', content: 'wiki body' }] });
else if (args[0] === 'note' && args[1] === 'get') out({ content: '# Roadmap\\n\\nFull note content' });
else { process.stderr.write('unexpected fixture command: ' + args.join(' ')); process.exit(2); }
`, { mode: 0o700 });
  await chmod(bin, 0o700);
  return { root, bin };
}

test('IMA metadata-only search discovers notes and Wiki entries without materializing content', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({ bin, bycliBin: bin }).search({ outputDir, query: 'roadmap', limit: 10, metadataOnly: true });
    assert.equal(result.connector, 'ima');
    assert.equal(result.status, 'complete');
    assert.equal(result.counts.discovered, 2);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceSkill), ['ima-skill', 'ima-skill']);
    assert.equal(metadata.collection.items.every((item) => item.materialization.status === 'pending'), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA knowledge-base listing prefers bycli results before Wiki search', async () => {
  const { root, bin } = await fixture();
  try {
    const callsPath = join(root, 'calls.json');
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_SUCCESS: 'true', IMA_CALLS_PATH: callsPath },
    }).search({ outputDir, query: 'roadmap', limit: 10, metadataOnly: true, kb: 'kb-1' });
    assert.equal(result.status, 'complete');
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.items.find((item) => item.sourceType === 'wiki').sourceItemId, 'wiki-bycli-1');
    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(calls.some((args) => args[0] === 'ima' && args[1] === 'knowledge'), true);
    assert.equal(calls.some((args) => args[0] === 'wiki' && args[1] === 'search'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA knowledge-base collection bypasses note search and resolves the Wiki ID for materialization', async () => {
  const { root, bin } = await fixture();
  try {
    const callsPath = join(root, 'calls.json');
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_SUCCESS: 'true', IMA_CALLS_PATH: callsPath },
    }).search({ outputDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: false });

    assert.equal(result.status, 'complete');
    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(calls.some((args) => args[0] === 'note' && args[1] === 'search'), false);
    assert.equal(calls.some((args) => args[0] === 'wiki' && args[1] === 'search-base' && args[2] === 'kb-name'), true);
    assert.equal(calls.some((args) => args[0] === 'wiki' && args[1] === 'search' && args.includes('--kb') && args[args.indexOf('--kb') + 1] === 'kb-id'), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA knowledge-base listing falls back to Wiki search after bycli fails', async () => {
  const { root, bin } = await fixture();
  try {
    const callsPath = join(root, 'calls.json');
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_FALLBACK_MODE: 'true', IMA_CALLS_PATH: callsPath },
    }).search({ outputDir, query: 'roadmap', limit: 10, metadataOnly: true, kb: 'kb-1' });
    assert.equal(result.status, 'complete');
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.items.find((item) => item.sourceType === 'wiki').sourceItemId, 'wiki-fallback-1');
    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const bycliIndex = calls.findIndex((args) => args[0] === 'ima' && args[1] === 'knowledge');
    const wikiIndex = calls.findIndex((args) => args[0] === 'wiki' && args[1] === 'search');
    assert.equal(bycliIndex >= 0 && bycliIndex < wikiIndex, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA knowledge-base listing reports both failures when bycli and Wiki search fail', async () => {
  const { root, bin } = await fixture();
  try {
    await assert.rejects(
      createImaAdapter({
        bin,
        bycliBin: bin,
        env: { ...process.env, WIKI_FAILURE_MODE: 'true' },
      }).search({ outputDir: join(root, 'search'), query: 'roadmap', limit: 10, metadataOnly: true, kb: 'kb-1' }),
      /IMA knowledge listing failed: bycli=.*wiki=/,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA search materializes note Markdown through note get', async () => {
  const { root, bin } = await fixture();
  try {
    const discoveryDir = join(root, 'discovery');
    await createImaAdapter({ bin }).search({ outputDir: discoveryDir, query: 'roadmap', limit: 1, metadataOnly: true });
    const metadata = JSON.parse(await readFile(join(discoveryDir, 'sanitized/metadata.json'), 'utf8'));
    const itemId = metadata.collection.items[0].itemId;
    const outputDir = join(root, 'materialized');
    const result = await createImaAdapter({ bin }).materialize({ sessionDir: discoveryDir, outputDir, itemIds: [itemId] });
    assert.equal(result.status, 'complete');
    const files = await readdir(join(outputDir, 'sanitized/items'));
    assert.equal(files.length, 1);
    assert.match(await readFile(join(outputDir, 'sanitized/items', files[0]), 'utf8'), /Full note content/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA resource collection reports unsupported without writing artifacts', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'resource');
    const result = await createImaAdapter({ bin }).collectResource({ outputDir, url: 'https://example.com/article' });
    assert.equal(result.status, 'unsupported_capability');
  } finally { await rm(root, { recursive: true, force: true }); }
});
