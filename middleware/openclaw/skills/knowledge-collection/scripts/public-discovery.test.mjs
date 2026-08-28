import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ensureSessionSkeleton, newSession, sessionPaths } from './session.mjs';
import * as publicDiscovery from './public-discovery.mjs';

const { runPublicDiscover } = publicDiscovery;

test('uses the image-wide SearXNG CLI by default', () => {
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime({}, {}),
    { executable: 'searxng-cli', argsPrefix: [] },
  );
});

test('prefers explicit SearXNG interpreter overrides over the image-wide command', () => {
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      { pythonExecutable: '/custom/python' },
      { ONLINE_SEARCH_PYTHON: '/environment/python' },
    ),
    { executable: '/custom/python', argsPrefix: ['/opt/searxng-cli/searxng_cli.py'] },
  );
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      {},
      { ONLINE_SEARCH_PYTHON: '/environment/python' },
    ),
    { executable: '/environment/python', argsPrefix: ['/opt/searxng-cli/searxng_cli.py'] },
  );
});

test('supports an explicit SearXNG script path for local development', () => {
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      { pythonExecutable: '/custom/python', searxngScript: '/workspace/searxng_cli.py' },
      { ONLINE_SEARCH_PYTHON: '/environment/python', ONLINE_SEARCH_SCRIPT: '/environment/searxng_cli.py' },
    ),
    { executable: '/custom/python', argsPrefix: ['/workspace/searxng_cli.py'] },
  );
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      {},
      { ONLINE_SEARCH_PYTHON: '/environment/python', ONLINE_SEARCH_SCRIPT: '/environment/searxng_cli.py' },
    ),
    { executable: '/environment/python', argsPrefix: ['/environment/searxng_cli.py'] },
  );
});

function makeInitializedSession(sourceScope = ['public-internet']) {
  const root = mkdtempSync(join(tmpdir(), 'public-discovery-test-'));
  ensureSessionSkeleton(root);
  writeFileSync(join(root, 'session.json'), `${JSON.stringify(newSession({
    query: 'public discovery', sourceScope, materializationTarget: 'candidates',
  }))}\n`);
  return { root, paths: sessionPaths(root) };
}

test('public discovery requires public-internet in the parent source scope', async () => {
  const { paths } = makeInitializedSession(['ima']);
  let called = false;
  await assert.rejects(
    runPublicDiscover(paths, { query: 'q' }, {
      runProcess: async () => { called = true; return { code: 0, stdout: '{}', stderr: '' }; },
    }),
    /sourceScope.*public-internet/,
  );
  assert.equal(called, false);
});

test('default public process runner enforces timeout bounds', async () => {
  assert.equal(typeof publicDiscovery.runBoundedProcess, 'function');
  await assert.rejects(
    publicDiscovery.runBoundedProcess({
      bin: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 100)'],
    }, { timeoutMs: 25 }),
    /timeout after 25ms/,
  );
});

test('public channel runner converts a bound failure into an isolated channel failure', async () => {
  assert.equal(typeof publicDiscovery.runPublicProcess, 'function');
  const outcome = await publicDiscovery.runPublicProcess({
    bin: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 100)'],
  }, { timeoutMs: 25 });
  assert.equal(outcome.code, 1);
  assert.equal(outcome.stdout, '');
  assert.match(outcome.stderr, /timeout after 25ms/);
});

test('runs SearXNG and hot discovery for every SearXNG category', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];

  const result = await runPublicDiscover(paths, {
    query: 'DeepSeek Harness',
    category: 'images',
    language: 'zh-CN',
    'time-range': 'week',
  }, {
    runProcess: async (spec, options) => {
      calls.push({ spec, options });
      return spec.channel === 'searxng'
        ? { code: 0, stdout: JSON.stringify({ query: 'DeepSeek Harness', results: [] }), stderr: '' }
        : {
          code: 0,
          stdout: JSON.stringify({
            query: 'DeepSeek Harness',
            candidates: [],
            dimensions: ['images'],
            effectiveDimensions: ['images', 'general'],
          }),
          stderr: '',
        };
    },
    merge: ({ hotDoc, sxDoc }) => ({ query: sxDoc.query, effectiveDimensions: hotDoc.effectiveDimensions }),
  });

  assert.deepEqual(calls.map(({ spec }) => spec.channel).sort(), ['hot-discovery', 'searxng']);
  assert.deepEqual(calls.find(({ spec }) => spec.channel === 'hot-discovery').spec.args.slice(-2), ['--dimensions', 'images']);
  assert.equal(calls.find(({ spec }) => spec.channel === 'hot-discovery').options, undefined);
  const searxngCall = calls.find(({ spec }) => spec.channel === 'searxng');
  assert.ok(searxngCall.spec.args.includes('--time-range'));
  assert.ok(searxngCall.spec.args.includes('week'));
  assert.equal(searxngCall.spec.args[searxngCall.spec.args.indexOf('--timeout') + 1], '10');
  assert.deepEqual(searxngCall.options, { timeoutMs: 60_000 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.hotDiscovery.effectiveDimensions, ['images', 'general']);
  assert.equal(existsSync(result.snapshots.searxng), true);
  assert.equal(existsSync(result.snapshots.hotDiscovery), true);
  assert.equal(existsSync(result.snapshots.merged), true);
  assert.deepEqual(JSON.parse(readFileSync(result.snapshots.merged, 'utf8')), {
    query: 'DeepSeek Harness', effectiveDimensions: ['images', 'general'],
    channelDiagnostics: {
      searxng: { status: 'success', exitCode: 0 },
      hotDiscovery: { status: 'success', exitCode: 0 },
    },
  });
});

test('default merge preserves the source hostname used for acquisition', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: '浩鲸科技' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? {
        code: 0,
        stdout: JSON.stringify({
          query: '浩鲸科技',
          results: [
            { url: 'https://www.iwhalecloud.com/', title: '浩鲸科技', engine: 'baidu' },
            { url: 'https://iwhalecloud.com/', title: '浩鲸科技', engine: 'bing' },
          ],
        }),
        stderr: '',
      }
      : {
        code: 0,
        stdout: JSON.stringify({ query: '浩鲸科技', candidates: [] }),
        stderr: '',
      },
  });

  const candidate = result.merged.groups.searxngTop[0];
  assert.equal(candidate.url, 'https://www.iwhalecloud.com/');
  assert.deepEqual(candidate.sourceUrls, [
    'https://www.iwhalecloud.com/',
    'https://iwhalecloud.com/',
  ]);
});

test('returns merged user action without discarding successful SearXNG discovery', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: 'agent' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? {
        code: 0,
        stdout: JSON.stringify({
          query: 'agent',
          results: [{ url: 'https://example.com/a', title: 'A', engine: 'google' }],
        }),
        stderr: '',
      }
      : {
        code: 0,
        stdout: JSON.stringify({
          query: 'agent',
          candidates: [],
          warnings: ['byCLI 浏览器桥接不可用；已停止浏览器适配器并等待人工恢复。'],
          requiresUserAction: {
            kind: 'bridge_unavailable',
            message: 'bridge unavailable',
          },
        }),
        stderr: '',
      },
  });

  const expectedAction = {
    kind: 'bridge_unavailable',
    message: 'bridge unavailable',
    fallbackPolicy: {
      allowDirectHttp: false,
      allowGenericBrowser: false,
      nextAction: 'stop-and-report',
    },
  };
  assert.deepEqual(result.requiresUserAction, expectedAction);
  assert.deepEqual(result.merged.requiresUserAction, expectedAction);
  assert.equal(result.merged.groups.searxngTop.length, 1);
  assert.match(result.merged.warnings.join('\n'), /禁止使用.*HTTP.*通用浏览器.*降级/);
  const mergedSnapshot = JSON.parse(readFileSync(result.snapshots.merged, 'utf8'));
  assert.deepEqual(
    mergedSnapshot.requiresUserAction,
    expectedAction,
  );
  assert.match(mergedSnapshot.warnings.join('\n'), /禁止使用.*HTTP.*通用浏览器.*降级/);
});

test('uses only SearXNG when a requested result count is satisfied', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: 'DeepSeek',
    'requested-count': '1',
    'max-results': '20',
  }, {
    runProcess: async (spec, options) => {
      calls.push({ spec, options });
      return {
        code: 0,
        stdout: JSON.stringify({
          query: 'DeepSeek',
          results: [{ url: 'https://example.com/deepseek', title: 'DeepSeek', engine: 'google' }],
        }),
        stderr: '',
      };
    },
    merge: ({ hotDoc, sxDoc }) => ({ query: sxDoc.query, hotDoc }),
  });

  assert.deepEqual(calls.map(({ spec }) => spec.channel), ['searxng']);
  const searxngCall = calls[0];
  assert.equal(searxngCall.spec.args[searxngCall.spec.args.indexOf('--max-results') + 1], '1');
  assert.equal(searxngCall.spec.args[searxngCall.spec.args.indexOf('--timeout') + 1], '10');
  assert.deepEqual(searxngCall.options, { timeoutMs: 60_000 });
  assert.equal(result.hotDiscovery, null);
  assert.equal(result.snapshots.hotDiscovery, null);
  assert.deepEqual(result.channels.hotDiscovery, { status: 'skipped' });
  assert.ok(!result.warnings.some((warning) => warning.includes('hot-discovery')));
  assert.deepEqual(JSON.parse(readFileSync(result.snapshots.merged, 'utf8')).channelDiagnostics.hotDiscovery, {
    status: 'skipped',
  });
});

test('falls back to hot discovery when requested SearXNG result set is empty', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: '浩鲸科技',
    'requested-count': '1',
    'max-results': '20',
  }, {
    runProcess: async (spec, options) => {
      calls.push({ spec, options });
      return spec.channel === 'searxng'
        ? { code: 0, stdout: JSON.stringify({ query: '浩鲸科技', results: [] }), stderr: '' }
        : {
          code: 0,
          stdout: JSON.stringify({
            query: '浩鲸科技',
            candidates: [],
            dimensions: ['general'],
            effectiveDimensions: ['general'],
          }),
          stderr: '',
        };
    },
    merge: ({ hotDoc, sxDoc }) => ({ query: sxDoc.query, usedHotDiscovery: Boolean(hotDoc) }),
  });

  assert.deepEqual(calls.map(({ spec }) => spec.channel), ['searxng', 'hot-discovery']);
  const hotDiscoveryCall = calls[1];
  assert.equal(
    hotDiscoveryCall.spec.args[hotDiscoveryCall.spec.args.indexOf('--limit') + 1],
    '1',
  );
  assert.equal(hotDiscoveryCall.options, undefined);
  assert.equal(result.merged.usedHotDiscovery, true);
  assert.deepEqual(result.channels.hotDiscovery, { status: 'success', exitCode: 0 });
  assert.equal(existsSync(result.snapshots.hotDiscovery), true);
});

test('falls back to hot discovery when requested SearXNG output is invalid', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: '浩鲸科技',
    'requested-count': '1',
  }, {
    runProcess: async (spec) => {
      calls.push(spec);
      return spec.channel === 'searxng'
        ? { code: 1, stdout: '', stderr: 'invalid response' }
        : {
          code: 0,
          stdout: JSON.stringify({
            query: '浩鲸科技',
            candidates: [],
            dimensions: ['general'],
            effectiveDimensions: ['general'],
          }),
          stderr: '',
        };
    },
    merge: ({ hotDoc, sxDoc, warnings }) => ({
      query: hotDoc.query,
      hasSearxng: Boolean(sxDoc),
      warnings,
    }),
  });

  assert.deepEqual(calls.map((spec) => spec.channel), ['searxng', 'hot-discovery']);
  assert.equal(result.merged.hasSearxng, false);
  assert.deepEqual(result.channels.searxng, {
    status: 'failed',
    exitCode: 1,
    timedOut: false,
    stderr: 'invalid response',
  });
  assert.deepEqual(result.channels.hotDiscovery, { status: 'success', exitCode: 0 });
  assert.match(result.warnings.join('\n'), /SearXNG 发现失败/);
});

test('keeps SearXNG output when hot discovery fails', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: 'q' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? { code: 0, stdout: JSON.stringify({ query: 'q', results: [] }), stderr: '' }
      : { code: 75, stdout: '', stderr: 'RATE_LIMITED' },
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.channels.searxng.status, 'success');
  assert.equal(result.channels.hotDiscovery.status, 'failed');
  assert.equal(result.channels.hotDiscovery.exitCode, 75);
  assert.equal(result.channels.hotDiscovery.timedOut, false);
  assert.equal(result.channels.hotDiscovery.stderr, 'RATE_LIMITED');
  assert.ok(result.warnings.some((warning) => warning.includes('hot-discovery')));
  assert.equal(existsSync(result.snapshots.searxng), true);
  assert.equal(result.snapshots.hotDiscovery, null);
  assert.equal(existsSync(result.snapshots.merged), true);
  assert.deepEqual(JSON.parse(readFileSync(result.snapshots.merged, 'utf8')).channelDiagnostics, {
    searxng: { status: 'success', exitCode: 0 },
    hotDiscovery: { status: 'failed', exitCode: 75, timedOut: false, stderr: 'RATE_LIMITED' },
  });
});

test('records outer timeout diagnostics with bounded and redacted stderr', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: 'q' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? { code: 0, stdout: JSON.stringify({ query: 'q', results: [] }), stderr: '' }
      : {
        code: 1,
        stdout: '',
        stderr: `CLI timeout after 30000ms authorization: Bearer ${'x'.repeat(3000)}`,
        timedOut: true,
      },
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  });

  const diagnostic = result.channels.hotDiscovery;
  assert.equal(diagnostic.timedOut, true);
  assert.match(diagnostic.stderr, /CLI timeout after 30000ms authorization: \[REDACTED\]/i);
  assert.ok(diagnostic.stderr.length <= 2_000);
  assert.doesNotMatch(diagnostic.stderr, /x{20}/);
});

test('fails public discovery only when both channels fail', async () => {
  const { paths } = makeInitializedSession();

  await assert.rejects(
    runPublicDiscover(paths, { query: 'q' }, {
      runProcess: async () => ({ code: 1, stdout: '', stderr: 'failed' }),
    }),
    /SearXNG 与 hot-discovery 均未返回有效结果/,
  );
});
