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
const args = process.argv.slice(2);
const out = (value) => process.stdout.write(JSON.stringify(value));
if (args[0] === 'auth' && args[1] === 'check') out({ checks: { token_fetch: true } });
else if (args[0] === 'note' && args[1] === 'search') out({ items: [{ doc_id: 'note-1', title: 'Roadmap', content: 'note preview' }] });
else if (args[0] === 'wiki' && args[1] === 'search') out({ items: [{ id: 'wiki-1', title: 'Wiki roadmap', content: 'wiki body' }] });
else if (args[0] === 'note' && args[1] === 'get') out({ content: '# Roadmap\\n\\nFull note content' });
else if (args[0] === 'wiki' && args[1] === 'import-urls') out({ imported: [{ url: args.at(-2), status: 'accepted' }] });
else { process.stderr.write('unexpected fixture command: ' + args.join(' ')); process.exit(2); }
`, { mode: 0o700 });
  await chmod(bin, 0o700);
  return { root, bin };
}

test('IMA metadata-only search discovers notes and wiki entries without materializing content', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({ bin }).search({ outputDir, query: 'roadmap', limit: 10, metadataOnly: true, kb: 'kb-1' });
    assert.equal(result.connector, 'ima');
    assert.equal(result.status, 'complete');
    assert.equal(result.counts.discovered, 2);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceSkill), ['ima-skill', 'ima-skill']);
    assert.equal(metadata.collection.items.every((item) => item.materialization.status === 'pending'), true);
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

test('IMA URL import requires a knowledge base and records the CLI result', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'import');
    const result = await createImaAdapter({ bin }).collectResource({ outputDir, kb: 'kb-1', url: 'https://example.com/article' });
    assert.equal(result.status, 'complete');
    const raw = await readFile(join(outputDir, 'raw/import-urls.json'), 'utf8');
    assert.match(raw, /accepted/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
