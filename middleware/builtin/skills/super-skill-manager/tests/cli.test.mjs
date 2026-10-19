import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { errorEnvelope, successEnvelope } from '../scripts/core/envelope.mjs';
import { runCommand, signalOwnedProcess } from '../scripts/core/process.mjs';
import { main, parseArgs } from '../scripts/manager.mjs';

const execFileAsync = promisify(execFile);
const managerPath = new URL('../scripts/manager.mjs', import.meta.url);
const sourcesPath = new URL('../scripts/sources.json', import.meta.url);

test('parseArgs parses a read search command into the stable contract shape', () => {
  assert.deepEqual(parseArgs(['read', 'search', 'code review']), {
    group: 'read',
    action: 'search',
    query: 'code review',
    type: 'all',
    sources: [],
    limit: 10,
    json: false,
    refresh: false,
    noCache: false,
    confirmed: false,
    queryAliases: [],
    provider: null,
    target: null,
    riskConfirmationToken: null,
  });
});

test('parseArgs accepts every command family and action with its minimum operands', () => {
  const commands = [
    ['create', 'install', 'candidate'],
    ['create', 'scaffold', 'name'],
    ['create', 'import', '/tmp/skill'],
    ['create', 'restore', 'trash-id'],
    ['read', 'search', 'query'],
    ['read', 'list'],
    ['read', 'show', 'name'],
    ['read', 'audit', 'name'],
    ['read', 'doctor'],
    ['update', 'upgrade', 'name'],
    ['update', 'edit', 'name'],
    ['update', 'repair', 'name'],
    ['update', 'enable', 'name'],
    ['update', 'disable', 'name'],
    ['update', 'pin', 'name'],
    ['update', 'unpin', 'name'],
    ['delete', 'remove', 'name'],
    ['delete', 'purge', 'name'],
  ];

  for (const command of commands) {
    assert.equal(parseArgs(command).group, command[0], command.join(' '));
  }
});

test('parseArgs applies table-driven operand and flag contracts to every action', () => {
  const commandTable = [
    { argv: ['create', 'install', 'candidate'], operand: 'candidate', flags: ['provider', 'target', 'confirm'] },
    { argv: ['create', 'scaffold', 'name'], operand: 'name', flags: ['provider', 'target', 'confirm'] },
    { argv: ['create', 'import', '/tmp/skill'], operand: 'path', flags: ['target', 'confirm'] },
    { argv: ['create', 'restore', 'trash-id'], operand: 'trashId', flags: ['confirm'] },
    { argv: ['read', 'search', 'query'], operand: 'query', flags: ['type', 'source', 'limit', 'json', 'refresh', 'no-cache', 'query-alias'] },
    { argv: ['read', 'list'], operand: null, flags: ['provider', 'json'] },
    { argv: ['read', 'show', 'name'], operand: 'name', flags: ['provider', 'json'] },
    { argv: ['read', 'audit', 'name'], operand: 'name', flags: ['provider', 'json'] },
    { argv: ['read', 'doctor'], operand: null, flags: ['json'] },
    ...['upgrade', 'edit', 'repair', 'enable', 'disable', 'pin', 'unpin'].map((action) => ({
      argv: ['update', action, 'name'],
      operand: 'name',
      flags: ['provider', 'confirm'],
    })),
    ...['remove', 'purge'].map((action) => ({
      argv: ['delete', action, 'name'],
      operand: 'name',
      flags: ['provider', 'confirm'],
    })),
  ];
  const flagArguments = {
    provider: ['--provider', 'local'],
    target: ['--target', '/tmp/target'],
    type: ['--type', 'skill'],
    source: ['--source', 'clawhub'],
    limit: ['--limit', '2'],
    json: ['--json'],
    refresh: ['--refresh'],
    'no-cache': ['--no-cache'],
    'query-alias': ['--query-alias', 'alias'],
    confirm: ['--confirm'],
  };

  for (const entry of commandTable) {
    const parsed = parseArgs(entry.argv);
    if (entry.operand) assert.equal(parsed[entry.operand], entry.argv[2], entry.argv.join(' '));
    for (const flag of entry.flags) {
      assert.doesNotThrow(() => parseArgs([...entry.argv, ...flagArguments[flag]]), `${entry.argv.join(' ')} --${flag}`);
    }
    for (const [flag, flagArgv] of Object.entries(flagArguments)) {
      if (!entry.flags.includes(flag)) {
        assert.throws(() => parseArgs([...entry.argv, ...flagArgv]), /not valid/, `${entry.argv.join(' ')} --${flag}`);
      }
    }
  }
});

test('parseArgs rejects invalid command inputs', () => {
  const invalidInputs = [
    ['delete', 'remove'],
    ['unknown', 'action'],
    ['read', 'unknown'],
    ['read', 'search', 'query', '--bogus'],
    ['read', 'search', 'query', '--limit', '1', '--limit', '2'],
    ['read', 'search', 'query', '--type', 'other'],
    ['read', 'search', 'query', '--source', ','],
    ['read', 'search', 'query', '--limit', '1.5'],
    ['read', 'search', 'query', '--limit', '0'],
    ['read', 'search', 'query', '--limit', '01'],
    ['read', 'search', 'query', '--limit', '+1'],
    ['read', 'search', 'query', '--limit', '1e2'],
    ['read', 'search', 'query', '--limit', '9'.repeat(400)],
    ['read', 'search', 'query', '--provider', 'local'],
    ['read', 'doctor', '--refresh'],
    ['delete', 'remove', 'name', 'extra'],
  ];

  for (const input of invalidInputs) {
    assert.throws(() => parseArgs(input), Error, input.join(' '));
  }
});

test('parseArgs normalizes sources and supports up to three search aliases', () => {
  const parsed = parseArgs([
    'read',
    'search',
    'query',
    '--source',
    ' clawhub, smithery ,clawhub ',
    '--query-alias',
    'review',
    '--query-alias',
    'audit',
    '--query-alias',
    'inspect',
  ]);

  assert.deepEqual(parsed.sources, ['clawhub', 'smithery']);
  assert.deepEqual(parsed.queryAliases, ['review', 'audit', 'inspect']);
  assert.throws(() => parseArgs(['read', 'search', 'query', '--query-alias', '']), /non-empty/);
  assert.throws(
    () =>
      parseArgs([
        'read',
        'search',
        'query',
        '--query-alias',
        'one',
        '--query-alias',
        'two',
        '--query-alias',
        'three',
        '--query-alias',
        'four',
      ]),
    /at most three/,
  );
  assert.throws(() => parseArgs(['read', 'list', '--query-alias', 'query']), /not valid/);
});

test('parseArgs records confirmation for mutating commands', () => {
  assert.equal(parseArgs(['delete', 'remove', 'name']).confirmed, false);
  assert.equal(parseArgs(['delete', 'remove', 'name', '--confirm']).confirmed, true);
});

test('create scaffold accepts an explicit provider and keeps its preview/confirmation route', async () => {
  const output = { text: '', write(value) { this.text += value; } };
  const calls = [];
  const byclawWorkspaceProvider = {
    preview: async (request) => { calls.push(['preview', request]); return successEnvelope({ source: 'byclaw-workspace', data: [{ confirmationToken: 'preview-token' }] }); },
    scaffold: async (request) => { calls.push(['scaffold', request]); return successEnvelope({ source: 'byclaw-workspace' }); },
  };
  const openclawProvider = { scaffold: async () => { throw new Error('must not be called'); } };
  assert.equal(parseArgs(['create', 'scaffold', 'demo', '--provider', 'byclaw-workspace']).provider, 'byclaw-workspace');
  assert.equal(await main(['create', 'scaffold', 'demo', '--provider', 'byclaw-workspace'], { stdout: output, byclawWorkspaceProvider, openclawProvider }), 0);
  assert.equal(await main(['create', 'scaffold', 'demo', '--provider', 'byclaw-workspace', '--confirm', 'preview-token'], { stdout: output, byclawWorkspaceProvider, openclawProvider }), 0);
  assert.deepEqual(calls, [
    ['preview', { operation: 'scaffold', name: 'demo' }],
    ['scaffold', { name: 'demo', trackedBy: 'byclaw-workspace', confirmationToken: 'preview-token', riskConfirmationToken: null }],
  ]);
});

test('envelopes match the provider contract exactly', () => {
  assert.deepEqual(successEnvelope({ source: 'skills-sh', data: [], warnings: [], elapsedMs: 12 }), {
    ok: true,
    source: 'skills-sh',
    data: [],
    warnings: [],
    elapsedMs: 12,
  });
  assert.deepEqual(
    errorEnvelope({
      source: 'glama',
      code: 'SOURCE_TIMEOUT',
      message: 'glama exceeded 8000 ms',
      elapsedMs: 8001,
    }),
    {
      ok: false,
      source: 'glama',
      data: [],
      error: { code: 'SOURCE_TIMEOUT', message: 'glama exceeded 8000 ms' },
      elapsedMs: 8001,
    },
  );
});

test('runCommand captures successful and nonzero child processes', async () => {
  const successful = await runCommand({
    command: process.execPath,
    args: ['-e', "process.stdout.write('ok'); process.stderr.write('note')"],
    timeoutMs: 1_000,
  });
  const { elapsedMs, ...successFields } = successful;
  assert.deepEqual(
    successFields,
    {
      ok: true,
      command: process.execPath,
      args: ['-e', "process.stdout.write('ok'); process.stderr.write('note')"],
      exitCode: 0,
      signal: null,
      stdout: 'ok',
      stderr: 'note',
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      outputLimitExceeded: false,
      errorCode: null,
    },
  );
  assert.ok(elapsedMs >= 0);

  const failed = await runCommand({
    command: process.execPath,
    args: ['-e', "process.stderr.write('nope'); process.exit(7)"],
    timeoutMs: 1_000,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.stderr, 'nope');
  assert.equal(failed.timedOut, false);
});

test('runCommand terminates a process that exceeds its deadline', async () => {
  const result = await runCommand({
    command: process.execPath,
    args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    timeoutMs: 50,
  });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.ok(result.elapsedMs >= 50);
  assert.ok(result.elapsedMs < 1_000);
});

test('runCommand kills descendants that retain inherited pipes after the deadline', { skip: process.platform === 'win32' }, async () => {
  const startedAt = performance.now();
  const result = await runCommand({
    command: process.execPath,
    args: [
      '-e',
      "const { spawn } = require('node:child_process'); const descendant = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setTimeout(() => {}, 2500)\"], { stdio: 'inherit' }); process.stdout.write(`DESCENDANT_PID:${descendant.pid}\\n`); setInterval(() => {}, 1000);",
    ],
    timeoutMs: 150,
  });
  const wallClockMs = performance.now() - startedAt;
  assert.equal(result.timedOut, true);
  assert.ok(wallClockMs < 1_000, `expected deadline-bounded completion, got ${wallClockMs}ms`);
  const pid = Number(/DESCENDANT_PID:(\d+)/.exec(result.stdout)?.[1]);
  assert.ok(Number.isSafeInteger(pid), `missing descendant PID in ${result.stdout}`);
  try {
    process.kill(pid, 0);
    throw new Error(`descendant ${pid} remained alive after runCommand returned`);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // The descendant may have exited during cleanup.
      }
      throw error;
    }
  }
});

test('runCommand bounds stream output and terminates a noisy process', async () => {
  const result = await runCommand({
    command: process.execPath,
    args: [
      '-e',
      "process.on('SIGTERM', () => {}); process.stdout.write('abcdefghijklmnopqrstuvwxyz'); setTimeout(() => process.stderr.write('note'), 20); setInterval(() => {}, 1000)",
    ],
    timeoutMs: 1_000,
    maxOutputBytes: 8,
  });
  assert.equal(result.ok, false);
  assert.equal(result.outputLimitExceeded, true);
  assert.equal(result.errorCode, 'OUTPUT_LIMIT');
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stdout, 'abcdefgh');
  assert.ok(Buffer.byteLength(result.stdout) <= 8);
  assert.equal(result.stderr, 'note');
  assert.equal(result.stderrTruncated, false);
});

test('runCommand decodes UTF-8 data split across stream chunks', async () => {
  const result = await runCommand({
    command: process.execPath,
    args: [
      '-e',
      "const value = Buffer.from('€'); process.stdout.write(value.subarray(0, 2)); setTimeout(() => process.stdout.write(value.subarray(2)), 10);",
    ],
    timeoutMs: 1_000,
  });
  assert.equal(result.stdout, '€');
  assert.equal(result.stdoutTruncated, false);
});

test('runCommand redacts secrets split across delayed output chunks before capping', async () => {
  const secret = 'abcdefgh';
  const result = await runCommand({
    command: process.execPath,
    args: [
      '-e',
      "process.stdout.write(process.env.STREAM_TOKEN.slice(0, 3)); setTimeout(() => process.stdout.write(process.env.STREAM_TOKEN.slice(3)), 10);",
    ],
    timeoutMs: 1_000,
    env: { STREAM_TOKEN: secret },
    maxOutputBytes: 64,
  });
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(result.stdout, '[REDACTED]');

  const stderrResult = await runCommand({
    command: process.execPath,
    args: [
      '-e',
      "process.stderr.write(process.env.STREAM_TOKEN.slice(0, 3)); setTimeout(() => process.stderr.write(process.env.STREAM_TOKEN.slice(3)), 10);",
    ],
    timeoutMs: 1_000,
    env: { STREAM_TOKEN: secret },
    maxOutputBytes: 64,
  });
  assert.equal(stderrResult.stderr.includes(secret), false);
  assert.equal(stderrResult.stderr, '[REDACTED]');

  const capped = await runCommand({
    command: process.execPath,
    args: ['-e', 'process.stdout.write(process.env.STREAM_TOKEN)'],
    timeoutMs: 1_000,
    env: { STREAM_TOKEN: secret },
    maxOutputBytes: 4,
  });
  assert.equal(capped.stdout.includes(secret.slice(0, 4)), false);
  assert.equal(capped.stdout, '[RED');
  assert.equal(capped.stdoutTruncated, true);
});

test('runCommand conservatively redacts an incomplete secret prefix at forced termination', async () => {
  const secret = 'abcdefgh';
  const result = await runCommand({
    command: process.execPath,
    args: [
      '-e',
      "process.stdout.write(process.env.PREFIX_TOKEN.slice(0, 4)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    ],
    timeoutMs: 50,
    env: { PREFIX_TOKEN: secret },
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.stdout.includes(secret.slice(0, 4)), false);
  assert.equal(result.stdout, '[REDACTED]');
});

test('runCommand does not recursively redact replacement text for multiple secrets', async () => {
  const result = await runCommand({
    command: process.execPath,
    args: ['-e', 'process.stdout.write(process.env.LONG_TOKEN + process.env.SHORT_TOKEN)'],
    timeoutMs: 1_000,
    env: { LONG_TOKEN: 'alpha', SHORT_TOKEN: 'RED' },
  });
  assert.equal(result.stdout, '[REDACTED][REDACTED]');
});

test('runCommand redacts overlapping secrets across every chunk split without leaking suffixes', async () => {
  const secret = 'abcdefgh';
  const env = { SHORT_TOKEN: 'abc', LONG_TOKEN: secret };

  for (let split = 1; split < secret.length; split += 1) {
    const result = await runCommand({
      command: process.execPath,
      args: [
        '-e',
        `process.stdout.write(${JSON.stringify(secret.slice(0, split))}); setTimeout(() => process.stdout.write(${JSON.stringify(secret.slice(split))}), 5);`,
      ],
      timeoutMs: 1_000,
      env,
    });
    assert.equal(result.stdout, '[REDACTED]', `split at ${split}`);
    assert.equal(result.stdout.includes(secret), false, `split at ${split} leaked the full secret`);
    assert.equal(result.stdout.includes(secret.slice(split)), false, `split at ${split} leaked a suffix`);
  }

  const disambiguated = await runCommand({
    command: process.execPath,
    args: ['-e', "process.stdout.write('abc'); setTimeout(() => process.stdout.write('X'), 5);"],
    timeoutMs: 1_000,
    env,
  });
  assert.equal(disambiguated.stdout, '[REDACTED]X');

  const finalShortSecret = await runCommand({
    command: process.execPath,
    args: ['-e', "process.stdout.write('abc')"],
    timeoutMs: 1_000,
    env,
  });
  assert.equal(finalShortSecret.stdout, '[REDACTED]');
});

test('signalOwnedProcess invokes taskkill with an argument array on Windows', () => {
  const calls = [];
  const spawnCommand = (...args) => {
    calls.push(args);
    return { once: () => undefined };
  };
  const child = { pid: 4321, kill: () => assert.fail('child.kill should not be used on Windows') };

  signalOwnedProcess({ child, signal: 'SIGTERM', detached: false, platform: 'win32', spawnCommand });
  signalOwnedProcess({ child, signal: 'SIGKILL', detached: false, platform: 'win32', spawnCommand });

  assert.deepEqual(calls, [
    ['taskkill.exe', ['/PID', '4321', '/T'], { shell: false, stdio: 'ignore', windowsHide: true }],
    ['taskkill.exe', ['/PID', '4321', '/T', '/F'], { shell: false, stdio: 'ignore', windowsHide: true }],
  ]);
  assert.doesNotThrow(() =>
    signalOwnedProcess({
      child,
      signal: 'SIGTERM',
      detached: false,
      platform: 'win32',
      spawnCommand: () => {
        throw new Error('taskkill missing');
      },
    }),
  );
});

test('runCommand validates command boundaries before spawning', () => {
  assert.throws(() => runCommand({ command: '', timeoutMs: 1 }), /command/);
  assert.throws(() => runCommand({ command: process.execPath, args: [1], timeoutMs: 1 }), /args/);
  assert.throws(() => runCommand({ command: process.execPath, cwd: 1, timeoutMs: 1 }), /cwd/);
  assert.throws(() => runCommand({ command: process.execPath, env: [], timeoutMs: 1 }), /env/);
  assert.throws(() => runCommand({ command: process.execPath, env: { TOKEN: {} }, timeoutMs: 1 }), /env/);
  assert.throws(() => runCommand({ command: process.execPath, timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => runCommand({ command: process.execPath, timeoutMs: 1, maxOutputBytes: 0 }), /maxOutputBytes/);
});

test('runCommand returns a structural result for a missing command and redacts secrets', async () => {
  const missing = await runCommand({ command: 'manager-command-does-not-exist', timeoutMs: 1_000 });
  assert.equal(missing.ok, false);
  assert.equal(missing.exitCode, null);
  assert.match(missing.stderr, /ENOENT|not found/i);

  const secret = 'not-for-output';
  const redacted = await runCommand({
    command: process.execPath,
    args: ['-e', 'process.stdout.write(process.env.MANAGER_TOKEN)'],
    timeoutMs: 1_000,
    env: { MANAGER_TOKEN: secret },
  });
  assert.equal(redacted.stdout.includes(secret), false);
  assert.match(redacted.stdout, /REDACTED/);

  const numericSecret = 12345;
  const numericRedacted = await runCommand({
    command: process.execPath,
    args: ['-e', 'process.stdout.write(process.env.NUM_TOKEN)'],
    timeoutMs: 1_000,
    env: { NUM_TOKEN: numericSecret },
  });
  assert.equal(numericRedacted.stdout.includes(String(numericSecret)), false);
  assert.match(numericRedacted.stdout, /REDACTED/);

  const inheritedSecret = 'also-not-for-output';
  process.env.MANAGER_INHERITED_TOKEN = inheritedSecret;
  try {
    const inherited = await runCommand({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.env.MANAGER_INHERITED_TOKEN)'],
      timeoutMs: 1_000,
    });
    assert.equal(inherited.stdout.includes(inheritedSecret), false);
    assert.match(inherited.stdout, /REDACTED/);
  } finally {
    delete process.env.MANAGER_INHERITED_TOKEN;
  }
});

test('sources configuration has safe unique source capabilities and deadlines', async () => {
  const config = JSON.parse(await readFile(sourcesPath, 'utf8'));
  const expectedConfig = {
    sourceTimeoutMs: 8000,
    totalTimeoutMs: 20000,
    cacheTtlMs: 1800000,
    sources: [
      { id: 'clawhub', kinds: ['skill'], enabled: true },
      { id: 'skills-sh', kinds: ['skill'], enabled: true },
      { id: 'findskills-cn', kinds: ['skill'], enabled: true },
      { id: 'smithery', kinds: ['skill', 'mcp'], enabled: true },
      { id: 'glama', kinds: ['mcp'], enabled: true },
      { id: 'github', kinds: ['skill'], enabled: true, unverified: true },
    ],
  };

  assert.deepEqual(config, expectedConfig);
  assert.equal(config.sourceTimeoutMs, 8000);
  assert.equal(config.totalTimeoutMs, 20000);
  assert.equal(config.cacheTtlMs, 1800000);
  assert.ok(Number.isFinite(config.sourceTimeoutMs) && config.sourceTimeoutMs > 0);
  assert.ok(Number.isFinite(config.totalTimeoutMs) && config.totalTimeoutMs >= config.sourceTimeoutMs);
  assert.equal(new Set(config.sources.map(({ id }) => id)).size, config.sources.length);
  for (const source of config.sources) {
    assert.ok(source.id.length > 0);
    assert.ok(source.kinds.every((kind) => ['skill', 'mcp'].includes(kind)));
  }
});

test('importing manager has no CLI side effect', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import ${JSON.stringify(managerPath.href)};`,
  ]);
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('CLI help is JSON-safe, side-effect free, and identifies unavailable commands', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [managerPath.pathname, '--help', '--json']);
  assert.equal(stderr, '');
  const envelope = JSON.parse(stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.source, 'manager');
  assert.ok(envelope.data.some((command) => command.group === 'create' && command.action === 'install' && command.status === 'implemented'));
  assert.ok(envelope.data.some((command) => command.group === 'create' && command.action === 'restore' && command.status === 'not-implemented'));
});

test('symlink invocation recognizes manager as the ESM entrypoint', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'super-skill-manager-link-'));
  const linkedManager = path.join(directory, 'manager-link.mjs');
  try {
    await symlink(managerPath.pathname, linkedManager);
    const { stdout, stderr } = await execFileAsync(process.execPath, [linkedManager, '--help', '--json']);
    assert.equal(stderr, '');
    assert.equal(JSON.parse(stdout).ok, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI parser errors use one structured nonzero JSON envelope', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [managerPath.pathname, 'delete', 'remove']),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.equal(error.stdout, '');
      const lines = error.stderr.trim().split('\n');
      assert.equal(lines.length, 1);
      const envelope = JSON.parse(lines[0]);
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, 'INVALID_ARGUMENTS');
      return true;
    },
  );
});

test('CLI writes complete one-line envelopes for unsupported commands', async () => {
  const cases = [
    {
      argv: ['update', 'edit', 'name', '--confirm'],
      code: 'NOT_IMPLEMENTED',
    },
  ];

  for (const testCase of cases) {
    await assert.rejects(
      execFileAsync(process.execPath, [managerPath.pathname, ...testCase.argv]),
      (error) => {
        assert.notEqual(error.code, 0);
        assert.equal(error.stderr, '');
        const lines = error.stdout.trim().split('\n');
        assert.equal(lines.length, 1);
        const envelope = JSON.parse(lines[0]);
        assert.equal(envelope.ok, false);
        assert.equal(envelope.error.code, testCase.code);
        return true;
      },
    );
  }
});
