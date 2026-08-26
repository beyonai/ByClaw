import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import * as enterpriseCollection from './enterprise-collection.mjs';
import { ensureSessionSkeleton, newSession } from './session.mjs';

const scriptPath = resolve(dirname(new URL(import.meta.url).pathname), 'enterprise-collection.mjs');
const collectionScriptPath = resolve(dirname(new URL(import.meta.url).pathname), 'knowledge-collection.mjs');

async function createParentSession(root, sourceScope) {
  const parent = join(root, 'parent-session');
  ensureSessionSkeleton(parent);
  await writeFile(join(parent, 'session.json'), `${JSON.stringify(newSession({
    query: 'enterprise test', sourceScope, materializationTarget: 'candidates',
  }))}\n`);
  return parent;
}

await (async () => {
  assert.equal(typeof enterpriseCollection.assertEnterpriseScope, 'function');
  const root = await mkdtemp(join(tmpdir(), 'enterprise-scope-'));
  try {
    ensureSessionSkeleton(root);
    await writeFile(join(root, 'session.json'), `${JSON.stringify(newSession({
      query: 'enterprise', sourceScope: ['ima'], materializationTarget: 'candidates',
    }))}\n`);
    assert.doesNotThrow(() => enterpriseCollection.assertEnterpriseScope(root, ['ima']));
    assert.throws(
      () => enterpriseCollection.assertEnterpriseScope(root, ['feishu']),
      /sourceScope.*feishu/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS enterprise command boundary enforces parent source scope');
})();

await (async () => {
  const { createArtifactWriter } = await import('./enterprise/shared/artifact-writer.mjs');
  const root = await mkdtemp(join(tmpdir(), 'enterprise-search-all-aggregate-'));
  const outputRoot = join(root, 'output');
  try {
    const aggregateWriter = await createArtifactWriter(outputRoot);
    const sourceDir = join(outputRoot, 'ima');
    const sourceWriter = await createArtifactWriter(sourceDir);
    await sourceWriter.writeJson('raw/candidate.json', { id: 'candidate-1' });
    await sourceWriter.writeCollectionBundle({
      title: 'IMA candidates', query: 'Q3 policy', source: 'ima', backend: 'ima',
      url: 'https://ima.example.test/search', filters: { query: 'Q3 policy' },
      metadataOnly: true,
      inventory: [{
        itemId: 'candidate-1', title: 'Policy', sourceUrl: 'https://ima.example.test/item/1',
        sourceItemId: '1', sourceSkill: 'ima-skill', backend: 'ima', collectionFilters: {},
        rawArtifacts: ['raw/candidate.json'],
        materialization: {
          status: 'pending', markdownPath: null, sanitizedPath: null,
          pendingArtifactCleanup: [], reason: 'metadata-only',
        },
      }],
      canonicalItems: [], sourceMetadata: {},
    });
    const outcomes = [{
      source: 'ima', sessionDir: sourceDir,
      outcome: { status: 'complete', counts: { discovered: 1, materialized: 0, pending: 1, failed: 0 } },
    }];
    await enterpriseCollection.writeSearchAllAggregate({
      aggregateWriter, outputRoot, query: 'Q3 policy', sources: ['ima'], metadataOnly: true, outcomes,
    });
    const status = await run(process.execPath, [collectionScriptPath, 'status', '--session-dir', outputRoot]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    const parsed = JSON.parse(status.stdout);
    assert.deepEqual(parsed.task.sourceScope, ['ima']);
    assert.equal(parsed.task.materializationTarget, 'candidates');
    assert.equal(parsed.collection.deliveryComplete, true);
    assert.deepEqual(parsed.downstreamInput.files, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS search-all aggregate is a canonical statusable session');
})();

await (async () => {
  const { createArtifactWriter } = await import('./enterprise/shared/artifact-writer.mjs');
  const root = await mkdtemp(join(tmpdir(), 'enterprise-search-all-missing-bundle-'));
  const outputRoot = join(root, 'output');
  try {
    const aggregateWriter = await createArtifactWriter(outputRoot);
    await enterpriseCollection.writeSearchAllAggregate({
      aggregateWriter,
      outputRoot,
      query: 'missing result',
      sources: ['ima'],
      metadataOnly: true,
      outcomes: [{
        source: 'ima', sessionDir: join(outputRoot, 'missing-ima'),
        outcome: { status: 'complete', counts: { discovered: 1, materialized: 0, pending: 1, failed: 0 } },
      }],
    });
    const status = await run(process.execPath, [collectionScriptPath, 'status', '--session-dir', outputRoot]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    const parsed = JSON.parse(status.stdout);
    assert.equal(parsed.collection.collectionStatus, 'failed');
    assert.equal(parsed.collection.deliveryComplete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS missing search-all child bundle cannot report complete');
})();

await (async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-legacy-scope-'));
  try {
    const result = await run(process.execPath, [
      scriptPath, 'wecom-smartpage', '--url', 'https://doc.weixin.qq.com/smartpage/x',
      '--output-dir', join(root, 'output'),
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /parent-session-dir/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS legacy enterprise execution also requires parent scope');
})();

await (async () => {
  const { createArtifactWriter } = await import('./enterprise/shared/artifact-writer.mjs');
  const root = await mkdtemp(join(tmpdir(), 'enterprise-search-all-symlink-'));
  const outputRoot = join(root, 'output');
  try {
    const aggregateWriter = await createArtifactWriter(outputRoot);
    const sourceDir = join(outputRoot, 'ima');
    const sourceWriter = await createArtifactWriter(sourceDir);
    await sourceWriter.writeText('markdown/item.md', '# Safe\n');
    await sourceWriter.writeText('sanitized/items/item.md', '# Safe\n');
    await sourceWriter.writeCollectionBundle({
      title: 'IMA body', source: 'ima', backend: 'ima', url: 'ima://item/1', filters: {},
      inventory: [{
        itemId: 'item-1', title: 'Item', sourceUrl: 'ima://item/1', sourceItemId: '1',
        sourceSkill: 'ima-skill', backend: 'ima', collectionFilters: {}, rawArtifacts: [],
        materialization: {
          status: 'materialized', markdownPath: 'markdown/item.md',
          sanitizedPath: 'sanitized/items/item.md', pendingArtifactCleanup: [], reason: null,
        },
      }],
      canonicalItems: [{
        title: 'Item', url: 'ima://item/1', author: '', publishTime: '',
        markdown: 'sanitized/items/item.md', fileName: 'sanitized/items/item.md',
      }],
      sourceMetadata: {},
    });
    const outside = join(root, 'outside.md');
    await writeFile(outside, '# Outside\n');
    await unlink(join(sourceDir, 'sanitized/items/item.md'));
    await symlink(outside, join(sourceDir, 'sanitized/items/item.md'));
    await assert.rejects(
      enterpriseCollection.writeSearchAllAggregate({
        aggregateWriter, outputRoot, query: 'item', sources: ['ima'], metadataOnly: false,
        outcomes: [{ source: 'ima', sessionDir: sourceDir, outcome: { status: 'complete' } }],
      }),
      /symbolic link|outside source session/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS search-all rejects child work-copy symlink escapes');
})();

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
const envelope = (business) => JSON.stringify({ jsonrpc: '2.0', access_token: 'fixture-secret', result: { content: [{ type: 'text', text: JSON.stringify(business) }] }, isError: false });
if (command === 'smartpage_export_task') {
  console.log(envelope(${businessFailure ? "{ errcode: 93001, errmsg: 'denied' }" : "{ errcode: 0, task_id: 'task-1', credential: 'nested-secret' }"}));
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

async function testScriptHasValidSyntax() {
  const result = await run(process.execPath, ['--check', scriptPath]);
  assert.equal(result.code, 0, result.stderr);
}

async function testSearchFailsWhenTheDwsExecutableCannotStart() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-missing-dws-'));
  const outputDir = join(tempRoot, 'output');
  try {
    const parent = await createParentSession(tempRoot, ['dingtalk']);
    const result = await run(process.execPath, [scriptPath, 'search', '--parent-session-dir', parent, '--source', 'dingtalk', '--query', 'probe', '--output-dir', outputDir], {
      DWS_HOME: join(tempRoot, 'dws-home'),
      DWS_CLI_BIN: join(tempRoot, 'missing-dws'),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /failed to start: ENOENT/);
    await assert.rejects(stat(outputDir), { code: 'ENOENT' });
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
}

async function testSearchFailsWhenTheFwsExecutableCannotStart() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-missing-fws-'));
  const outputDir = join(tempRoot, 'output');
  try {
    const parent = await createParentSession(tempRoot, ['feishu']);
    const result = await run(process.execPath, [scriptPath, 'search', '--parent-session-dir', parent, '--source', 'feishu', '--query', 'probe', '--output-dir', outputDir], {
      LARK_HOME: join(tempRoot, 'lark-home'),
      LARK_CLI_BIN: join(tempRoot, 'missing-lark-cli'),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /failed to start: ENOENT/);
    await assert.rejects(stat(outputDir), { code: 'ENOENT' });
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
}

async function testSearchFailsWhenConnectorHomeIsMissing() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-missing-home-'));
  try {
    const parent = await createParentSession(tempRoot, ['dingtalk', 'feishu']);
    for (const [source, home] of [['dingtalk', 'DWS_HOME'], ['feishu', 'LARK_HOME']]) {
      const outputDir = join(tempRoot, `${source}-output`);
      const result = await run(process.execPath, [scriptPath, 'search', '--parent-session-dir', parent, '--source', source, '--query', 'probe', '--output-dir', outputDir], {
        DWS_HOME: '',
        LARK_HOME: '',
      });
      assert.notEqual(result.code, 0, `${source} missing ${home} must fail the command`);
      await assert.rejects(stat(outputDir), { code: 'ENOENT' });
    }
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
}

async function testWecomExportWritesCanonicalPrivateArtifacts() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-test-'));
  const outputDir = join(tempRoot, 'output');
  try {
    const fixture = await createWecomFixture(tempRoot);
    const parent = await createParentSession(tempRoot, ['wecom']);
    const result = await run(process.execPath, [scriptPath, 'wecom-smartpage', '--parent-session-dir', parent, '--url', 'https://doc.weixin.qq.com/smartpage/x', '--output-dir', outputDir], {
      WECOM_CLI_BIN: fixture,
      WECOM_FIXTURE_STATE: join(tempRoot, 'wecom-state'),
      WECOM_HOME: join(tempRoot, 'wecom-home'),
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
    assert.equal(metadata.retention, undefined);
    assert.equal(metadata.postProcessing, undefined);
    assert.equal(metadata.sourceMetadata.scope, 'bot-visible');
    assert.ok(metadata.sourceMetadata.backendCliVersion);
    const collection = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.deepEqual(Object.keys(collection).sort(), ['backend', 'filters', 'items', 'schemaVersion', 'source', 'title', 'url']);
    assert.equal(collection.items.length, 1);
    assert.equal(collection.items[0].markdown, 'sanitized/items/document.md');
    assert.equal(collection.items[0].fileName, 'sanitized/items/document.md');
    const raw = await readFile(join(outputDir, 'raw/export-task.json'), 'utf8');
    assert.doesNotMatch(raw, /fixture-secret/);
    assert.doesNotMatch(raw, /nested-secret/);
    await assertPrivateTree(outputDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testWecomTimeoutPersistsPartialMetadata() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-partial-'));
  const outputDir = join(tempRoot, 'output');
  const fixturePath = join(tempRoot, 'wecom-cli');
  const source = `#!/usr/bin/env node
const command = process.argv[3];
const envelope = (business) => JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify(business) }] }, isError: false });
if (command === 'smartpage_export_task') console.log(envelope({ errcode: 0, task_id: 'task-timeout' }));
else if (command === 'smartpage_get_export_result') console.log(envelope({ errcode: 0, task_done: false }));
else process.exit(2);
`;
  try {
    await writeFile(fixturePath, source, { mode: 0o700 });
    await chmod(fixturePath, 0o700);
    const parent = await createParentSession(tempRoot, ['wecom']);
    const result = await run(process.execPath, [scriptPath, 'wecom-smartpage', '--parent-session-dir', parent, '--url', 'https://doc.weixin.qq.com/smartpage/x', '--output-dir', outputDir], {
      WECOM_CLI_BIN: fixturePath,
      KNOWLEDGE_COLLECTION_MAX_WECOM_POLLS: '2',
      WECOM_HOME: join(tempRoot, 'wecom-home'),
    });
    assert.notEqual(result.code, 0);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.status, 'partial');
    assert.equal(metadata.collection.items[0].materialization.status, 'pending');
    const collection = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.deepEqual(collection.items, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testEnterpriseCliTimeoutIsBounded() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-timeout-'));
  const outputDir = join(tempRoot, 'output');
  const fixturePath = join(tempRoot, 'hang-cli');
  try {
    await writeFile(fixturePath, '#!/usr/bin/env node\nsetTimeout(() => {}, 1000);\n', { mode: 0o700 });
    await chmod(fixturePath, 0o700);
    const parent = await createParentSession(tempRoot, ['wecom']);
    const started = Date.now();
    const result = await run(process.execPath, [scriptPath, 'wecom-smartpage', '--parent-session-dir', parent, '--url', 'https://doc.weixin.qq.com/smartpage/x', '--output-dir', outputDir], {
      WECOM_CLI_BIN: fixturePath,
      KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS: '50',
      WECOM_HOME: join(tempRoot, 'wecom-home'),
    });
    assert.notEqual(result.code, 0);
    assert.ok(Date.now() - started < 500, `CLI timeout took ${Date.now() - started}ms`);
    assert.match(result.stderr, /超时|timeout/i);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.status, 'failed');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testEnterpriseRunnerDoesNotReuseExistingOutputDir() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-owner-'));
  const outputDir = join(tempRoot, 'output');
  const fixture = await createWecomFixture(tempRoot);
  try {
    const parent = await createParentSession(tempRoot, ['wecom']);
    await mkdir(outputDir);
    await writeFile(join(outputDir, 'sentinel'), 'preserve');
    const result = await run(process.execPath, [
      scriptPath, 'wecom-smartpage', '--parent-session-dir', parent,
      '--url', 'https://doc.weixin.qq.com/smartpage/x', '--output-dir', outputDir,
    ], { WECOM_CLI_BIN: fixture, WECOM_FIXTURE_STATE: join(tempRoot, 'wecom-state'), WECOM_HOME: join(tempRoot, 'wecom-home') });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /must not already exist/);
    assert.equal(await readFile(join(outputDir, 'sentinel'), 'utf8'), 'preserve');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testWecomRejectsNestedBusinessFailure() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-test-'));
  const outputDir = join(tempRoot, 'output');
  try {
    const fixture = await createWecomFixture(tempRoot, true);
    const parent = await createParentSession(tempRoot, ['wecom']);
    const result = await run(process.execPath, [scriptPath, 'wecom-smartpage', '--parent-session-dir', parent, '--url', 'https://doc.weixin.qq.com/smartpage/x', '--output-dir', outputDir], {
      WECOM_CLI_BIN: fixture,
      WECOM_FIXTURE_STATE: join(tempRoot, 'wecom-state'),
      WECOM_HOME: join(tempRoot, 'wecom-home'),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /errcode 93001/);
    const collection = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.deepEqual(collection.items, []);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.status, 'failed');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testWecomMissingTaskIdPersistsFailedMetadata() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-missing-task-'));
  const outputDir = join(tempRoot, 'output');
  const fixturePath = join(tempRoot, 'wecom-cli');
  const source = `#!/usr/bin/env node
const envelope = (business) => JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify(business) }] }, isError: false });
console.log(envelope({ errcode: 0 }));
`;
  try {
    await writeFile(fixturePath, source, { mode: 0o700 });
    await chmod(fixturePath, 0o700);
    const parent = await createParentSession(tempRoot, ['wecom']);
    const result = await run(process.execPath, [
      scriptPath,
      'wecom-smartpage',
      '--parent-session-dir',
      parent,
      '--url',
      'https://doc.weixin.qq.com/smartpage/missing-task',
      '--output-dir',
      outputDir,
    ], { WECOM_CLI_BIN: fixturePath, WECOM_HOME: join(tempRoot, 'wecom-home') });
    assert.notEqual(result.code, 0);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.status, 'failed');
    assert.deepEqual(metadata.collection.items[0].rawArtifacts, [
      'raw/export-task.json',
      'raw/metadata.json',
    ]);
    const collection = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.deepEqual(collection.items, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testFeishuMinutesReadsCliCreatedTranscript() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-test-'));
  const outputDir = join(tempRoot, 'output');
  try {
    const fixture = await createLarkFixture(tempRoot);
    const parent = await createParentSession(tempRoot, ['feishu']);
    const result = await run(process.execPath, [
      scriptPath,
      'feishu-minutes',
      '--parent-session-dir',
      parent,
      '--minute-token',
      'minute-1',
      '--url',
      'https://example.feishu.cn/minutes/minute-1',
      '--output-dir',
      outputDir,
    ], { LARK_CLI_BIN: fixture, LARK_HOME: join(tempRoot, 'lark-home') });
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
    assert.equal(metadata.postProcessing, undefined);
    const collection = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.equal(collection.source, 'fws');
    assert.equal(collection.backend, 'lark-cli');
    assert.equal(collection.items[0].markdown, 'sanitized/items/transcript.md');
    await assertPrivateTree(outputDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testFeishuCliFailurePersistsFailedMetadata() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-feishu-failed-'));
  const outputDir = join(tempRoot, 'output');
  const fixturePath = join(tempRoot, 'lark-cli');
  try {
    await writeFile(fixturePath, '#!/usr/bin/env node\nprocess.exit(3);\n', { mode: 0o700 });
    await chmod(fixturePath, 0o700);
    const parent = await createParentSession(tempRoot, ['feishu']);
    const result = await run(process.execPath, [
      scriptPath,
      'feishu-minutes',
      '--parent-session-dir',
      parent,
      '--minute-token',
      'minute-failed',
      '--url',
      'https://example.feishu.cn/minutes/minute-failed',
      '--output-dir',
      outputDir,
    ], { LARK_CLI_BIN: fixturePath, LARK_HOME: join(tempRoot, 'lark-home') });
    assert.notEqual(result.code, 0);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.status, 'failed');
    assert.equal(metadata.collection.items[0].materialization.status, 'failed');
    const collection = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.deepEqual(collection.items, []);
    await assertPrivateTree(outputDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testFeishuMissingTranscriptPersistsPartialMetadata() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'enterprise-collection-feishu-partial-'));
  const outputDir = join(tempRoot, 'output');
  const fixturePath = join(tempRoot, 'lark-cli');
  try {
    await writeFile(fixturePath, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ ok: true }));\n', { mode: 0o700 });
    await chmod(fixturePath, 0o700);
    const parent = await createParentSession(tempRoot, ['feishu']);
    const result = await run(process.execPath, [
      scriptPath,
      'feishu-minutes',
      '--parent-session-dir',
      parent,
      '--minute-token',
      'minute-partial',
      '--url',
      'https://example.feishu.cn/minutes/minute-partial',
      '--output-dir',
      outputDir,
    ], { LARK_CLI_BIN: fixturePath, LARK_HOME: join(tempRoot, 'lark-home') });
    assert.notEqual(result.code, 0);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.status, 'partial');
    assert.equal(metadata.collection.items[0].materialization.status, 'pending');
    assert.deepEqual(metadata.collection.items[0].rawArtifacts, ['raw/detail.json', 'raw/metadata.json']);
    const collection = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.deepEqual(collection.items, []);
    await assertPrivateTree(outputDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await testScriptHasValidSyntax();
await testSearchFailsWhenTheDwsExecutableCannotStart();
await testSearchFailsWhenTheFwsExecutableCannotStart();
await testSearchFailsWhenConnectorHomeIsMissing();
await testWecomExportWritesCanonicalPrivateArtifacts();
await testWecomRejectsNestedBusinessFailure();
await testWecomMissingTaskIdPersistsFailedMetadata();
await testWecomTimeoutPersistsPartialMetadata();
await testEnterpriseCliTimeoutIsBounded();
await testEnterpriseRunnerDoesNotReuseExistingOutputDir();
await testFeishuMinutesReadsCliCreatedTranscript();
await testFeishuCliFailurePersistsFailedMetadata();
await testFeishuMissingTranscriptPersistsPartialMetadata();
console.log('enterprise collection fixture tests passed');
