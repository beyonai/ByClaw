import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { acquireWebProbe, runWebAcquire } from './web-acquirer.mjs';
import { recordDiscoveryResult, reserveDiscoveryAttempt } from './discovery-authorization.mjs';
import { cmdInit } from './research-state.mjs';
import { sessionPaths } from './session.mjs';

const SOURCE_URL = 'https://example.com/news/1234567';
const LOCAL_BRIDGE_SCRIPT = fileURLToPath(new URL('../../bycli/scripts/bridge-bootstrap.mjs', import.meta.url));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'web-acquirer-'));
  cmdInit({
    'session-dir': root,
    query: '采集一篇关于 Example 的文章',
    'direct-urls': JSON.stringify([SOURCE_URL]),
    'required-content-granularity': 'full-text',
  });
  return { root, paths: sessionPaths(root) };
}

async function weakDiscoveryFixture() {
  const root = await mkdtemp(join(tmpdir(), 'web-acquirer-weak-'));
  cmdInit({
    'session-dir': root,
    query: '采集一篇关于 Example 的文章',
    'required-content-granularity': 'full-text',
  });
  const sessionPath = join(root, 'session.json');
  const session = JSON.parse(await readFile(sessionPath, 'utf8'));
  reserveDiscoveryAttempt(session.task.discoveryGate, {
    query: 'Example 深度文章',
    category: 'general',
  });
  recordDiscoveryResult(session.task.discoveryGate, {
    query: 'Example 深度文章',
    category: 'general',
    candidates: [{
      url: SOURCE_URL,
      title: 'Example 深度文章',
      pageType: 'weak',
    }],
  });
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  return { root, paths: sessionPaths(root) };
}

function successfulRunner(calls) {
  return async (_bin, args) => {
    calls.push(args);
    if (args.at(-2) === '--format' && args.at(-1) === 'json') {
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, code: 'BRIDGE_READY' }), stderr: '' };
    }
    if (args.includes('open')) return { exitCode: 0, stdout: JSON.stringify({ opened: true }), stderr: '' };
    if (args.includes('get') && args.includes('url')) return { exitCode: 0, stdout: `${SOURCE_URL}\n`, stderr: '' };
    if (args.includes('extract')) {
      const start = Number(args[args.indexOf('--start') + 1]);
      return start === 0
        ? {
          exitCode: 0,
          stdout: JSON.stringify({
            url: SOURCE_URL, title: 'Example report', total_chars: 22,
            start: 0, end: 11, next_start_char: 11, content: 'first body\n',
          }),
          stderr: '',
        }
        : {
          exitCode: 0,
          stdout: JSON.stringify({
            url: SOURCE_URL, title: 'Example report', total_chars: 22,
            start: 11, end: 22, next_start_char: null, content: 'second body',
          }),
          stderr: '',
        };
    }
    if (args.includes('close')) return { exitCode: 0, stdout: '', stderr: '' };
    throw new Error(`unexpected command: ${args.join(' ')}`);
  };
}

function trailingSlashRunner(calls) {
  const runner = successfulRunner(calls);
  return async (bin, args, options) => {
    if (args.includes('get') && args.includes('url')) {
      return { exitCode: 0, stdout: `${SOURCE_URL}/\n`, stderr: '' };
    }
    if (args.includes('extract')) {
      const outcome = await runner(bin, args, options);
      const chunk = JSON.parse(outcome.stdout);
      return { ...outcome, stdout: JSON.stringify({ ...chunk, url: `${SOURCE_URL}/` }) };
    }
    return runner(bin, args, options);
  };
}

test('acquires contiguous browser chunks and leaves the item pending for materialization', async () => {
  const f = await fixture();
  const calls = [];
  try {
    const result = await runWebAcquire(f.paths, {
      'item-id': 'example-report', 'source-url': SOURCE_URL,
    }, { runProcess: successfulRunner(calls) });

    assert.equal(result.status, 'saved');
    assert.equal(result.requestedUrl, SOURCE_URL);
    assert.equal(result.resolvedUrl, SOURCE_URL);
    assert.equal(await readFile(join(f.root, result.saved), 'utf8'), 'first body\nsecond body');
    assert.ok(calls.some((args) => args.includes('extract')));
    assert.ok(calls.some((args) => args.includes('close')));
    const session = JSON.parse(await readFile(join(f.root, 'session.json'), 'utf8'));
    assert.equal(session.collection.collection.status, 'partial');
    assert.equal(session.collection.collection.items[0].materialization.status, 'pending');
    assert.deepEqual(session.collection.collection.items[0].rawArtifacts.sort(), [
      'raw/bycli/web/example-report/article.md',
      'raw/bycli/web/example-report/executor-result.json',
    ]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('probe acquisition returns controlled body without creating collection inventory', async () => {
  const f = await fixture();
  const calls = [];
  try {
    const before = await readFile(join(f.root, 'session.json'), 'utf8');
    const result = await acquireWebProbe({
      canonicalUrl: SOURCE_URL,
      acquisitionUrls: [SOURCE_URL],
    }, { runProcess: successfulRunner(calls), probeId: 'fixture-probe' });
    assert.equal(result.status, 'saved');
    assert.equal(result.markdown, 'first body\nsecond body');
    assert.equal(result.executor, 'bycli');
    assert.equal(await readFile(join(f.root, 'session.json'), 'utf8'), before);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('probe authorizes trailing-slash canonicalization and validates equivalent chunk URLs', async () => {
  const calls = [];
  const result = await acquireWebProbe({
    canonicalUrl: SOURCE_URL,
    acquisitionUrls: [SOURCE_URL],
  }, { runProcess: trailingSlashRunner(calls), probeId: 'fixture-trailing-slash' });

  assert.equal(result.status, 'saved');
  assert.equal(result.requestedUrl, SOURCE_URL);
  assert.equal(result.resolvedUrl, `${SOURCE_URL}/`);
  assert.equal(result.markdown, 'first body\nsecond body');
});

test('probe authorizes a same-site redirect across subdomains and paths', async () => {
  const calls = [];
  const runner = successfulRunner(calls);
  const resolvedUrl = 'https://www.example.com/articles/7654321?from=mobile';
  const result = await acquireWebProbe({
    canonicalUrl: 'https://m.example.com/news/1234567',
    acquisitionUrls: ['https://m.example.com/news/1234567'],
  }, {
    probeId: 'fixture-same-site-redirect',
    runProcess: async (bin, args, options) => {
      if (args.includes('get') && args.includes('url')) {
        return { exitCode: 0, stdout: `${resolvedUrl}\n`, stderr: '' };
      }
      if (args.includes('extract')) {
        const outcome = await runner(bin, args, options);
        return { ...outcome, stdout: JSON.stringify({ ...JSON.parse(outcome.stdout), url: resolvedUrl }) };
      }
      return runner(bin, args, options);
    },
  });

  assert.equal(result.status, 'saved');
  assert.equal(result.resolvedUrl, resolvedUrl);
});

test('probe authorizes query changes on the same site', async () => {
  const calls = [];
  const runner = successfulRunner(calls);
  const resolvedUrl = `${SOURCE_URL}/?tracking=1`;
  const result = await acquireWebProbe({
    canonicalUrl: SOURCE_URL,
    acquisitionUrls: [SOURCE_URL],
  }, {
    probeId: 'fixture-query-change',
    runProcess: async (bin, args, options) => {
      if (args.includes('get') && args.includes('url')) {
        return { exitCode: 0, stdout: `${resolvedUrl}\n`, stderr: '' };
      }
      if (args.includes('extract')) {
        const outcome = await runner(bin, args, options);
        return { ...outcome, stdout: JSON.stringify({ ...JSON.parse(outcome.stdout), url: resolvedUrl }) };
      }
      return runner(bin, args, options);
    },
  });

  assert.equal(result.status, 'saved');
  assert.equal(result.resolvedUrl, resolvedUrl);
});

test('probe rejects an unpersisted cross-site redirect', async () => {
  const calls = [];
  const runner = successfulRunner(calls);
  const resolvedUrl = 'https://unrelated.example.net/articles/7654321';
  const result = await acquireWebProbe({
    canonicalUrl: SOURCE_URL,
    acquisitionUrls: [SOURCE_URL],
  }, {
    probeId: 'fixture-cross-site-redirect',
    runProcess: async (bin, args, options) => {
      if (args.includes('get') && args.includes('url')) {
        return { exitCode: 0, stdout: `${resolvedUrl}\n`, stderr: '' };
      }
      return runner(bin, args, options);
    },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.reasonCode, 'SOURCE_NOT_AUTHORIZED_BY_DISCOVERY');
  assert.equal(result.failureDiagnostic.mismatchKind, 'redirect-not-authorized');
});

test('probe allows HTTP to HTTPS on the same site but rejects HTTPS downgrade', async () => {
  const run = async (requestedUrl, resolvedUrl, probeId) => {
    const calls = [];
    const runner = successfulRunner(calls);
    return acquireWebProbe({ canonicalUrl: requestedUrl, acquisitionUrls: [requestedUrl] }, {
      probeId,
      runProcess: async (bin, args, options) => {
        if (args.includes('get') && args.includes('url')) {
          return { exitCode: 0, stdout: `${resolvedUrl}\n`, stderr: '' };
        }
        if (args.includes('extract')) {
          const outcome = await runner(bin, args, options);
          return { ...outcome, stdout: JSON.stringify({ ...JSON.parse(outcome.stdout), url: resolvedUrl }) };
        }
        return runner(bin, args, options);
      },
    });
  };

  assert.equal((await run(
    'http://m.example.com/old', 'https://www.example.com/new', 'fixture-http-upgrade',
  )).status, 'saved');
  const downgrade = await run(
    'https://m.example.com/old', 'http://www.example.com/new', 'fixture-https-downgrade',
  );
  assert.equal(downgrade.status, 'unavailable');
  assert.equal(downgrade.failureDiagnostic.mismatchKind, 'redirect-not-authorized');
});

test('probe diagnoses an extracted chunk that changes to another URL', async () => {
  const calls = [];
  const runner = successfulRunner(calls);
  const chunkUrl = 'https://example.com/news/7654321';
  const result = await acquireWebProbe({
    canonicalUrl: SOURCE_URL,
    acquisitionUrls: [SOURCE_URL],
  }, {
    probeId: 'fixture-chunk-url-change',
    runProcess: async (bin, args, options) => {
      if (args.includes('extract')) {
        const outcome = await runner(bin, args, options);
        return { ...outcome, stdout: JSON.stringify({ ...JSON.parse(outcome.stdout), url: chunkUrl }) };
      }
      return runner(bin, args, options);
    },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.reasonCode, 'EXECUTOR_CHUNK_INVALID');
  assert.deepEqual(result.failureDiagnostic, {
    stage: 'extract-url-continuity',
    mismatchKind: 'extract-url-changed',
    requestedUrl: SOURCE_URL,
    resolvedUrl: chunkUrl,
  });
});

test('probe acquisition reports bridge failure as infrastructure-blocked', async () => {
  const result = await acquireWebProbe({
    canonicalUrl: SOURCE_URL,
    acquisitionUrls: [SOURCE_URL],
  }, {
    probeId: 'fixture-infra',
    runProcess: async () => ({ exitCode: 1, stdout: '', stderr: 'bridge down' }),
  });
  assert.equal(result.status, 'infrastructure-blocked');
  assert.equal(result.reasonCode, 'BRIDGE_UNAVAILABLE');
});

test('acquires a discovery candidate without treating discovery evidence as verified body', async () => {
  const f = await weakDiscoveryFixture();
  const calls = [];
  try {
    const result = await runWebAcquire(f.paths, {
      'item-id': 'weak-report', 'source-url': SOURCE_URL,
    }, { runProcess: successfulRunner(calls) });

    assert.equal(result.status, 'saved');
    assert.ok(calls.some((args) => args.includes('extract')));
    const session = JSON.parse(await readFile(join(f.root, 'session.json'), 'utf8'));
    assert.equal(session.task.discoveryGate.candidates[0].discoveryDisposition, 'probe');
    assert.equal(session.task.discoveryGate.candidates[0].verificationRequired, true);
    assert.equal(Object.hasOwn(session.task.discoveryGate.candidates[0], 'verifiedBody'), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('uses the repository byCLI bridge when the container bridge path is unavailable', async () => {
  const f = await fixture();
  const calls = [];
  try {
    const result = await runWebAcquire(f.paths, {
      'item-id': 'local-bridge', 'source-url': SOURCE_URL,
    }, { runProcess: successfulRunner(calls) });

    assert.equal(result.status, 'saved');
    assert.equal(calls[0][0], LOCAL_BRIDGE_SCRIPT);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('rejects an unauthorized cross-site resolved URL and records a failed item', async () => {
  const f = await fixture();
  const calls = [];
  const runner = successfulRunner(calls);
  try {
    const result = await runWebAcquire(f.paths, {
      'item-id': 'bad-redirect', 'source-url': SOURCE_URL,
    }, {
      runProcess: async (bin, args, options) => {
        if (args.includes('get') && args.includes('url')) {
          return { exitCode: 0, stdout: 'https://unrelated.example.net/\n', stderr: '' };
        }
        return runner(bin, args, options);
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'SOURCE_NOT_AUTHORIZED_BY_DISCOVERY');
    assert.deepEqual(result.failureDiagnostic, {
      stage: 'resolved-url-authorization',
      mismatchKind: 'redirect-not-authorized',
      requestedUrl: SOURCE_URL,
      resolvedUrl: 'https://unrelated.example.net/',
    });
    const persisted = JSON.parse(await readFile(join(f.root, result.executorResult), 'utf8'));
    assert.deepEqual(persisted.failureDiagnostic, result.failureDiagnostic);
    const session = JSON.parse(await readFile(join(f.root, 'session.json'), 'utf8'));
    assert.equal(session.collection.collection.items[0].materialization.status, 'failed');
    assert.equal(session.collection.collection.status, 'failed');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('direct acquisition authorizes trailing-slash canonicalization', async () => {
  const f = await fixture();
  const calls = [];
  try {
    const result = await runWebAcquire(f.paths, {
      'item-id': 'trailing-slash', 'source-url': SOURCE_URL,
    }, { runProcess: trailingSlashRunner(calls) });

    assert.equal(result.status, 'saved');
    assert.equal(result.resolvedUrl, `${SOURCE_URL}/`);
    assert.equal(await readFile(join(f.root, result.saved), 'utf8'), 'first body\nsecond body');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('keeps challenge pages pending and does not close the owned browser session', async () => {
  const f = await fixture();
  const calls = [];
  const runner = successfulRunner(calls);
  try {
    const result = await runWebAcquire(f.paths, {
      'item-id': 'challenge', 'source-url': SOURCE_URL,
    }, {
      runProcess: async (bin, args, options) => {
        if (args.includes('extract')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              url: SOURCE_URL, title: '安全验证', total_chars: 5,
              start: 0, end: 5, next_start_char: null, content: '请完成验证码',
            }),
            stderr: '',
          };
        }
        return runner(bin, args, options);
      },
    });
    assert.equal(result.status, 'requires-user-action');
    assert.equal(calls.some((args) => args.includes('close')), false);
    const session = JSON.parse(await readFile(join(f.root, 'session.json'), 'utf8'));
    assert.equal(session.collection.collection.items[0].materialization.status, 'pending');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('does not treat incidental login navigation in a normal article as a challenge', async () => {
  const f = await fixture();
  const calls = [];
  const runner = successfulRunner(calls);
  const article = `首页 登录\n${'这是正常文章正文。'.repeat(120)}`;
  try {
    const result = await runWebAcquire(f.paths, {
      'item-id': 'login-navigation', 'source-url': SOURCE_URL,
    }, {
      runProcess: async (bin, args, options) => {
        if (args.includes('extract')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              url: SOURCE_URL, title: 'Example industry report', total_chars: article.length,
              start: 0, end: article.length, next_start_char: null, content: article,
            }),
            stderr: '',
          };
        }
        return runner(bin, args, options);
      },
    });

    assert.equal(result.status, 'saved');
    assert.ok(calls.some((args) => args.includes('close')));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('rejects an unapproved requested URL before invoking byCLI', async () => {
  const f = await fixture();
  let called = false;
  try {
    await assert.rejects(
      runWebAcquire(f.paths, {
        'item-id': 'unauthorized', 'source-url': 'https://example.com/news/9999999',
      }, { runProcess: async () => { called = true; } }),
      /SOURCE_NOT_AUTHORIZED_BY_DISCOVERY/,
    );
    assert.equal(called, false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('preserves a saved acquisition when browser close fails after publication', async () => {
  const f = await fixture();
  const calls = [];
  const runner = successfulRunner(calls);
  try {
    const result = await runWebAcquire(f.paths, {
      'item-id': 'close-failure', 'source-url': SOURCE_URL,
    }, {
      runProcess: async (bin, args, options) => {
        if (args.includes('close')) throw new Error('close failed');
        return runner(bin, args, options);
      },
    });
    assert.equal(result.status, 'saved');
    assert.equal(await readFile(join(f.root, result.saved), 'utf8'), 'first body\nsecond body');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
