import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runWebAcquire } from './web-acquirer.mjs';
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

test('acquires a discovered weak candidate through byCLI without promoting discovery eligibility', async () => {
  const f = await weakDiscoveryFixture();
  const calls = [];
  try {
    const result = await runWebAcquire(f.paths, {
      'item-id': 'weak-report', 'source-url': SOURCE_URL,
    }, { runProcess: successfulRunner(calls) });

    assert.equal(result.status, 'saved');
    assert.ok(calls.some((args) => args.includes('extract')));
    const session = JSON.parse(await readFile(join(f.root, 'session.json'), 'utf8'));
    assert.equal(session.task.discoveryGate.runs[0].articleCandidateIds.length, 0);
    assert.equal(session.task.discoveryGate.candidates[0].pageType, 'weak');
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

test('rejects an unauthorized resolved URL and records a failed item', async () => {
  const f = await fixture();
  const calls = [];
  const runner = successfulRunner(calls);
  try {
    const result = await runWebAcquire(f.paths, {
      'item-id': 'bad-redirect', 'source-url': SOURCE_URL,
    }, {
      runProcess: async (bin, args, options) => {
        if (args.includes('get') && args.includes('url')) {
          return { exitCode: 0, stdout: 'https://example.com/\n', stderr: '' };
        }
        return runner(bin, args, options);
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'SOURCE_NOT_AUTHORIZED_BY_DISCOVERY');
    const session = JSON.parse(await readFile(join(f.root, 'session.json'), 'utf8'));
    assert.equal(session.collection.collection.items[0].materialization.status, 'failed');
    assert.equal(session.collection.collection.status, 'failed');
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
