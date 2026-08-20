import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dispatchEnterprise, dispatchEnterpriseBatch, parseResourceRequest, parseSearchRequest } from './dispatcher.mjs';
import { createArtifactWriter } from './shared/artifact-writer.mjs';
import { assertPrivateTree } from './test-helpers.mjs';

test('parseSearchRequest applies bounded defaults and source option allowlists', () => {
  assert.deepEqual(parseSearchRequest({
    source: 'dingtalk',
    query: 'quarterly plan',
    'output-dir': '/tmp/enterprise-search',
    'workspace-ids': 'a,b',
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
    sourceOptions: { workspaceIds: ['a', 'b'], extensions: ['docx', 'pdf'], folderId: 'folder-1' },
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

test('dispatchEnterprise isolates connector failures and forwards normalized requests', async () => {
  const calls = [];
  const adapters = {
    wecom: {
      search: async (request) => { calls.push(request); throw new Error('authentication failed'); },
      collectResource: async () => ({ status: 'complete' }),
    },
  };
  const outcome = await dispatchEnterprise('search', {
    source: 'wecom', query: 'q', 'output-dir': '/tmp/out',
  }, { adapters });
  assert.deepEqual(calls, [{
    source: 'wecom', query: 'q', outputDir: '/tmp/out', limit: 50, concurrency: 4,
    cursor: null, metadataOnly: false, sourceOptions: {},
  }]);
  assert.deepEqual(outcome, {
    connector: 'wecom', status: 'failed', outputDir: '/tmp/out', continuable: true,
    counts: { discovered: 0, materialized: 0, pending: 0, failed: 1 }, reason: 'authentication failed',
  });
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
        feishu: adapter('fws', new Error('temporary API outage')),
        wecom: adapter('wecom', { status: 'unsupported_capability' }),
      },
    });

    assert.equal(peakActive, 2);
    assert.deepEqual(results.map((result) => result.source), ['dingtalk', 'feishu', 'wecom']);
    assert.deepEqual(results.map((result) => result.outcome.status), ['auth_required', 'failed', 'unsupported_capability']);
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
