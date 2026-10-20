import assert from 'node:assert/strict';
import {
  chmod, mkdtemp, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  operationFingerprint,
  runGate,
} from './weixin-login-gate.mjs';

const gateScript = join(dirname(new URL(import.meta.url).pathname), 'weixin-login-gate.mjs');

const ARTICLE_URL = [
  'https://mp.weixin.qq.com/s?__biz=stable-biz',
  'mid=123',
  'idx=1',
  'sn=stable-sn',
  'pass_ticket=secret-ticket',
  'exportkey=secret-export',
].join('&');

function command({
  url = ARTICLE_URL,
  output = '/tmp/weixin-output-a',
  adapterSession = 'batch-safe-worker-1',
} = {}) {
  return [
    'bycli', 'weixin', 'download',
    '--url', url,
    '--output', output,
    '--adapter-session', adapterSession,
    '--adapter-queue-timeout', '300',
    '--site-session', 'persistent',
    '--keep-tab', 'true',
    '-f', 'json',
  ];
}

function result(exitCode, code = null) {
  return {
    exitCode,
    stdout: '',
    stderr: code ? JSON.stringify({ ok: false, error: { code } }) : '',
  };
}

function channelsCommand(name = 'overview') {
  return [
    'bycli', 'weixin-channels', name,
    ...(name === 'post-detail' ? ['--id', '18446744073709551615'] : []),
    '--days', '7',
    '--adapter-session', 'channels-fixture-session',
    '--site-session', 'persistent',
    '--keep-tab', 'true',
    '-f', 'json',
  ];
}

async function channelsStateDir(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'channels-login-gate-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  return stateDir;
}

test('legacy Weixin fingerprint remains byte-compatible with the original gate', () => {
  assert.equal(operationFingerprint(command({
    url: 'https://mp.weixin.qq.com/s?__biz=stable-biz&mid=100&idx=1&sn=stable-sn&pass_ticket=secret-ticket&exportkey=secret-export',
  })), '254c228721efdd8a732479b6bfcea9a4b5b85a6b2cd58dad1250cf6c839f1c79');
});

test('identical business arguments are isolated by the Weixin namespace', async (t) => {
  const stateDir = await channelsStateDir(t);
  const channels = channelsCommand();
  const weixin = [...channels];
  weixin[1] = 'weixin';
  assert.notEqual(operationFingerprint(channels), operationFingerprint(weixin));

  await runGate({ stateDir, argv: weixin, execute: async () => result(0) });
  const outcome = await runGate({
    stateDir,
    argv: channels,
    execute: async () => result(1, 'AUTH_REQUIRED'),
  });
  assert.equal(outcome.executed, true);
  assert.equal(outcome.phase, 'waiting-confirmation');
});

for (const name of ['overview', 'trend', 'sources', 'posts', 'post-detail', 'video-stats', 'video-status', 'video-publish']) {
  test(`video ${name} waits without confirmation and completes after a confirmed rerun`, async (t) => {
    const stateDir = await channelsStateDir(t);
    const attempts = [];
    const execute = async (argv, context) => {
      attempts.push({ argv, attemptKind: context.attemptKind });
      return attempts.length === 1 ? result(1, 'AUTH_REQUIRED') : result(0);
    };
    const argv = channelsCommand(name);
    const initial = await runGate({ stateDir, argv, execute });
    assert.equal(initial.phase, 'waiting-confirmation');

    for (const verificationConfirmed of [false, undefined, 'true']) {
      const waiting = await runGate({ stateDir, argv, verificationConfirmed, execute });
      assert.equal(waiting.executed, false);
      assert.equal(waiting.requiresUserAction, true);
      assert.equal(waiting.reason, 'explicit-verification-confirmation-required');
    }
    assert.equal(attempts.length, 1);
    const completed = await runGate({ stateDir, argv, verificationConfirmed: true, execute });
    assert.equal(completed.phase, 'complete');
    assert.deepEqual(attempts, [
      { argv, attemptKind: 'initial' },
      { argv, attemptKind: 'confirmed-rerun' },
    ]);
    const replay = await runGate({ stateDir, argv, verificationConfirmed: true, execute });
    assert.equal(replay.executed, false);
    assert.equal(replay.code, 'OPERATION_ALREADY_FINALIZED');
    assert.equal(attempts.length, 2);
  });
}

for (const code of ['CAPTCHA', 'MFA_REQUIRED', 'ENVIRONMENT_VALIDATION']) {
  test(`video ${code} requires explicit human confirmation`, async (t) => {
    const stateDir = await channelsStateDir(t);
    const outcome = await runGate({
      stateDir,
      argv: channelsCommand(),
      execute: async () => ({
        exitCode: 1,
        stdout: JSON.stringify({ ok: false, error: { code } }),
        stderr: '',
      }),
    });
    assert.equal(outcome.phase, 'waiting-confirmation');
    const waiting = await runGate({
      stateDir,
      argv: channelsCommand(),
      execute: async () => assert.fail('unconfirmed execution must be blocked'),
    });
    assert.equal(waiting.requiresUserAction, true);
  });
}

test('video login gate permits exactly ten confirmed reruns then remains terminal', async (t) => {
  const stateDir = await channelsStateDir(t);
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return result(1, 'AUTH_REQUIRED');
  };
  await runGate({ stateDir, argv: channelsCommand(), execute });
  for (let count = 1; count <= 10; count += 1) {
    const outcome = await runGate({
      stateDir, argv: channelsCommand(), verificationConfirmed: true, execute,
    });
    assert.equal(outcome.phase, count === 10 ? 'terminal' : 'waiting-confirmation');
    const persisted = JSON.parse(await readFile(
      join(stateDir, `${outcome.operationFingerprint}.json`), 'utf8',
    ));
    assert.equal(persisted.confirmedRerunCount, count);
  }
  for (const verificationConfirmed of [false, true]) {
    const exhausted = await runGate({
      stateDir, argv: channelsCommand(), verificationConfirmed, execute,
    });
    assert.equal(exhausted.executed, false);
    assert.equal(exhausted.code, 'AUTH_RETRY_EXHAUSTED');
    assert.equal(exhausted.requiresUserAction, false);
  }
  assert.equal(executions, 11);
});

for (const exitCode of [75, 77]) {
  test(`video TIMEOUT with a login hint is a failure even with exit ${exitCode}`, async (t) => {
    const stateDir = await channelsStateDir(t);
    const outcome = await runGate({
      stateDir,
      argv: channelsCommand(),
      execute: async () => ({
        exitCode,
        stdout: '',
        stderr: JSON.stringify({
          ok: false, error: { code: 'TIMEOUT', message: 'session capture timeout; finish login' },
        }),
      }),
    });
    assert.equal(outcome.phase, 'terminal');
    const retry = await runGate({
      stateDir,
      argv: channelsCommand(),
      verificationConfirmed: true,
      execute: async () => assert.fail('ordinary timeout must not allow a login rerun'),
    });
    assert.equal(retry.code, 'OPERATION_ALREADY_FINALIZED');
    assert.equal(retry.requiresUserAction, false);
  });
}

test('video exit 77 without an explicit authentication code is not a login request', async (t) => {
  const stateDir = await channelsStateDir(t);
  const outcome = await runGate({
    stateDir,
    argv: channelsCommand(),
    execute: async () => result(77, 'COMMAND_EXEC'),
  });
  assert.equal(outcome.phase, 'terminal');
});

test('legacy Weixin TIMEOUT with a login hint keeps its original confirmation behavior', async (t) => {
  const stateDir = await channelsStateDir(t);
  const outcome = await runGate({
    stateDir,
    argv: command(),
    execute: async () => ({
      exitCode: 75,
      stdout: '',
      stderr: JSON.stringify({ error: { code: 'TIMEOUT', message: 'finish login' } }),
    }),
  });
  assert.equal(outcome.phase, 'waiting-confirmation');
});

test('video state never persists arbitrary error codes or credentials', async (t) => {
  const stateDir = await channelsStateDir(t);
  const outcome = await runGate({
    stateDir,
    argv: channelsCommand(),
    execute: async () => ({
      exitCode: 1,
      stdout: 'cookie=fixture-cookie',
      stderr: JSON.stringify({ error: {
        code: 'COMMAND_EXEC token=fixture-secret',
        message: 'pass_ticket=fixture-ticket',
      } }),
    }),
  });
  const statePath = join(stateDir, `${outcome.operationFingerprint}.json`);
  const text = await readFile(statePath, 'utf8');
  assert.equal(text.includes('fixture-'), false);
  assert.equal(text.includes('channels-fixture-session'), false);
  assert.equal(JSON.parse(text).lastCode, null);
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);
});

test('video rejects unsupported commands before either initial or confirmed execution', async (t) => {
  const stateDir = await channelsStateDir(t);
  for (const name of ['download', 'delete', 'overview-invalid']) {
    for (const verificationConfirmed of [false, true]) {
      await assert.rejects(runGate({
        stateDir,
        argv: channelsCommand(name),
        verificationConfirmed,
        execute: async () => assert.fail('unsupported commands must not execute'),
      }), /unsupported weixin-channels command/);
    }
  }
  assert.deepEqual(await readdir(stateDir), []);
});

test('human verification may be confirmed ten times before the operation becomes terminal', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(stateDir, { recursive: true, force: true });
  });
  const executions = [];
  const execute = async argv => {
    executions.push(argv);
    return result(77, 'AUTH_REQUIRED');
  };

  const initial = await runGate({ stateDir, argv: command(), execute });
  assert.equal(initial.executed, true);
  assert.equal(initial.phase, 'waiting-confirmation');
  assert.equal(executions.length, 1);

  const plainRetry = await runGate({ stateDir, argv: command(), execute });
  assert.equal(plainRetry.executed, false);
  assert.equal(plainRetry.phase, 'waiting-confirmation');
  assert.equal(plainRetry.reason, 'explicit-verification-confirmation-required');
  assert.equal(executions.length, 1);

  for (let rerun = 1; rerun <= 9; rerun += 1) {
    const confirmedRerun = await runGate({
      stateDir,
      argv: command(),
      verificationConfirmed: true,
      execute,
    });
    assert.equal(confirmedRerun.executed, true);
    assert.equal(confirmedRerun.phase, 'waiting-confirmation');
    assert.equal(executions.length, rerun + 1);

    const waiting = await runGate({ stateDir, argv: command(), execute });
    assert.equal(waiting.executed, false);
    assert.equal(waiting.reason, 'explicit-verification-confirmation-required');
  }

  const finalRerun = await runGate({
    stateDir,
    argv: command(),
    verificationConfirmed: true,
    execute,
  });
  assert.equal(finalRerun.executed, true);
  assert.equal(finalRerun.phase, 'terminal');
  assert.equal(executions.length, 11);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const denied = await runGate({ stateDir, argv: command(), execute });
    assert.equal(denied.executed, false);
    assert.equal(denied.phase, 'terminal');
    assert.equal(denied.reason, 'login-gate-rerun-exhausted');
    assert.equal(denied.code, 'AUTH_RETRY_EXHAUSTED');
    assert.equal(denied.exitCode, 1);
    assert.equal(denied.retryable, false);
    assert.equal(denied.requiresUserAction, false);
  }
  assert.equal(executions.length, 11);
});

test('lifecycle, output, and transient URL options do not create a new operation', () => {
  const first = operationFingerprint(command());
  const second = operationFingerprint(command({
    url: 'https://mp.weixin.qq.com/s?sn=stable-sn&idx=1&mid=123&__biz=stable-biz&pass_ticket=other',
    output: '/tmp/weixin-output-b',
    adapterSession: 'batch-safe-worker-3',
  }));
  assert.equal(first, second);
});

test('a different article remains independent after another article is terminal', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-independent-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(stateDir, { recursive: true, force: true });
  });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return result(77, 'AUTH_REQUIRED');
  };

  await runGate({ stateDir, argv: command(), execute });
  for (let rerun = 0; rerun < 10; rerun += 1) {
    await runGate({
      stateDir,
      argv: command(),
      verificationConfirmed: true,
      execute,
    });
  }
  const other = await runGate({
    stateDir,
    argv: command({ url: 'https://mp.weixin.qq.com/s/another-article' }),
    execute,
  });

  assert.equal(other.executed, true);
  assert.equal(other.phase, 'waiting-confirmation');
  assert.equal(executions, 12);
});

test('state files are private and contain no command, URL, or session secrets', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-redaction-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(stateDir, { recursive: true, force: true });
  });
  const outcome = await runGate({
    stateDir,
    argv: command(),
    execute: async () => result(77, 'AUTH_REQUIRED'),
  });
  const statePath = join(stateDir, `${outcome.operationFingerprint}.json`);
  const persisted = await readFile(statePath, 'utf8');
  const metadata = await stat(statePath);

  assert.equal(metadata.mode & 0o777, 0o600);
  assert.doesNotMatch(persisted, /secret-ticket|secret-export|stable-biz|stable-sn/);
  assert.doesNotMatch(persisted, /batch-safe-worker|weixin-output|mp\.weixin\.qq\.com/);
  assert.equal(JSON.parse(persisted).phase, 'waiting-confirmation');
  assert.equal(JSON.parse(persisted).confirmedRerunCount, 0);
});

test('a successful confirmed rerun completes the operation', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-success-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(stateDir, { recursive: true, force: true });
  });
  const outcomes = [result(77, 'AUTH_REQUIRED'), result(0)];
  const execute = async () => outcomes.shift();

  await runGate({ stateDir, argv: command(), execute });
  const completed = await runGate({
    stateDir,
    argv: command(),
    verificationConfirmed: true,
    execute,
  });

  assert.equal(completed.executed, true);
  assert.equal(completed.phase, 'complete');
});

test('a finalized operation is not reported as an authentication requirement', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-finalized-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  let executions = 0;
  const options = {
    stateDir,
    argv: command(),
    execute: async () => {
      executions += 1;
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, records: [{ title: 'saved' }] }),
        stderr: '',
      };
    },
  };

  const initial = await runGate(options);
  const replay = await runGate(options);

  assert.equal(initial.phase, 'complete');
  assert.equal(replay.executed, false);
  assert.equal(replay.commandExecuted, false);
  assert.equal(replay.exitCode, 1);
  assert.equal(replay.code, 'OPERATION_ALREADY_FINALIZED');
  assert.equal(replay.reason, 'operation-already-finalized');
  assert.equal(replay.previousOutcome, 'succeeded');
  assert.equal(replay.retryable, false);
  assert.equal(replay.requiresUserAction, false);
  assert.equal(executions, 1);
});

test('a finalized partial result preserves its non-success outcome', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-partial-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const options = {
    stateDir,
    argv: command(),
    execute: async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{ status: 'partial', markdownPath: '/tmp/article.md' }]),
      stderr: '',
    }),
  };

  await runGate(options);
  const replay = await runGate(options);

  assert.equal(replay.code, 'OPERATION_ALREADY_FINALIZED');
  assert.equal(replay.previousOutcome, 'partial');
});

test('a finalized failed result in a data array preserves its failure outcome', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-failed-array-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const options = {
    stateDir,
    argv: command(),
    execute: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, data: [{ status: 'failed', error: 'download missing' }] }),
      stderr: '',
    }),
  };

  await runGate(options);
  const replay = await runGate(options);

  assert.equal(replay.code, 'OPERATION_ALREADY_FINALIZED');
  assert.equal(replay.previousOutcome, 'failed');
});

test('successful business data containing an AUTH_REQUIRED code is not a human gate', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-business-code-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));

  const outcome = await runGate({
    stateDir,
    argv: command(),
    execute: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, records: [{ code: 'AUTH_REQUIRED' }] }),
      stderr: '',
    }),
  });

  assert.equal(outcome.phase, 'complete');
  assert.equal(outcome.exitCode, 0);
});

test('nonzero business stdout containing AUTH_REQUIRED is not an authentication gate', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-nonzero-business-code-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));

  const outcome = await runGate({
    stateDir,
    argv: command(),
    execute: async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ records: [{ code: 'AUTH_REQUIRED' }] }),
      stderr: '',
    }),
  });

  assert.equal(outcome.phase, 'terminal');
  assert.equal(outcome.exitCode, 1);
});

test('an unclassified initial process failure does not create terminal gate state', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-unclassified-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));

  const outcome = await runGate({
    stateDir,
    argv: command(),
    execute: async () => ({
      exitCode: 1,
      stdout: '',
      stderr: '',
      timedOut: true,
      signal: 'SIGTERM',
    }),
  });

  assert.equal(outcome.executed, true);
  assert.equal(outcome.phase, 'initial');
  assert.equal(outcome.exitCode, 1);
  assert.deepEqual(await readdir(stateDir), []);
});

test('a non-verification error on a confirmed rerun remains terminal', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-command-error-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const outcomes = [result(77, 'AUTH_REQUIRED'), result(1, 'COMMAND_EXEC')];
  const execute = async () => outcomes.shift();

  await runGate({ stateDir, argv: command(), execute });
  const failed = await runGate({
    stateDir,
    argv: command(),
    verificationConfirmed: true,
    execute,
  });

  assert.equal(failed.executed, true);
  assert.equal(failed.phase, 'terminal');

  const replay = await runGate({ stateDir, argv: command(), execute });
  assert.equal(replay.executed, false);
  assert.equal(replay.code, 'OPERATION_ALREADY_FINALIZED');
  assert.equal(replay.reason, 'operation-already-finalized');
  assert.equal(replay.previousOutcome, 'failed');
});

test('initial no-auth-state result receives initial context and creates no gate state', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-no-auth-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const contexts = [];

  const outcome = await runGate({
    stateDir,
    argv: command(),
    execute: async (_argv, context) => {
      contexts.push(context);
      return {
        ...result(69, 'BROWSER_CONNECT'),
        commandExecuted: false,
        stateDisposition: 'no-auth-state',
      };
    },
  });

  assert.deepEqual(contexts, [{ attemptKind: 'initial' }]);
  assert.equal(outcome.exitCode, 69);
  assert.equal(outcome.commandExecuted, false);
  assert.equal('stateDisposition' in outcome, false);
  assert.deepEqual(await readdir(stateDir), []);
});

test('typed initial BROWSER_CONNECT does not consume authentication state', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-bridge-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));

  const outcome = await runGate({
    stateDir,
    argv: command(),
    execute: async () => result(69, 'BROWSER_CONNECT'),
  });

  assert.equal(outcome.phase, 'initial');
  assert.deepEqual(await readdir(stateDir), []);
});

test('confirmed rerun count is persisted before callback', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-confirmed-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const contexts = [];
  let persistedDuringRerun;
  const selectedCommand = command();
  const statePath = join(stateDir, `${operationFingerprint(selectedCommand)}.json`);
  const execute = async (_argv, context) => {
    contexts.push(context);
    if (context.attemptKind === 'initial') return result(77, 'AUTH_REQUIRED');
    persistedDuringRerun = JSON.parse(await readFile(statePath, 'utf8'));
    return result(77, 'AUTH_REQUIRED');
  };

  await runGate({ stateDir, argv: selectedCommand, execute });
  const rerun = await runGate({
    stateDir,
    argv: selectedCommand,
    verificationConfirmed: true,
    execute,
  });

  assert.deepEqual(contexts, [
    { attemptKind: 'initial' },
    { attemptKind: 'confirmed-rerun' },
  ]);
  assert.equal(persistedDuringRerun.phase, 'rerun-consumed');
  assert.equal(persistedDuringRerun.confirmedRerunCount, 1);
  assert.equal(rerun.phase, 'waiting-confirmation');
});

test('legacy interrupted rerun consumes one attempt and waits for fresh confirmation', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-legacy-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const selectedCommand = command();
  const statePath = join(stateDir, `${operationFingerprint(selectedCommand)}.json`);
  await writeFile(statePath, `${JSON.stringify({
    schemaVersion: '1.0',
    phase: 'rerun-consumed',
    initialAttempts: 1,
    rerunConsumed: true,
    lastCode: 'AUTH_REQUIRED',
  })}\n`, { mode: 0o600 });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return result(77, 'AUTH_REQUIRED');
  };

  const recovered = await runGate({
    stateDir,
    argv: selectedCommand,
    verificationConfirmed: true,
    execute,
  });
  assert.equal(recovered.executed, false);
  assert.equal(recovered.phase, 'waiting-confirmation');
  assert.equal(executions, 0);

  const rerun = await runGate({
    stateDir,
    argv: selectedCommand,
    verificationConfirmed: true,
    execute,
  });
  assert.equal(rerun.phase, 'waiting-confirmation');
  assert.equal(executions, 1);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).confirmedRerunCount, 2);
});

test('an existing terminal state is not revived by the larger budget', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-terminal-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const selectedCommand = command();
  const statePath = join(stateDir, `${operationFingerprint(selectedCommand)}.json`);
  await writeFile(statePath, `${JSON.stringify({
    schemaVersion: '1.0',
    phase: 'terminal',
    initialAttempts: 1,
    rerunConsumed: true,
    lastCode: 'AUTH_REQUIRED',
  })}\n`, { mode: 0o600 });
  let executions = 0;

  const blocked = await runGate({
    stateDir,
    argv: selectedCommand,
    verificationConfirmed: true,
    execute: async () => {
      executions += 1;
      return result(0);
    },
  });

  assert.equal(blocked.executed, false);
  assert.equal(blocked.phase, 'terminal');
  assert.equal(blocked.reason, 'login-gate-rerun-exhausted');
  assert.equal(executions, 0);
});

function runGateCli(args, env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [gateScript, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('close', code => resolveRun({ code, stdout, stderr }));
  });
}

test('CLI replay executes the initial attempt and up to ten explicitly confirmed reruns', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'weixin-login-gate-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDir = join(root, 'state');
  const fakeBycli = join(root, 'bycli');
  const counter = join(root, 'executions.log');
  await writeFile(fakeBycli, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(process.env.WEIXIN_GATE_TEST_COUNTER, 'executed\\n');
process.stderr.write(JSON.stringify({ ok: false, error: { code: 'AUTH_REQUIRED', exitCode: 77 } }) + '\\n');
process.exit(77);
`);
  await chmod(fakeBycli, 0o700);
  const commandArgs = [
    '--state-dir', stateDir, '--', fakeBycli, 'weixin', 'download',
    '--url', ARTICLE_URL, '--output', join(root, 'output'),
    '--site-session', 'persistent', '--keep-tab', 'true', '-f', 'json',
  ];
  const env = { WEIXIN_GATE_TEST_COUNTER: counter };

  const initial = await runGateCli(commandArgs, env);
  assert.equal(initial.code, 77);
  assert.match(initial.stderr, /AUTH_REQUIRED/);

  const plainRetry = await runGateCli(commandArgs, env);
  assert.equal(plainRetry.code, 77);
  assert.match(plainRetry.stderr, /explicit-verification-confirmation-required/);

  for (let rerun = 1; rerun <= 10; rerun += 1) {
    const confirmed = await runGateCli([
      '--state-dir', stateDir, '--verification-confirmed', 'true',
      ...commandArgs.slice(2),
    ], env);
    assert.equal(confirmed.code, 77);
    assert.match(confirmed.stderr, /AUTH_REQUIRED/);
  }

  for (let retry = 0; retry < 4; retry += 1) {
    const terminal = await runGateCli(commandArgs, env);
    assert.equal(terminal.code, 1);
    const payload = JSON.parse(terminal.stderr);
    assert.equal(payload.error.code, 'AUTH_RETRY_EXHAUSTED');
    assert.equal(payload.error.retryable, false);
    assert.equal(payload.error.requiresUserAction, false);
  }
  assert.equal((await readFile(counter, 'utf8')).trim().split('\n').length, 11);
});

test('CLI finalized replay reports a distinct non-authentication error', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'weixin-login-gate-cli-finalized-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDir = join(root, 'state');
  const fakeBycli = join(root, 'bycli');
  await writeFile(fakeBycli, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ ok: true, records: [] }) + '\\n');
`);
  await chmod(fakeBycli, 0o700);
  const args = [
    '--state-dir', stateDir, '--', fakeBycli, 'weixin', 'published',
    '--limit', '20', '-f', 'json',
  ];

  const initial = await runGateCli(args, {});
  const replay = await runGateCli(args, {});

  assert.equal(initial.code, 0);
  assert.equal(replay.code, 1);
  const payload = JSON.parse(replay.stderr);
  assert.equal(payload.error.code, 'OPERATION_ALREADY_FINALIZED');
  assert.equal(payload.error.previousOutcome, 'succeeded');
  assert.equal(payload.error.retryable, false);
  assert.equal(payload.error.requiresUserAction, false);
  assert.doesNotMatch(replay.stderr, /AUTH_REQUIRED/);
});
