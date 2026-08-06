import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const scriptPath = resolve(dirname(new URL(import.meta.url).pathname), 'enterprise-collection.mjs');

function run(command, args, env) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

async function createWecomFixture(root, businessFailure = false) {
  const fixturePath = join(root, 'wecom-cli');
  const source = `#!/usr/bin/env node
const { existsSync, writeFileSync } = require('node:fs');
const stateFile = process.env.WECOM_FIXTURE_STATE;
const command = process.argv[3];
const envelope = (business) => JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify(business) }] }, isError: false });
if (command === 'smartpage_export_task') {
  console.log(envelope(${businessFailure ? "{ errcode: 93001, errmsg: 'denied' }" : "{ errcode: 0, task_id: 'task-1' }"}));
  process.exit(0);
}
if (command === 'smartpage_get_export_result') {
  if (!existsSync(stateFile)) {
    writeFileSync(stateFile, 'polled');
    console.log(envelope({ errcode: 0, task_done: false }));
  } else {
    console.log(envelope({ errcode: 0, task_done: true, content: '# Exported smartpage\\n\\nBody' }));
  }
  process.exit(0);
}
process.exit(2);
`;
  await writeFile(fixturePath, source, { mode: 0o700 });
  await chmod(fixturePath, 0o700);
  return fixturePath;
}

async function createLarkFixture(root) {
  const fixturePath = join(root, 'lark-cli');
  const source = `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
const valueFor = (flag) => args[args.indexOf(flag) + 1];
const required = ['minutes', '+detail', '--minute-tokens', '--transcript', '--as', 'user', '--format', 'json', '--output-dir'];
if (required.some((token) => !args.includes(token)) || valueFor('--minute-tokens') !== 'minute-1') process.exit(2);
const outputDir = valueFor('--output-dir');
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'actual-transcript.md'), 'Speaker A [00:00]\\nHello from the real transcript.\\n');
console.log(JSON.stringify({ ok: true, data: { minute_token: 'minute-1' } }));
`;
  await writeFile(fixturePath, source, { mode: 0o700 });
  await chmod(fixturePath, 0o700);
  return fixturePath;
}

async function assertMode(path, expected) {
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, expected, `${path} mode`);
}

async function assertPrivateTree(root) {
  await assertMode(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await assertPrivateTree(path);
    } else {
      await assertMode(path, 0o600);
    }
  }
}

async function testWecomExportWritesCanonicalPrivateArtifacts() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-test-'));
  const outputDir = join(tempRoot, 'output');
  try {
    const fixture = await createWecomFixture(tempRoot);
    const result = await run(process.execPath, [scriptPath, 'wecom-smartpage', '--url', 'https://doc.weixin.qq.com/smartpage/x', '--output-dir', outputDir], {
      WECOM_CLI_BIN: fixture,
      WECOM_FIXTURE_STATE: join(tempRoot, 'wecom-state'),
    });
    assert.equal(result.code, 0, result.stderr);
    for (const relativePath of [
      'raw/export-task.json',
      'raw/poll-1.json',
      'raw/poll-2.json',
      'markdown/document.md',
      'sanitized/items/document.md',
      'sanitized/metadata.json',
      'collection-result.json',
    ]) {
      await stat(join(outputDir, relativePath));
    }
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.schemaVersion, '1.0');
    assert.deepEqual(metadata.storage, { fallback: false });
    assert.equal(metadata.collection.status, 'complete');
    assert.equal(metadata.collection.items.length, 1);
    assert.equal(metadata.collection.items[0].sourceSkill, 'wecomcli');
    assert.equal(metadata.collection.items[0].materialization.markdownPath, 'markdown/document.md');
    assert.equal(metadata.collection.items[0].materialization.sanitizedPath, 'sanitized/items/document.md');
    assert.deepEqual(metadata.retention, { auditRequired: false, userRequested: false });
    assert.deepEqual(metadata.postProcessing.runs, []);
    assert.equal(metadata.sourceMetadata.scope, 'bot-visible');
    assert.ok(metadata.sourceMetadata.backendCliVersion);
    const collection = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.deepEqual(Object.keys(collection).sort(), ['backend', 'filters', 'items', 'schemaVersion', 'source', 'title', 'url']);
    assert.equal(collection.items.length, 1);
    assert.equal(collection.items[0].markdown, 'sanitized/items/document.md');
    assert.equal(collection.items[0].fileName, 'sanitized/items/document.md');
    await assertPrivateTree(outputDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testWecomRejectsNestedBusinessFailure() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-test-'));
  const outputDir = join(tempRoot, 'output');
  try {
    const fixture = await createWecomFixture(tempRoot, true);
    const result = await run(process.execPath, [scriptPath, 'wecom-smartpage', '--url', 'https://doc.weixin.qq.com/smartpage/x', '--output-dir', outputDir], {
      WECOM_CLI_BIN: fixture,
      WECOM_FIXTURE_STATE: join(tempRoot, 'wecom-state'),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /errcode 93001/);
    await assert.rejects(stat(join(outputDir, 'collection-result.json')));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testFeishuMinutesReadsCliCreatedTranscript() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-test-'));
  const outputDir = join(tempRoot, 'output');
  try {
    const fixture = await createLarkFixture(tempRoot);
    const result = await run(process.execPath, [
      scriptPath,
      'feishu-minutes',
      '--minute-token',
      'minute-1',
      '--url',
      'https://example.feishu.cn/minutes/minute-1',
      '--output-dir',
      outputDir,
    ], { LARK_CLI_BIN: fixture });
    assert.equal(result.code, 0, result.stderr);
    for (const relativePath of [
      'raw/detail.json',
      'raw/minutes/actual-transcript.md',
      'markdown/transcript.md',
      'sanitized/items/transcript.md',
      'sanitized/metadata.json',
      'collection-result.json',
    ]) {
      await stat(join(outputDir, relativePath));
    }
    const normalized = await readFile(join(outputDir, 'sanitized/items/transcript.md'), 'utf8');
    assert.match(normalized, /Speaker A \[00:00\]/);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.schemaVersion, '1.0');
    assert.equal(metadata.collection.items[0].sourceSkill, 'fws');
    assert.equal(metadata.collection.items[0].sourceItemId, 'minute-1');
    assert.equal(metadata.collection.items[0].materialization.sanitizedPath, 'sanitized/items/transcript.md');
    assert.deepEqual(metadata.postProcessing.runs, []);
    const collection = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.equal(collection.source, 'fws');
    assert.equal(collection.backend, 'lark-cli');
    assert.equal(collection.items[0].markdown, 'sanitized/items/transcript.md');
    await assertPrivateTree(outputDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await testWecomExportWritesCanonicalPrivateArtifacts();
await testWecomRejectsNestedBusinessFailure();
await testFeishuMinutesReadsCliCreatedTranscript();
console.log('enterprise collection fixture tests passed');
