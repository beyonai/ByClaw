import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCloudKnowledgeAdapter } from './cloud-knowledge.mjs';
import { newSession, persistSession } from '../../session.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cloud-knowledge-'));
  const script = join(root, 'cloud-cli-stub.mjs');
  await writeFile(script, `
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args[0] === 'search-file') {
  process.stdout.write(JSON.stringify({ ok: true, data: [
    { resourceId: 1024, filePath: '/docs/a.md', score: 0.9, metadata: {
      fileType: { value: 'md' }, fileSize: { value: 12 }, fileSignature: { value: '${'a'.repeat(64)}' },
    } },
    { resourceId: 1024, filePath: '/outside/escape.md', score: 1, metadata: {
      fileType: { value: 'md' }, fileSize: { value: 12 }, fileSignature: { value: '${'b'.repeat(64)}' },
    } },
  ] }));
} else if (args[0] === 'download') {
  const output = args[args.indexOf('--output') + 1];
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, '# downloaded\\n');
  process.stdout.write(JSON.stringify({ ok: true, output, bytes: 12 }));
}
`);
  await chmod(script, 0o700);
  const session = newSession({
    query: '巡检流程', sourceScope: ['cloud-knowledge'], materializationTarget: 'selected',
    requiredContentGranularity: 'full-text', cloudDiscoveryScope: {
      schemaVersion: '1.0', resources: [{ resourceId: 1024, directoryPath: '/docs', origin: 'user-input' }],
    },
  });
  await mkdir(join(root, 'raw'), { recursive: true });
  await mkdir(join(root, 'markdown/items'), { recursive: true });
  await mkdir(join(root, 'sanitized/items'), { recursive: true });
  persistSession({ root, session: join(root, 'session.json') }, session);
  return { root, script };
}

test('cloud knowledge adapter searches only authorized candidates and materializes selected Markdown safely', async () => {
  const { root, script } = await fixture();
  try {
    const adapter = createCloudKnowledgeAdapter({ python: process.execPath, script, env: process.env });
    const discovered = await adapter.search({ outputDir: root, query: '巡检流程', limit: 10 });
    const rawDiscovery = JSON.parse(await readFile(join(root, 'raw/metadata.json'), 'utf8'));
    assert.equal(discovered.status, 'complete', JSON.stringify({ discovered, rawDiscovery }));
    const metadata = JSON.parse(await readFile(join(root, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.items.length, 1);
    assert.equal(metadata.collection.items[0].filePath, '/docs/a.md');
    assert.equal(metadata.collection.items[0].fileType, 'md');
    assert.equal(metadata.collection.items[0].fileSize, 12);
    assert.equal(metadata.collection.items[0].resourceId, 1024);
    assert.equal(metadata.collection.items[0].fileSignature, 'a'.repeat(64));

    const itemId = metadata.collection.items[0].itemId;
    const materialized = await adapter.materialize({ sessionDir: root, outputDir: root, itemIds: [itemId] });
    assert.equal(materialized.status, 'complete');
    assert.equal(materialized.counts.materialized, 1);
    const finalMetadata = JSON.parse(await readFile(join(root, 'sanitized/metadata.json'), 'utf8'));
    const item = finalMetadata.collection.items[0];
    assert.equal(item.materialization.contentGranularity, 'full-text');
    assert.match(item.materialization.sanitizedPath, /^sanitized\/items\//);
    assert.equal((await readFile(join(root, item.materialization.sanitizedPath), 'utf8')).includes('downloaded'), true);
    assert.equal((await readFile(join(root, 'collection-result.json'), 'utf8')).includes(item.sourceUrl), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cloud knowledge materialization rejects a tampered unauthorized candidate before invoking download', async () => {
  const { root, script } = await fixture();
  try {
    const adapter = createCloudKnowledgeAdapter({ python: process.execPath, script, env: process.env });
    const discovered = await adapter.search({ outputDir: root, query: '巡检流程', limit: 10 });
    const rawDiscovery = JSON.parse(await readFile(join(root, 'raw/metadata.json'), 'utf8'));
    assert.equal(discovered.status, 'complete', JSON.stringify({ discovered, rawDiscovery }));
    const metadataPath = join(root, 'sanitized/metadata.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    metadata.collection.items[0].filePath = '/outside/tampered.md';
    await writeFile(metadataPath, JSON.stringify(metadata));
    const result = await adapter.materialize({ sessionDir: root, outputDir: root, itemIds: [metadata.collection.items[0].itemId] });
    assert.equal(result.status, 'failed');
    const failed = JSON.parse(await readFile(join(root, 'sanitized/metadata.json'), 'utf8'));
    assert.match(failed.collection.items[0].materialization.reason, /^SOURCE_NOT_AUTHORIZED_BY_DISCOVERY:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cloud knowledge search persists a structured terminal reason for authentication failure', async () => {
  const { root, script } = await fixture();
  try {
    await writeFile(script, `process.stderr.write('401 login required Bearer should-not-persist'); process.exit(1);`);
    const adapter = createCloudKnowledgeAdapter({ python: process.execPath, script, env: process.env });
    const outcome = await adapter.search({ outputDir: root, query: '巡检流程', limit: 10 });
    assert.equal(outcome.status, 'auth_required');
    assert.equal(outcome.reasonCode, 'AUTH_REQUIRED');
    const metadata = JSON.parse(await readFile(join(root, 'raw/metadata.json'), 'utf8'));
    assert.equal(metadata.sourceMetadata.terminal.status, 'auth_required');
    assert.equal(metadata.sourceMetadata.terminal.reasonCode, 'AUTH_REQUIRED');
    assert.doesNotMatch(JSON.stringify(metadata), /Bearer should-not-persist|login required/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cloud knowledge materialization can retry a failed item without redownloading successful items', async () => {
  const { root, script } = await fixture();
  try {
    const adapter = createCloudKnowledgeAdapter({ python: process.execPath, script, env: process.env });
    const discovered = await adapter.search({ outputDir: root, query: '巡检流程', limit: 10 });
    assert.equal(discovered.status, 'complete');
    const metadata = JSON.parse(await readFile(join(root, 'sanitized/metadata.json'), 'utf8'));
    const itemId = metadata.collection.items[0].itemId;
    await writeFile(script, `process.exit(2);`);
    const failed = await adapter.materialize({ sessionDir: root, outputDir: root, itemIds: [itemId] });
    assert.equal(failed.status, 'failed');
    await writeFile(script, `
import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2); const output = args[args.indexOf('--output') + 1];
if (args[0] === 'download') { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, '# retry ok\\n'); process.stdout.write(JSON.stringify({ ok: true })); }
`);
    const retried = await adapter.materialize({ sessionDir: root, outputDir: root, itemIds: [itemId] });
    assert.equal(retried.status, 'complete');
    assert.equal(retried.counts.materialized, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
