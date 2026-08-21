import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dispatchEnterprise, dispatchEnterpriseBatch, parseMaterializeRequest, parseResourceRequest, parseSearchRequest } from './dispatcher.mjs';
import * as dispatcher from './dispatcher.mjs';
import { createArtifactWriter } from './shared/artifact-writer.mjs';
import { assertPrivateTree } from './test-helpers.mjs';
import { parseArgs } from '../enterprise-collection.mjs';

test('parseSearchRequest applies bounded defaults and source option allowlists', () => {
  assert.deepEqual(parseSearchRequest({
    source: 'dingtalk',
    query: 'quarterly plan',
    'output-dir': '/tmp/enterprise-search',
    extensions: 'docx,pdf',
    'folder-id': 'folder-1',
  }), {
    source: 'dingtalk',
    query: 'quarterly plan',
    outputDir: '/tmp/enterprise-search',
    limit: 50,
    concurrency: 4,
    cursor: null,
    metadataOnly: false,
    sourceOptions: { extensions: ['docx', 'pdf'], folderId: 'folder-1' },
  });

  assert.deepEqual(parseSearchRequest({
    source: 'feishu', query: 'minutes', 'output-dir': '/tmp/feishu', limit: '500', concurrency: '16',
    cursor: 'next', 'metadata-only': 'true', 'space-id': 'space-1', 'file-types': 'docx,sheet',
  }), {
    source: 'feishu', query: 'minutes', outputDir: '/tmp/feishu', limit: 500, concurrency: 16,
    cursor: 'next', metadataOnly: true, sourceOptions: { spaceId: 'space-1', fileTypes: ['docx', 'sheet'] },
  });
});

test('request parsers reject invalid, foreign, and sensitive source options', () => {
  for (const args of [
    { source: 'wecom', query: 'q', 'output-dir': 'relative' },
    { source: 'wecom', query: 'q', 'output-dir': '/tmp/out', limit: '501' },
    { source: 'feishu', query: 'q', 'output-dir': '/tmp/out', 'workspace-ids': 'a' },
    { source: 'dingtalk', query: 'q', 'output-dir': '/tmp/out', token: 'secret' },
  ]) {
    assert.throws(() => parseSearchRequest(args));
  }
  assert.throws(() => parseResourceRequest({
    source: 'wecom', 'output-dir': '/tmp/out', url: 'https://doc.weixin.qq.com/doc/a', 'minute-token': 'secret',
  }));
  assert.throws(() => parseSearchRequest({
    source: 'dingtalk', query: 'q', 'output-dir': '/tmp/out', 'folder-id': 'folder-1', 'workspace-ids': 'workspace-1',
  }), /workspace-ids.*folder-id/);
});

test('search accepts bare metadata-only and validates whitelisted JSON source options', () => {
  const parsedArgs = parseArgs(['search', '--source', 'dingtalk', '--metadata-only', '--source-options', '{"extensions":["docx"],"folderId":"folder-1"}']);
  assert.equal(parsedArgs.values['metadata-only'], true);
  assert.deepEqual(parseSearchRequest({
    ...parsedArgs.values,
    query: 'quarterly plan',
    'output-dir': '/tmp/enterprise-search',
  }).sourceOptions, { extensions: ['docx'], folderId: 'folder-1' });

  for (const sourceOptions of [
    '{"workspaceIds":"a"}',
    '{"workspaceIds":["a",2]}',
    '["workspaceIds"]',
    '{"access_token":"secret"}',
  ]) {
    assert.throws(() => parseSearchRequest({
      source: 'dingtalk', query: 'q', 'output-dir': '/tmp/out', 'source-options': sourceOptions,
    }));
  }
});

test('parseResourceRequest enforces source-specific resource fields', () => {
  assert.deepEqual(parseResourceRequest({
    source: 'wecom', 'output-dir': '/tmp/wecom', url: 'https://doc.weixin.qq.com/doc/a',
  }), {
    source: 'wecom', outputDir: '/tmp/wecom', url: 'https://doc.weixin.qq.com/doc/a', sourceOptions: {},
  });
  assert.deepEqual(parseResourceRequest({
    source: 'feishu', 'output-dir': '/tmp/feishu', url: 'https://example.feishu.cn/minutes/m1', 'minute-token': 'm1',
  }), {
    source: 'feishu', outputDir: '/tmp/feishu', url: 'https://example.feishu.cn/minutes/m1',
    sourceOptions: { minuteToken: 'm1' },
  });
  assert.throws(() => parseResourceRequest({ source: 'wecom', 'output-dir': '/tmp/out', url: 'not-a-url' }));
  assert.throws(() => parseResourceRequest({ source: 'feishu', 'output-dir': '/tmp/out', url: 'https://example.feishu.cn/minutes/m1' }));
});

test('parseMaterializeRequest requires a new output session and explicit candidate IDs', () => {
  assert.deepEqual(parseMaterializeRequest({
    source: 'dingtalk', 'session-dir': '/tmp/discovery', 'output-dir': '/tmp/materialized', 'item-ids': 'dws-a,dws-b', concurrency: '2',
  }), {
    source: 'dingtalk', sessionDir: '/tmp/discovery', outputDir: '/tmp/materialized', itemIds: ['dws-a', 'dws-b'], concurrency: 2,
  });
  for (const values of [
    { source: 'dingtalk', 'session-dir': '/tmp/discovery', 'output-dir': '/tmp/materialized', 'item-ids': '' },
    { source: 'dingtalk', 'session-dir': 'relative', 'output-dir': '/tmp/materialized', 'item-ids': 'dws-a' },
    { source: 'wecom', 'session-dir': '/tmp/discovery', 'output-dir': '/tmp/materialized', 'item-ids': 'wecom-a' },
  ]) assert.throws(() => parseMaterializeRequest(values));
});

test('parseSearchBatchRequests defaults to metadata-only sessions for every enterprise connector', () => {
  assert.equal(typeof dispatcher.parseSearchBatchRequests, 'function');
  assert.deepEqual(dispatcher.parseSearchBatchRequests({
    query: 'quarterly plan', 'output-root': '/tmp/enterprise-batch', limit: '10',
  }), [
    { source: 'dingtalk', query: 'quarterly plan', 'output-dir': '/tmp/enterprise-batch/dingtalk', limit: '10', 'metadata-only': true },
    { source: 'feishu', query: 'quarterly plan', 'output-dir': '/tmp/enterprise-batch/feishu', limit: '10', 'metadata-only': true },
    { source: 'wecom', query: 'quarterly plan', 'output-dir': '/tmp/enterprise-batch/wecom', limit: '10', 'metadata-only': true },
  ]);
});

test('parseSearchBatchRequests preserves explicit source and materialization overrides', () => {
  assert.deepEqual(dispatcher.parseSearchBatchRequests({
    sources: 'feishu,dingtalk', query: 'quarterly plan', 'output-root': '/tmp/enterprise-batch', 'metadata-only': false,
  }), [
    { source: 'feishu', query: 'quarterly plan', 'output-dir': '/tmp/enterprise-batch/feishu', 'metadata-only': false },
    { source: 'dingtalk', query: 'quarterly plan', 'output-dir': '/tmp/enterprise-batch/dingtalk', 'metadata-only': false },
  ]);
});

test('resource source-options accept only their source-approved field types', () => {
  assert.deepEqual(parseResourceRequest({
    source: 'feishu', 'output-dir': '/tmp/feishu', url: 'https://example.feishu.cn/minutes/m1',
    'source-options': '{"minuteToken":"m1"}',
  }).sourceOptions, { minuteToken: 'm1' });
  assert.throws(() => parseResourceRequest({
    source: 'feishu', 'output-dir': '/tmp/feishu', url: 'https://example.feishu.cn/minutes/m1',
    'source-options': '{"minuteToken":["m1"]}',
  }));
});

test('dispatchEnterprise propagates fatal connector invocation failures', async () => {
  const calls = [];
  const adapters = {
    wecom: {
      search: async (request) => { calls.push(request); throw new Error('authentication failed'); },
      collectResource: async () => ({ status: 'complete' }),
    },
  };
  await assert.rejects(dispatchEnterprise('search', {
    source: 'wecom', query: 'q', 'output-dir': '/tmp/out',
  }, { adapters }), /authentication failed/);
  assert.deepEqual(calls, [{
    source: 'wecom', query: 'q', outputDir: '/tmp/out', limit: 50, concurrency: 4,
    cursor: null, metadataOnly: false, sourceOptions: {},
  }]);
});

test('dispatchEnterprise propagates fatal artifact ownership failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-artifact-failure-'));
  try {
    await assert.rejects(dispatchEnterprise('search', {
      source: 'dingtalk', query: 'q', 'output-dir': root,
    }, {
      adapters: {
        dingtalk: { connector: 'dws', search: async (request) => createArtifactWriter(request.outputDir) },
      },
    }), /must not already exist/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('dispatchEnterprise routes Feishu resources as minutes', async () => {
  let received;
  const outcome = await dispatchEnterprise('resource', {
    source: 'feishu', 'output-dir': '/tmp/feishu-resource', url: 'https://example.feishu.cn/minutes/m1', 'minute-token': 'm1',
  }, {
    adapters: {
      feishu: {
        connector: 'fws',
        collectResource: async (request) => {
          received = request;
          return { status: 'complete' };
        },
      },
    },
  });
  assert.equal(received.resourceKind, 'minutes');
  assert.equal(received.minuteToken, 'm1');
  assert.equal(outcome.status, 'complete');
});

test('dispatchEnterprise returns handled unsupported outcomes for unavailable sources', async () => {
  const outcome = await dispatchEnterprise('resource', {
    source: 'dingtalk', 'output-dir': '/tmp/out', url: 'https://example.com/doc',
  });
  assert.deepEqual(outcome, {
    connector: 'dingtalk', status: 'unsupported_capability', outputDir: '/tmp/out', continuable: true,
    counts: { discovered: 0, materialized: 0, pending: 0, failed: 0 },
  });
});

test('batch search isolates connector outcomes, sessions, output roots, and concurrency', async () => {
  const calls = [];
  let active = 0;
  let peakActive = 0;
  const adapter = (connector, result) => ({
    connector,
    search: async (request) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      calls.push({ connector, request });
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const writer = await createArtifactWriter(request.outputDir);
      await writer.writeJson('raw/fixture.json', { connector, metadataOnly: request.metadataOnly });
      if (result instanceof Error) throw result;
      return result;
    },
  });
  const root = await mkdtemp(join(tmpdir(), 'enterprise-isolation-'));
  const outputRoot = join(root, 'sessions');
  try {
    const results = await dispatchEnterpriseBatch('search', [
      { source: 'dingtalk', query: 'quarterly plan', 'output-dir': `${outputRoot}/dingtalk`, 'metadata-only': 'true' },
      { source: 'feishu', query: 'quarterly plan', 'output-dir': `${outputRoot}/feishu`, 'metadata-only': 'true' },
      { source: 'wecom', query: 'quarterly plan', 'output-dir': `${outputRoot}/wecom`, 'metadata-only': 'true' },
    ], {
      concurrency: 2,
      adapters: {
        dingtalk: adapter('dws', { status: 'auth_required' }),
        feishu: adapter('fws', { status: 'partial' }),
        wecom: adapter('wecom', { status: 'unsupported_capability' }),
      },
    });

    assert.equal(peakActive, 2);
    assert.deepEqual(results.map((result) => result.source), ['dingtalk', 'feishu', 'wecom']);
    assert.deepEqual(results.map((result) => result.outcome.status), ['auth_required', 'partial', 'unsupported_capability']);
    assert.equal(results.every((result) => result.outcome.continuable), true);
    assert.deepEqual(results.map((result) => result.sessionDir), [
      `${outputRoot}/dingtalk`, `${outputRoot}/feishu`, `${outputRoot}/wecom`,
    ]);
    assert.equal(new Set(results.map((result) => result.sessionDir)).size, 3);
    assert.deepEqual(calls.map((call) => call.request.outputDir), results.map((result) => result.sessionDir));
    assert.equal(calls.every((call) => call.request.metadataOnly), true);
    assert.equal(calls.every((call) => call.request.download === undefined), true);
    assert.equal(calls.length, 3);
    await Promise.all(results.map((result) => assertPrivateTree(result.sessionDir)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('batch search continues after a connector throws', async () => {
  const calls = [];
  const adapters = Object.fromEntries(['dingtalk', 'feishu', 'wecom'].map((source) => [source, {
    connector: source,
    search: async () => {
      calls.push(source);
      if (source === 'dingtalk') throw new Error('connector startup failed');
      return { connector: source, status: 'complete' };
    },
  }]));
  const results = await dispatchEnterpriseBatch('search', [
    { source: 'dingtalk', query: 'q', 'output-dir': '/tmp/batch-throw-dingtalk' },
    { source: 'feishu', query: 'q', 'output-dir': '/tmp/batch-throw-feishu' },
    { source: 'wecom', query: 'q', 'output-dir': '/tmp/batch-throw-wecom' },
  ], { adapters, concurrency: 1 });
  assert.deepEqual(calls, ['dingtalk', 'feishu', 'wecom']);
  assert.deepEqual(results.map((result) => result.outcome.status), ['failed', 'complete', 'complete']);
  assert.match(results[0].outcome.reason, /connector startup failed/);
});
