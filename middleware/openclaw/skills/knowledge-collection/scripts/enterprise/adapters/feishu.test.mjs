import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { createFeishuAdapter } from './feishu.mjs';
import { executable, readJson, runNode, tempCase } from '../test-helpers.mjs';

const knowledgeCollectionScript = resolve(dirname(new URL(import.meta.url).pathname), '../../knowledge-collection.mjs');

async function larkFixture(root) {
  return executable(root, 'lark-cli', `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
const valueFor = (flag) => args[args.indexOf(flag) + 1];
const expected = ['minutes', '+detail', '--minute-tokens', '--transcript', '--output-dir', '--as', 'user', '--format', 'json'];
if (expected.some((token) => !args.includes(token))) process.exit(12);
const outputDir = valueFor('--output-dir');
if (!outputDir || valueFor('--minute-tokens') !== process.env.FIXTURE_TOKEN) process.exit(13);
mkdirSync(outputDir, { recursive: true });
if (process.env.FIXTURE_MODE === 'one') writeFileSync(join(outputDir, 'transcript.md'), '# Transcript\\n\\nHello.\\n');
if (process.env.FIXTURE_MODE === 'multiple') {
  writeFileSync(join(outputDir, 'first.md'), 'First');
  writeFileSync(join(outputDir, 'second.markdown'), 'Second');
}
if (process.env.FIXTURE_MODE === 'empty') writeFileSync(join(outputDir, 'transcript.md'), '   \\n');
if (process.env.FIXTURE_MODE === 'nonzero') {
  process.stderr.write('detail unavailable\\n');
  process.exit(7);
}
console.log(JSON.stringify({ ok: true, data: { minute_token: valueFor('--minute-tokens') } }));
`);
}

async function collect(mode, request = {}) {
  const testCase = await tempCase('feishu-adapter-');
  const outputDir = join(testCase.root, `output-${mode}`);
  const bin = await larkFixture(testCase.root);
  const minuteToken = request.minuteToken || 'minute-token';
  const url = request.url || 'https://example.feishu.cn/minutes/minute-token';
  const result = await createFeishuAdapter({
    bin,
    env: { FIXTURE_MODE: mode, FIXTURE_TOKEN: minuteToken },
  }).collectResource({ resourceKind: 'minutes', minuteToken, url, outputDir });
  return { ...testCase, outputDir, result, minuteToken, url };
}

test('materializes the one real CLI transcript into a canonical Feishu bundle', async () => {
  const fixture = await collect('one', {
    minuteToken: 'minute/with path',
    url: 'https://example.feishu.cn/minutes/minute/with-path',
  });
  try {
    assert.equal(fixture.result.status, 'complete');
    assert.match(await readFile(join(fixture.outputDir, 'markdown/transcript.md'), 'utf8'), /Hello/);
    assert.match(await readFile(join(fixture.outputDir, 'sanitized/items/transcript.md'), 'utf8'), /Hello/);
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'complete');
    assert.equal(metadata.collection.items[0].sourceItemId, fixture.minuteToken);
    const collection = await readJson(join(fixture.outputDir, 'collection-result.json'));
    assert.deepEqual(collection.items[0], {
      title: 'Feishu Minutes Transcript',
      url: fixture.url,
      author: '',
      publishTime: '',
      markdown: 'sanitized/items/transcript.md',
      fileName: 'sanitized/items/transcript.md',
    });
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('returns partial when the CLI creates no transcript', async () => {
  const fixture = await collect('none');
  try {
    assert.equal(fixture.result.status, 'partial');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'partial');
    assert.equal(metadata.collection.items[0].materialization.status, 'pending');
    const inspected = await runNode(knowledgeCollectionScript, [
      'inspect', '--session-dir', fixture.outputDir, '--full',
    ]);
    assert.equal(inspected.code, 0, inspected.stderr || inspected.stdout);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('returns partial when the CLI creates multiple transcripts', async () => {
  const fixture = await collect('multiple');
  try {
    assert.equal(fixture.result.status, 'partial');
    assert.match((await readJson(join(fixture.outputDir, 'sanitized/metadata.json'))).collection.items[0].materialization.reason, /expected one/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('returns partial when the CLI transcript is empty', async () => {
  const fixture = await collect('empty');
  try {
    assert.equal(fixture.result.status, 'partial');
    assert.match((await readJson(join(fixture.outputDir, 'sanitized/metadata.json'))).collection.items[0].materialization.reason, /empty/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('persists failed CLI evidence when lark-cli exits nonzero', async () => {
  const fixture = await collect('nonzero');
  try {
    assert.equal(fixture.result.status, 'failed');
    const metadata = await readJson(join(fixture.outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'failed');
    const evidence = await readJson(join(fixture.outputDir, metadata.collection.items[0].rawArtifacts.find((path) => path.startsWith('raw/failed-'))));
    assert.equal(evidence.exitCode, 7);
    assert.match(evidence.stderr, /detail unavailable/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
