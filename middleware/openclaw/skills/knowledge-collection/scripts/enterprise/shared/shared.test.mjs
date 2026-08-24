import assert from 'node:assert/strict';
import { access, chmod, link, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { assertPrivateTree, executable, readJson, runNode, tempCase } from '../test-helpers.mjs';
import { runCli } from './cli-runner.mjs';

const pollIntervalMs = 10;
const knowledgeCollectionScript = new URL('../../knowledge-collection.mjs', import.meta.url).pathname;

async function waitFor(condition, description, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPidIfAvailable(path) {
  try {
    const pid = Number(await readFile(path, 'utf8'));
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function forceCleanupTestProcess(pid) {
  if (!pid || !processIsRunning(pid)) return;
  process.kill(pid, 'SIGKILL');
  await waitFor(() => !processIsRunning(pid), `test process ${pid} cleanup`);
}

test('positiveEnv accepts only positive integer environment values', async () => {
  const { DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_TIMEOUT_MS, positiveEnv } = await import('./cli-runner.mjs');

  assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
  assert.equal(DEFAULT_MAX_OUTPUT_BYTES, 10 * 1024 * 1024);
  assert.equal(positiveEnv('LIMIT', 9, { LIMIT: '12' }), 12);
  for (const value of ['', '0', '-1', '1.5', 'nope']) {
    assert.equal(positiveEnv('LIMIT', 9, { LIMIT: value }), 9);
  }
});

test('runCli rejects invalid explicit bounds before spawning', async (t) => {
  const invalidValues = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];

  for (const name of ['timeoutMs', 'maxOutputBytes']) {
    await t.test(name, async () => {
      for (const value of invalidValues) {
        await assert.rejects(
          runCli(process.execPath, ['-e', ''], { [name]: value }),
          {
            name: 'TypeError',
            message: `${name} must be a positive safe integer`,
          },
        );
      }
    });
  }
});

test('runCli validates cwd and executes the child in the requested directory', async () => {
  await assert.rejects(
    runCli(process.execPath, ['-e', ''], { cwd: '' }),
    { name: 'TypeError', message: 'cwd must be a non-empty string' },
  );
  await assert.rejects(
    runCli(process.execPath, ['-e', ''], { cwd: 42 }),
    { name: 'TypeError', message: 'cwd must be a non-empty string' },
  );

  const { root } = await tempCase('enterprise-cli-cwd-');
  try {
    const result = await runCli(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd: root });
    assert.equal(result.stdout, await realpath(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runCli enforces the Node timer delay boundary without limiting output bytes', async (t) => {
  const maxTimerDelayMs = 2_147_483_647;

  await t.test('accepts the maximum explicit timeout', async () => {
    const result = await runCli(process.execPath, ['-e', ''], { timeoutMs: maxTimerDelayMs });
    assert.equal(result.exitCode, 0);
  });

  await t.test('rejects an explicit timeout above the maximum', async () => {
    await assert.rejects(
      runCli(process.execPath, ['-e', ''], { timeoutMs: maxTimerDelayMs + 1 }),
      {
        name: 'TypeError',
        message: `timeoutMs must be an integer between 1 and ${maxTimerDelayMs}`,
      },
    );
  });

  await t.test('accepts the maximum environment timeout', async () => {
    const result = await runCli(process.execPath, ['-e', ''], {
      env: { ...process.env, KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS: String(maxTimerDelayMs) },
    });
    assert.equal(result.exitCode, 0);
  });

  await t.test('falls back when the environment timeout exceeds the maximum', async () => {
    const result = await runCli(process.execPath, ['-e', ''], {
      env: { ...process.env, KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS: String(maxTimerDelayMs + 1) },
    });
    assert.equal(result.exitCode, 0);
  });

  await t.test('does not apply the timer maximum to output bytes', async () => {
    const result = await runCli(process.execPath, ['-e', ''], { maxOutputBytes: maxTimerDelayMs + 1 });
    assert.equal(result.exitCode, 0);
  });
});

test('runCli reads default bounds from the child environment with explicit options taking priority', async (t) => {
  await t.test('environment timeout', async () => {
    await assert.rejects(
      runCli(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], {
        env: { ...process.env, KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS: '25' },
      }),
      /timeout after 25ms/,
    );
  });

  await t.test('environment output limit', async () => {
    await assert.rejects(
      runCli(process.execPath, ['-e', "process.stdout.write('12345678901234567')"], {
        env: { ...process.env, KNOWLEDGE_COLLECTION_MAX_CLI_OUTPUT_BYTES: '16' },
      }),
      /exceeds 16 bytes/,
    );
  });

  await t.test('explicit timeout', async () => {
    const result = await runCli(process.execPath, ['-e', ''], {
      env: { ...process.env, KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS: '1' },
      timeoutMs: 1_000,
    });
    assert.equal(result.exitCode, 0);
  });

  await t.test('explicit output limit', async () => {
    const result = await runCli(process.execPath, ['-e', "process.stdout.write('1234567890123456')"], {
      env: { ...process.env, KNOWLEDGE_COLLECTION_MAX_CLI_OUTPUT_BYTES: '1' },
      maxOutputBytes: 16,
    });
    assert.equal(result.stdout, '1234567890123456');
  });
});

test('runCli returns non-zero exit codes as structured results', async () => {
  const result = await runCli(process.execPath, ['-e', "process.stderr.write('denied'); process.exit(3)"]);

  assert.deepEqual(result, {
    exitCode: 3,
    stdout: '',
    stderr: 'denied',
    failure: null,
  });
});

test('runCli returns ENOENT as a structured startup failure', async () => {
  const { root } = await tempCase('enterprise-missing-cli-');

  try {
    const result = await runCli(join(root, 'does-not-exist'), []);
    assert.equal(result.exitCode, null);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(result.failure?.code, 'ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runCli rejects after the configured timeout', async () => {
  await assert.rejects(
    runCli(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], { timeoutMs: 25 }),
    /timeout after 25ms/,
  );
});

test('runCli rejects when combined output exceeds the configured byte limit', async () => {
  await assert.rejects(
    runCli(process.execPath, ['-e', "process.stdout.write('12345678901234567')"], { maxOutputBytes: 16 }),
    /exceeds 16 bytes/,
  );
});

test('runCli applies the byte limit across stdout and stderr', async () => {
  await assert.rejects(
    runCli(
      process.execPath,
      ['-e', "process.stdout.write('12345678'); process.stderr.write('123456789')"],
      { maxOutputBytes: 16 },
    ),
    /exceeds 16 bytes/,
  );
});

test('runCli counts UTF-8 output bytes instead of characters', async () => {
  await assert.rejects(
    runCli(process.execPath, ['-e', "process.stdout.write('😀😀')"], { maxOutputBytes: 7 }),
    /exceeds 7 bytes/,
  );
});

test('runCli force-stops process trees that ignore SIGTERM when a bound is exceeded', {
  skip: process.platform === 'win32',
}, async (t) => {
  for (const scenario of [
    {
      name: 'timeout',
      options: { timeoutMs: 500 },
      error: /timeout after 500ms/,
    },
    {
      name: 'output limit',
      options: { maxOutputBytes: 16, timeoutMs: 2_000 },
      error: /exceeds 16 bytes/,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const { root } = await tempCase(`enterprise-force-stop-${scenario.name.replace(' ', '-')}-`);
      const directPidPath = join(root, 'direct.pid');
      const descendantPidPath = join(root, 'descendant.pid');
      let directPid;
      let descendantPid;

      try {
        const descendantFixture = await executable(root, 'descendant.mjs', `
import { writeFileSync } from 'node:fs';
const [pidPath] = process.argv.slice(2);
process.on('SIGTERM', () => {});
writeFileSync(pidPath, String(process.pid));
process.send?.('ready');
setInterval(() => {}, 1_000);
`);
        const fixture = await executable(root, 'ignore-term.mjs', `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [mode, pidPath, descendantFixture, descendantPidPath] = process.argv.slice(2);
process.on('SIGTERM', () => {});
const descendant = spawn(process.execPath, [descendantFixture, descendantPidPath], {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});
descendant.on('message', () => {
  if (mode === 'output') process.stdout.write('12345678901234567');
});
writeFileSync(pidPath, String(process.pid));
setInterval(() => {}, 1_000);
`);
        let rejection;
        const completed = runCli(
          process.execPath,
          [
            fixture,
            scenario.name === 'output limit' ? 'output' : 'timeout',
            directPidPath,
            descendantFixture,
            descendantPidPath,
          ],
          scenario.options,
        ).catch((error) => {
          rejection = error;
        });

        await waitFor(() => fileExists(directPidPath), 'direct child PID file');
        directPid = Number(await readFile(directPidPath, 'utf8'));
        await waitFor(() => fileExists(descendantPidPath), 'descendant PID file');
        descendantPid = Number(await readFile(descendantPidPath, 'utf8'));
        await completed;
        assert.match(rejection?.message ?? '', scenario.error);
        assert.equal(processIsRunning(directPid), false, `direct child ${directPid} survived runCli`);
        assert.equal(processIsRunning(descendantPid), false, `descendant ${descendantPid} survived runCli`);
      } finally {
        descendantPid ??= await readPidIfAvailable(descendantPidPath);
        directPid ??= await readPidIfAvailable(directPidPath);
        await forceCleanupTestProcess(descendantPid);
        await forceCleanupTestProcess(directPid);
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('runCli reports unconfirmed bounded cleanup without leaking kill error details', {
  skip: process.platform === 'win32',
}, async () => {
  const { root } = await tempCase('enterprise-unconfirmed-cleanup-');
  const pidPath = join(root, 'child.pid');
  const originalKill = process.kill;
  let pid;

  try {
    const fixture = await executable(root, 'unconfirmed-cleanup.mjs', `
import { writeFileSync } from 'node:fs';
const [pidPath] = process.argv.slice(2);
writeFileSync(pidPath, String(process.pid));
process.stdout.write('12345678901234567');
setInterval(() => {}, 1_000);
`);
    process.kill = (target, signal) => {
      if (target < 0 && signal === 'SIGKILL') {
        const error = new Error('sensitive fixture detail');
        error.code = 'EPERM';
        throw error;
      }
      return originalKill(target, signal);
    };

    const completed = runCli(process.execPath, [fixture, pidPath], {
      maxOutputBytes: 16,
      timeoutMs: 2_000,
    }).catch((error) => error);
    await waitFor(() => fileExists(pidPath), 'unconfirmed cleanup PID file');
    pid = Number(await readFile(pidPath, 'utf8'));
    const error = await completed;

    assert.match(error.message, /exceeds 16 bytes/);
    assert.equal(error.cleanupUnconfirmed, true);
    assert.deepEqual(error.cleanupFailure, {
      code: 'EPERM',
      operation: 'kill-process-group',
      signal: 'SIGKILL',
    });
    assert.doesNotMatch(JSON.stringify(error.cleanupFailure), /sensitive fixture detail/);
  } finally {
    process.kill = originalKill;
    pid ??= await readPidIfAvailable(pidPath);
    if (pid && processIsRunning(pid)) {
      try {
        originalKill(-pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      await waitFor(() => !processIsRunning(pid), `unconfirmed cleanup process ${pid}`);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('enterprise test helpers create and validate private fixtures', async () => {
  const {
    assertPrivateTree,
    executable,
    readJson,
    runNode,
    tempCase,
  } = await import('../test-helpers.mjs');
  const { root, outputDir } = await tempCase('enterprise-shared-');

  try {
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(outputDir)).mode & 0o777, 0o700);

    const fixture = await executable(root, 'fixture-cli', `#!/usr/bin/env node
console.log(JSON.stringify({ value: process.env.FIXTURE_VALUE, arg: process.argv[2] }));
`);
    assert.equal((await stat(fixture)).mode & 0o777, 0o700);

    const result = await runNode(fixture, ['argument'], { FIXTURE_VALUE: 'from-env' });
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(result.json, { value: 'from-env', arg: 'argument' });

    const nested = join(outputDir, 'nested');
    const jsonPath = join(nested, 'result.json');
    await mkdir(nested, { mode: 0o700 });
    await writeFile(jsonPath, JSON.stringify({ ok: true }), { mode: 0o600 });
    assert.deepEqual(await readJson(jsonPath), { ok: true });
    await assertPrivateTree(outputDir);

    await chmod(jsonPath, 0o644);
    await assert.rejects(assertPrivateTree(outputDir), /mode/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('sanitizeSensitive recursively redacts sensitive keys without changing ordinary values', async () => {
  const { sanitizeSensitive } = await import('./secret-sanitizer.mjs');
  const input = {
    title: 'secret words are ordinary values',
    nested: {
      accessToken: 'token-value',
      profile: { name: 'Ada', device_code: 'device-value' },
    },
    items: [
      { cookie: 'cookie-value', count: 2 },
      'authorization text remains an ordinary array value',
    ],
  };

  assert.deepEqual(sanitizeSensitive(input), {
    title: 'secret words are ordinary values',
    nested: {
      accessToken: '[REDACTED]',
      profile: { name: 'Ada', device_code: '[REDACTED]' },
    },
    items: [
      { cookie: '[REDACTED]', count: 2 },
      'authorization text remains an ordinary array value',
    ],
  });
  assert.equal(input.nested.accessToken, 'token-value');
});

test('sanitizeSensitive redacts nested JSON strings in WeCom envelopes and preserves ordinary strings', async () => {
  const { sanitizeSensitive } = await import('./secret-sanitizer.mjs');
  const envelope = {
    result: {
      content: [{
        type: 'text',
        text: JSON.stringify({ errcode: 0, access_token: 'inside-json', nested: { credential: 'secret' } }),
      }],
    },
    note: 'ordinary non-JSON string',
  };

  const sanitized = sanitizeSensitive(envelope);
  assert.deepEqual(JSON.parse(sanitized.result.content[0].text), {
    errcode: 0,
    access_token: '[REDACTED]',
    nested: { credential: '[REDACTED]' },
  });
  assert.equal(sanitized.note, 'ordinary non-JSON string');
});

test('sanitizeSensitive scrubs credentials from free-form persisted evidence without changing ordinary text', async () => {
  const { sanitizeSensitive } = await import('./secret-sanitizer.mjs');
  const input = {
    stderr: 'request failed: Bearer abc.def-123, access_token=alpha&cookie=session-value password: swordfish device_code=dc-1',
    url: 'https://example.com/callback?token=query-token&keep=ordinary',
    note: 'A secret discussion is ordinary text.',
  };

  const sanitized = sanitizeSensitive(input);
  assert.doesNotMatch(JSON.stringify(sanitized), /abc\.def-123|alpha|session-value|swordfish|dc-1|query-token/);
  assert.match(sanitized.stderr, /Bearer \[REDACTED\]/);
  assert.match(sanitized.url, /token=\[REDACTED\]&keep=ordinary/);
  assert.equal(sanitized.note, input.note);
});

test('sanitizeSensitive clearly rejects circular structures', async () => {
  const { sanitizeSensitive } = await import('./secret-sanitizer.mjs');
  const circular = {};
  circular.self = circular;

  assert.throws(() => sanitizeSensitive(circular), /circular/i);
});

test('createArtifactWriter requires a new absolute output root and creates a private tree', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root, outputDir } = await tempCase('enterprise-artifact-root-');
  const newRoot = join(root, 'new-output');

  try {
    await assert.rejects(createArtifactWriter('relative/output'), /absolute path/);
    await assert.rejects(createArtifactWriter(outputDir), /must not already exist/);
    const writer = await createArtifactWriter(newRoot);
    assert.equal(writer.absolute('raw/value.json'), join(newRoot, 'raw/value.json'));
    await assertPrivateTree(newRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createArtifactWriter privately creates missing parents without changing existing parent permissions', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-artifact-missing-parents-');
  const outputRoot = join(root, 'missing/a/output');

  try {
    await chmod(root, 0o755);
    const writer = await createArtifactWriter(outputRoot);

    assert.equal(writer.absolute('raw/value.json'), join(outputRoot, 'raw/value.json'));
    assert.equal((await stat(root)).mode & 0o777, 0o755);
    await assertPrivateTree(join(root, 'missing'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createArtifactWriter atomically allows only one concurrent owner for a new root', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-artifact-concurrent-');
  const outputRoot = join(root, 'missing/a/output');

  try {
    const results = await Promise.allSettled([
      createArtifactWriter(outputRoot),
      createArtifactWriter(outputRoot),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejection = results.find((result) => result.status === 'rejected');
    assert.match(rejection.reason.message, /must not already exist/);
    await assertPrivateTree(join(root, 'missing'));
    assert.deepEqual(
      (await readdir(join(root, 'missing/a'))).filter((name) => /staging|initializ/i.test(name)),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createArtifactWriter rejects unsafe existing parent components', async (t) => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');

  await t.test('symbolic link parent', async () => {
    const { root } = await tempCase('enterprise-artifact-parent-link-');
    const outside = join(root, 'outside');
    try {
      await mkdir(outside, { mode: 0o700 });
      await symlink(outside, join(root, 'linked'));
      await assert.rejects(
        createArtifactWriter(join(root, 'linked/missing/output')),
        /parent.*symbolic link|outside output root/,
      );
      assert.equal(await fileExists(join(outside, 'missing/output')), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('non-directory parent', async () => {
    const { root } = await tempCase('enterprise-artifact-parent-file-');
    try {
      await writeFile(join(root, 'blocked'), 'file', { mode: 0o600 });
      await assert.rejects(
        createArtifactWriter(join(root, 'blocked/missing/output')),
        /parent.*directory/,
      );
      await rm(join(root, 'blocked'));
      await mkdir(join(root, 'blocked'), { mode: 0o700 });
      await createArtifactWriter(join(root, 'blocked/missing/output'));
      await assertPrivateTree(join(root, 'blocked'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('createArtifactWriter rejects unsafe writable parents but permits sticky shared parents', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-artifact-parent-mode-');
  const rejectedRoot = join(root, 'unsafe/missing/rejected-output');
  const allowedRoot = join(root, 'allowed/missing/allowed-output');

  try {
    await chmod(root, 0o777);
    await assert.rejects(createArtifactWriter(rejectedRoot), /parent.*writable/);
    assert.equal(await fileExists(rejectedRoot), false);

    await chmod(root, 0o1777);
    await createArtifactWriter(allowedRoot);
    assert.equal((await stat(root)).mode & 0o7777, 0o1777);
    await assertPrivateTree(allowedRoot);
  } finally {
    await chmod(root, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('sticky writable parent trust requires root or effective-user ownership', async () => {
  const { isTrustedParentDirectory } = await import('./artifact-writer.mjs');
  const effectiveUid = 501;

  assert.equal(isTrustedParentDirectory({ mode: 0o1777, uid: 777 }, effectiveUid), false);
  assert.equal(isTrustedParentDirectory({ mode: 0o1777, uid: effectiveUid }, effectiveUid), true);
  assert.equal(isTrustedParentDirectory({ mode: 0o1777, uid: 0 }, effectiveUid), true);
  assert.equal(isTrustedParentDirectory({ mode: 0o755, uid: 777 }, effectiveUid), true);
  assert.equal(isTrustedParentDirectory({ mode: 0o777, uid: effectiveUid }, effectiveUid), false);
});

test('artifact writer rejects root-equivalent file paths without changing the parent mode', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-artifact-empty-path-');
  const outputRoot = join(root, 'output-new');

  try {
    const writer = await createArtifactWriter(outputRoot);
    await chmod(root, 0o755);
    for (const invalidPath of ['', '.', './', 'raw/..']) {
      assert.throws(() => writer.absolute(invalidPath), /outside output root/);
      await assert.rejects(writer.writeText(invalidPath, 'text'), /outside output root/);
      await assert.rejects(writer.writeJson(invalidPath, { ok: true }), /outside output root/);
    }
    assert.equal((await stat(root)).mode & 0o777, 0o755);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('artifact writer rejects a replaced or symlinked output root', async (t) => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');

  for (const replacement of ['directory', 'symlink']) {
    await t.test(replacement, async () => {
      const { root } = await tempCase(`enterprise-artifact-replaced-${replacement}-`);
      const outputRoot = join(root, 'output-new');
      const originalRoot = join(root, 'original-output');
      try {
        const writer = await createArtifactWriter(outputRoot);
        await writer.writeText('sanitized/items/item-1.md', '# Item\n');
        await rename(outputRoot, originalRoot);
        if (replacement === 'directory') {
          await mkdir(outputRoot, { mode: 0o700 });
        } else {
          await symlink(originalRoot, outputRoot);
        }

        assert.throws(() => writer.absolute('raw/value.json'), /output root.*replaced|outside output root/);
        await assert.rejects(writer.writeText('raw/value.txt', 'unsafe'), /output root.*replaced|outside output root/);
        await assert.rejects(writer.writeJson('raw/value.json', { unsafe: true }), /output root.*replaced|outside output root/);
        await assert.rejects(writer.writeCollectionBundle(validBundle()), /output root.*replaced|outside output root/);
        assert.equal(await fileExists(join(outputRoot, 'raw/value.txt')), false);
      } finally {
        await rm(outputRoot, { recursive: true, force: true });
        await rm(originalRoot, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('artifact writer rejects absolute, traversal, prefix-collision, and symlink escapes', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-artifact-escape-');
  const outputRoot = join(root, 'output-new');
  const outside = join(root, 'outside.txt');

  try {
    const writer = await createArtifactWriter(outputRoot);
    await writeFile(outside, 'preserve', { mode: 0o600 });
    await assert.rejects(writer.writeText(outside, 'overwrite'), /outside output root/);
    await assert.rejects(writer.writeText('../outside.txt', 'overwrite'), /outside output root/);
    await assert.rejects(writer.writeText('../output-new-prefix/value.txt', 'overwrite'), /outside output root/);
    await symlink(outside, join(outputRoot, 'sanitized/items/link.md'));
    assert.throws(() => writer.absolute('sanitized/items/link.md'), /outside output root/);
    await writer.writeText('sanitized/items/link.md', 'replacement');
    assert.equal(await readFile(outside, 'utf8'), 'preserve');
    assert.equal(await readFile(join(outputRoot, 'sanitized/items/link.md'), 'utf8'), 'replacement');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('artifact writer atomically replaces hardlinks without truncating the external inode', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-artifact-hardlink-');
  const outputRoot = join(root, 'output-new');
  const sentinel = join(root, 'sentinel.txt');

  try {
    const writer = await createArtifactWriter(outputRoot);
    await writeFile(sentinel, 'preserve', { mode: 0o600 });
    await link(sentinel, join(outputRoot, 'raw/linked.txt'));

    await writer.writeText('raw/linked.txt', 'replacement');

    assert.equal(await readFile(sentinel, 'utf8'), 'preserve');
    assert.equal(await readFile(join(outputRoot, 'raw/linked.txt'), 'utf8'), 'replacement');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('artifact writer removes only its temporary file when an atomic write fails', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-artifact-write-failure-');
  const outputRoot = join(root, 'output-new');

  try {
    const writer = await createArtifactWriter(outputRoot);
    await writer.writeText('raw/value.txt', 'original');
    const before = await readdir(join(outputRoot, 'raw'));

    await assert.rejects(writer.writeText('raw/value.txt', Symbol('not writable')));

    assert.equal(await readFile(join(outputRoot, 'raw/value.txt'), 'utf8'), 'original');
    assert.deepEqual(await readdir(join(outputRoot, 'raw')), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('artifact writer temporary names do not amplify legal near-NAME_MAX basenames', async (t) => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');

  await t.test('output root basename', async () => {
    const { root } = await tempCase('enterprise-artifact-long-root-');
    const outputRoot = join(root, 'r'.repeat(220));
    try {
      const writer = await createArtifactWriter(outputRoot);
      await writer.writeText('raw/value.txt', 'value');
      assert.equal(await readFile(join(outputRoot, 'raw/value.txt'), 'utf8'), 'value');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('file basename', async () => {
    const { root } = await tempCase('enterprise-artifact-long-file-');
    const outputRoot = join(root, 'output-new');
    const fileName = `${'f'.repeat(240)}.md`;
    try {
      const writer = await createArtifactWriter(outputRoot);
      await writer.writeText(`markdown/${fileName}`, '# Long name\n');
      assert.equal(await readFile(join(outputRoot, 'markdown', fileName), 'utf8'), '# Long name\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('artifact writer stores sanitized JSON and private files', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-artifact-json-');
  const outputRoot = join(root, 'output-new');

  try {
    const writer = await createArtifactWriter(outputRoot);
    await writer.writeJson('raw/result.json', {
      credential: 'fixture-credential',
      nested: [{ password: 'fixture-password' }],
      status: 'ok',
    });
    await writer.writeText('markdown/item.md', '# Item\n');

    assert.deepEqual(await readJson(join(outputRoot, 'raw/result.json')), {
      credential: '[REDACTED]',
      nested: [{ password: '[REDACTED]' }],
      status: 'ok',
    });
    assert.doesNotMatch(await readFile(join(outputRoot, 'raw/result.json'), 'utf8'), /fixture-(credential|password)/);
    await assertPrivateTree(outputRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function validBundle() {
  return {
    title: 'Enterprise search',
    source: 'fws',
    backend: 'lark-cli',
    url: 'https://example.test/search',
    filters: { query: 'quarterly plan', authorization: 'filter-secret' },
    inventory: [{
      itemId: 'item-1',
      title: 'Quarterly plan',
      sourceUrl: 'https://example.test/item-1',
      sourceItemId: 'item-1',
      sourceSkill: 'fws',
      backend: 'lark-cli',
      collectionFilters: { cookie: 'inventory-secret' },
      rawArtifacts: ['raw/item-1.json'],
      materialization: {
        status: 'materialized',
        markdownPath: 'markdown/item-1.md',
        sanitizedPath: 'sanitized/items/item-1.md',
        reason: null,
      },
    }],
    sourceMetadata: { backendCliVersion: '1.0', accessToken: 'metadata-secret' },
    canonicalItems: [{
      title: 'Quarterly plan',
      url: 'https://example.test/item-1',
      author: '',
      publishTime: '',
      markdown: 'sanitized/items/item-1.md',
      fileName: 'sanitized/items/item-1.md',
      password: 'canonical-secret',
      debug: 'canonical-extra',
    }],
  };
}

test('writeCollectionBundle rejects consumer-invalid bundle and inventory before persistence', async (t) => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const scenarios = [
    ['empty itemId', (bundle) => { bundle.inventory[0].itemId = ' '; }],
    ['empty sourceSkill', (bundle) => { bundle.inventory[0].sourceSkill = ''; }],
    ['empty sourceUrl', (bundle) => { bundle.inventory[0].sourceUrl = ''; }],
    ['missing rawArtifacts', (bundle) => { delete bundle.inventory[0].rawArtifacts; }],
    ['non-string raw artifact', (bundle) => { bundle.inventory[0].rawArtifacts = [7]; }],
    ['duplicate itemId', (bundle) => {
      bundle.inventory.push({
        ...structuredClone(bundle.inventory[0]),
        sourceUrl: 'https://example.test/item-2',
        materialization: {
          status: 'pending',
          markdownPath: null,
          sanitizedPath: null,
          reason: null,
        },
      });
    }],
    ['duplicate source identity', (bundle) => {
      bundle.inventory.push({
        ...structuredClone(bundle.inventory[0]),
        itemId: 'item-2',
        materialization: {
          status: 'pending',
          markdownPath: null,
          sanitizedPath: null,
          reason: null,
        },
      });
    }],
    ['invalid status', (bundle) => {
      bundle.inventory[0].materialization.status = 'unknown';
      bundle.inventory[0].materialization.markdownPath = null;
      bundle.inventory[0].materialization.sanitizedPath = null;
      bundle.canonicalItems = [];
    }],
    ['materialized missing markdown path', (bundle) => {
      bundle.inventory[0].materialization.markdownPath = null;
    }],
    ['materialized markdown path is outside markdown root', (bundle) => {
      bundle.inventory[0].materialization.markdownPath = 'sanitized/items/item-1.md';
    }],
    ['materialized sanitized path is outside sanitized items root', (bundle) => {
      bundle.inventory[0].materialization.sanitizedPath = 'markdown/item-1.md';
    }],
    ['pending retains paths', (bundle) => {
      bundle.inventory[0].materialization.status = 'pending';
      bundle.canonicalItems = [];
    }],
    ['cleanup is not an array', (bundle) => {
      bundle.inventory[0].materialization.pendingArtifactCleanup = 'markdown/old.md';
    }],
    ['cleanup contains non-string', (bundle) => {
      bundle.inventory[0].materialization.pendingArtifactCleanup = ['markdown/old.md', 7];
    }],
    ['cleanup escapes work-copy roots', (bundle) => {
      bundle.inventory[0].materialization.pendingArtifactCleanup = ['sanitized/items/../../outside.md'];
    }],
    ['cleanup points at current canonical file', (bundle) => {
      bundle.inventory[0].materialization.pendingArtifactCleanup = ['sanitized/items/item-1.md'];
    }],
    ['normalized cleanup points at current canonical file', (bundle) => {
      bundle.inventory[0].materialization.pendingArtifactCleanup = ['sanitized/items/sub/../item-1.md'];
    }],
  ];

  for (const [name, mutate] of scenarios) {
    await t.test(name, async () => {
      const { root } = await tempCase('enterprise-consumer-invalid-inventory-');
      const outputRoot = join(root, 'output-new');
      try {
        const writer = await createArtifactWriter(outputRoot);
        await writer.writeText('markdown/item-1.md', '# Item\n');
        await writer.writeText('sanitized/items/item-1.md', '# Item\n');
        const bundle = validBundle();
        mutate(bundle);

        await assert.rejects(writer.writeCollectionBundle(bundle), /inventory|materialization|cleanup|state/i);
        assert.equal(await fileExists(join(outputRoot, 'sanitized/metadata.json')), false);
        assert.equal(await fileExists(join(outputRoot, 'collection-result.json')), false);
        const inspected = await runNode(knowledgeCollectionScript, [
          'inspect', '--session-dir', outputRoot, '--full',
        ]);
        assert.notEqual(inspected.code, 0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('writeCollectionBundle rejects invalid collection-result top-level fields before persistence', async (t) => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const scenarios = [
    ['title', (bundle) => { bundle.title = ''; }],
    ['source', (bundle) => { bundle.source = ' '; }],
    ['backend', (bundle) => { bundle.backend = null; }],
    ['url', (bundle) => { bundle.url = 7; }],
    ['filters array', (bundle) => { bundle.filters = []; }],
    ['filters null', (bundle) => { bundle.filters = null; }],
  ];

  for (const [name, mutate] of scenarios) {
    await t.test(name, async () => {
      const { root } = await tempCase('enterprise-consumer-invalid-top-level-');
      const outputRoot = join(root, 'output-new');
      try {
        const writer = await createArtifactWriter(outputRoot);
        await writer.writeText('markdown/item-1.md', '# Item\n');
        await writer.writeText('sanitized/items/item-1.md', '# Item\n');
        const bundle = validBundle();
        mutate(bundle);

        await assert.rejects(writer.writeCollectionBundle(bundle), /title|source|backend|url|filters|bundle/i);
        assert.equal(await fileExists(join(outputRoot, 'sanitized/metadata.json')), false);
        assert.equal(await fileExists(join(outputRoot, 'collection-result.json')), false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('writeCollectionBundle preserves metadata v1.0 and the exact seven-key collection result contract', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-artifact-bundle-');
  const outputRoot = join(root, 'output-new');

  try {
    const writer = await createArtifactWriter(outputRoot);
    await writer.writeText('markdown/item-1.md', '# Quarterly plan\n');
    await writer.writeText('sanitized/items/item-1.md', '# Quarterly plan\n');
    await writer.writeCollectionBundle(validBundle());

    const metadata = await readJson(join(outputRoot, 'sanitized/metadata.json'));
    assert.equal(metadata.schemaVersion, '1.0');
    assert.deepEqual(metadata.storage, { fallback: false });
    assert.equal(metadata.collection.status, 'complete');
    assert.equal(metadata.collection.items.length, 1);
    assert.deepEqual(metadata.collection.items[0].materialization.pendingArtifactCleanup, []);
    assert.equal(metadata.retention, undefined);
    assert.equal(metadata.postProcessing, undefined);
    assert.equal(Object.hasOwn(metadata.sourceMetadata, 'accessToken'), false);
    assert.equal(Object.hasOwn(metadata.collection.items[0].collectionFilters, 'cookie'), false);

    const collection = await readJson(join(outputRoot, 'collection-result.json'));
    assert.deepEqual(Object.keys(collection).sort(), [
      'backend', 'filters', 'items', 'schemaVersion', 'source', 'title', 'url',
    ]);
    assert.equal(Object.hasOwn(collection.filters, 'authorization'), false);
    assert.deepEqual(Object.keys(collection.items[0]).sort(), [
      'author', 'fileName', 'markdown', 'publishTime', 'title', 'url',
    ]);
    const persisted = await readFile(join(outputRoot, 'collection-result.json'), 'utf8');
    assert.doesNotMatch(persisted, /filter-secret|inventory-secret|metadata-secret|canonical-secret|canonical-extra/);
    await assertPrivateTree(outputRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeCollectionBundle publishes an explicitly partial pending bundle in one commit', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-bundle-partial-');
  const outputRoot = join(root, 'output-new');

  try {
    const writer = await createArtifactWriter(outputRoot);
    const bundle = validBundle();
    bundle.collectionStatus = 'partial';
    bundle.inventory[0].materialization = {
      status: 'pending',
      markdownPath: null,
      sanitizedPath: null,
      reason: 'transcript is not available',
    };
    bundle.canonicalItems = [];

    await writer.writeCollectionBundle(bundle);
    const metadata = await readJson(join(outputRoot, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'partial');
    const inspected = await runNode(knowledgeCollectionScript, [
      'inspect', '--session-dir', outputRoot, '--full',
    ]);
    assert.equal(inspected.code, 0, inspected.stderr || inspected.stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeCollectionBundle rejects collection status overrides that contradict inventory', async (t) => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const scenarios = [
    ['pending and failed to complete', (bundle) => {
      bundle.collectionStatus = 'complete';
      bundle.inventory[0].materialization = {
        status: 'pending', markdownPath: null, sanitizedPath: null, reason: 'pending',
      };
      bundle.inventory.push({
        ...structuredClone(bundle.inventory[0]),
        itemId: 'item-2',
        sourceUrl: 'https://example.test/item-2',
        materialization: {
          status: 'failed', markdownPath: null, sanitizedPath: null, reason: 'failed',
        },
      });
      bundle.canonicalItems = [];
    }],
    ['materialized to failed', (bundle) => { bundle.collectionStatus = 'failed'; }],
    ['materialized to partial', (bundle) => { bundle.collectionStatus = 'partial'; }],
  ];

  for (const [name, mutate] of scenarios) {
    await t.test(name, async () => {
      const { root } = await tempCase('enterprise-invalid-status-override-');
      const outputRoot = join(root, 'output-new');
      try {
        const writer = await createArtifactWriter(outputRoot);
        await writer.writeText('markdown/item-1.md', '# Item\n');
        await writer.writeText('sanitized/items/item-1.md', '# Item\n');
        const bundle = validBundle();
        mutate(bundle);

        await assert.rejects(writer.writeCollectionBundle(bundle), /collectionStatus.*override/i);
        assert.equal(await fileExists(join(outputRoot, 'collection-result.json')), false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('writeCollectionBundle rejects invalid canonical fields before publishing bundle files', async (t) => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const scenarios = [
    ['empty title', (item) => { item.title = ' '; }],
    ['empty URL', (item) => { item.url = ''; }],
    ['empty markdown', (item) => { item.markdown = ''; item.fileName = ''; }],
    ['non-string optional author', (item) => { item.author = 42; }],
    ['non-string optional publishTime', (item) => { item.publishTime = null; }],
  ];

  for (const [name, mutate] of scenarios) {
    await t.test(name, async () => {
      const { root } = await tempCase('enterprise-invalid-canonical-field-');
      const outputRoot = join(root, 'output-new');
      try {
        const writer = await createArtifactWriter(outputRoot);
        await writer.writeText('sanitized/items/item-1.md', '# Item\n');
        const bundle = validBundle();
        mutate(bundle.canonicalItems[0]);
        await assert.rejects(writer.writeCollectionBundle(bundle), /canonical item/);
        assert.equal(await fileExists(join(outputRoot, 'sanitized/metadata.json')), false);
        assert.equal(await fileExists(join(outputRoot, 'collection-result.json')), false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('writeCollectionBundle validates pending cleanup paths and materialized canonical correspondence', async (t) => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const scenarios = [
    ['invalid cleanup list', (bundle) => {
      bundle.inventory[0].materialization.pendingArtifactCleanup = ['raw/old.json', 7];
    }],
    ['sanitized path mismatch', (bundle) => {
      bundle.inventory[0].materialization.sanitizedPath = 'sanitized/items/other.md';
    }],
    ['source URL mismatch', (bundle) => {
      bundle.inventory[0].sourceUrl = 'https://example.test/different';
    }],
    ['materialized inventory missing canonical', (bundle) => {
      bundle.canonicalItems = [];
    }],
    ['non-materialized inventory has canonical', (bundle) => {
      bundle.inventory[0].materialization.status = 'pending';
      bundle.inventory[0].materialization.markdownPath = null;
      bundle.inventory[0].materialization.sanitizedPath = null;
    }],
  ];

  for (const [name, mutate] of scenarios) {
    await t.test(name, async () => {
      const { root } = await tempCase('enterprise-invalid-bundle-mapping-');
      const outputRoot = join(root, 'output-new');
      try {
        const writer = await createArtifactWriter(outputRoot);
        await writer.writeText('sanitized/items/item-1.md', '# Item\n');
        const bundle = validBundle();
        mutate(bundle);
        await assert.rejects(writer.writeCollectionBundle(bundle), /inventory|canonical|cleanup/i);
        assert.equal(await fileExists(join(outputRoot, 'collection-result.json')), false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('writeCollectionBundle rejects a second publication without changing committed files', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-bundle-one-shot-');
  const outputRoot = join(root, 'output-new');

  try {
    const writer = await createArtifactWriter(outputRoot);
    await writer.writeText('markdown/item-1.md', '# Quarterly plan\n');
    await writer.writeText('sanitized/items/item-1.md', '# Quarterly plan\n');
    await writer.writeCollectionBundle(validBundle());
    const metadataBefore = await readFile(join(outputRoot, 'sanitized/metadata.json'), 'utf8');
    const markerBefore = await readFile(join(outputRoot, 'collection-result.json'), 'utf8');
    const replacement = validBundle();
    replacement.title = 'NEW enterprise search';
    replacement.sourceMetadata = { replacement: 'NEW metadata' };

    await assert.rejects(writer.writeCollectionBundle(replacement), /already committed|one-shot/i);

    assert.equal(await readFile(join(outputRoot, 'sanitized/metadata.json'), 'utf8'), metadataBefore);
    assert.equal(await readFile(join(outputRoot, 'collection-result.json'), 'utf8'), markerBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeCollectionBundle leaves metadata uncommitted on marker failure and permits retry', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-bundle-commit-marker-');
  const outputRoot = join(root, 'output-new');

  try {
    const writer = await createArtifactWriter(outputRoot);
    await writer.writeText('markdown/item-1.md', '# Item\n');
    await writer.writeText('sanitized/items/item-1.md', '# Item\n');
    await mkdir(join(outputRoot, 'collection-result.json'), { mode: 0o700 });
    await writeFile(join(outputRoot, 'collection-result.json/sentinel'), 'preserve', { mode: 0o600 });

    await assert.rejects(writer.writeCollectionBundle(validBundle()));

    assert.equal(await fileExists(join(outputRoot, 'sanitized/metadata.json')), true);
    assert.equal((await stat(join(outputRoot, 'collection-result.json'))).isDirectory(), true);
    assert.equal(await readFile(join(outputRoot, 'collection-result.json/sentinel'), 'utf8'), 'preserve');
    assert.deepEqual(
      (await readdir(outputRoot)).filter((name) => name.includes('.tmp-')),
      [],
    );

    await rm(join(outputRoot, 'collection-result.json'), { recursive: true });
    const uncommitted = await runNode(knowledgeCollectionScript, [
      'status', '--session-dir', outputRoot,
    ]);
    assert.equal(uncommitted.code, 1);
    assert.match(uncommitted.stdout, /uncommitted|未提交/);
    await writer.writeCollectionBundle(validBundle());
    assert.equal((await readJson(join(outputRoot, 'collection-result.json'))).title, 'Enterprise search');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writer bundle is accepted by real inspect and exposes sanitized handoff', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-bundle-integration-');
  const outputRoot = join(root, 'output-new');

  try {
    const writer = await createArtifactWriter(outputRoot);
    await writer.writeText('markdown/item-1.md', '# Quarterly plan\n');
    await writer.writeText('sanitized/items/item-1.md', '# Quarterly plan\n');
    await writer.writeCollectionBundle(validBundle());

    const inspected = await runNode(knowledgeCollectionScript, [
      'inspect', '--session-dir', outputRoot, '--full',
    ]);
    assert.equal(inspected.code, 0, inspected.stderr || inspected.stdout);
    assert.equal(inspected.json?.ok, true);
    assert.equal(inspected.json?.metadata?.collection?.items?.length, 1);

    const status = await runNode(knowledgeCollectionScript, [
      'status', '--session-dir', outputRoot,
    ]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.deepEqual(status.json?.task?.sourceScope, ['feishu']);
    assert.equal(status.json?.task?.materializationTarget, 'all');
    assert.deepEqual(status.json?.downstreamInput?.files, [
      join(await realpath(outputRoot), 'sanitized/items/item-1.md'),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeCollectionBundle rejects invalid canonical item files', async (t) => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');

  for (const scenario of [
    {
      name: 'markdown and fileName differ',
      mutate: (bundle) => { bundle.canonicalItems[0].markdown = 'sanitized/items/other.md'; },
    },
    {
      name: 'path is outside sanitized items',
      mutate: (bundle) => {
        bundle.canonicalItems[0].markdown = 'markdown/item-1.md';
        bundle.canonicalItems[0].fileName = 'markdown/item-1.md';
      },
    },
    {
      name: 'path is absolute',
      mutate: (bundle) => {
        bundle.canonicalItems[0].markdown = '/tmp/canonical-item.md';
        bundle.canonicalItems[0].fileName = '/tmp/canonical-item.md';
      },
    },
    {
      name: 'path is a directory',
      mutate: (bundle) => {
        bundle.canonicalItems[0].markdown = 'sanitized/items';
        bundle.canonicalItems[0].fileName = 'sanitized/items';
      },
    },
    {
      name: 'path is a symlink',
      symlink: true,
      mutate: (bundle) => {
        bundle.canonicalItems[0].markdown = 'sanitized/items/link.md';
        bundle.canonicalItems[0].fileName = 'sanitized/items/link.md';
      },
    },
  ]) {
    await t.test(scenario.name, async () => {
      const { root } = await tempCase('enterprise-invalid-canonical-');
      const outputRoot = join(root, 'output-new');
      try {
        const writer = await createArtifactWriter(outputRoot);
        await writer.writeText('sanitized/items/item-1.md', '# Item\n');
        if (scenario.symlink) {
          await symlink(join(outputRoot, 'sanitized/items/item-1.md'), join(outputRoot, 'sanitized/items/link.md'));
        }
        const bundle = validBundle();
        scenario.mutate(bundle);
        await assert.rejects(writer.writeCollectionBundle(bundle), /canonical item|outside output root/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('writeCollectionBundle rejects canonical paths that normalize outside sanitized items', async (t) => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');

  for (const canonicalPath of [
    'sanitized/items/../escaped.md',
    'sanitized/items/sub/../../escaped.md',
  ]) {
    await t.test(canonicalPath, async () => {
      const { root } = await tempCase('enterprise-canonical-normalized-escape-');
      const outputRoot = join(root, 'output-new');
      try {
        const writer = await createArtifactWriter(outputRoot);
        await writer.writeText('sanitized/escaped.md', '# Escaped\n');
        const bundle = validBundle();
        bundle.canonicalItems[0].markdown = canonicalPath;
        bundle.canonicalItems[0].fileName = canonicalPath;

        await assert.rejects(writer.writeCollectionBundle(bundle), /canonical item/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('writeCollectionBundle accepts a canonical file nested within sanitized items', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-canonical-nested-');
  const outputRoot = join(root, 'output-new');

  try {
    const writer = await createArtifactWriter(outputRoot);
    await writer.writeText('markdown/item-1.md', '# Nested item\n');
    await writer.writeText('sanitized/items/sub/item.md', '# Nested item\n');
    const bundle = validBundle();
    bundle.inventory[0].materialization.sanitizedPath = 'sanitized/items/sub/item.md';
    bundle.canonicalItems[0].markdown = 'sanitized/items/sub/item.md';
    bundle.canonicalItems[0].fileName = 'sanitized/items/sub/item.md';

    await writer.writeCollectionBundle(bundle);
    const collection = await readJson(join(outputRoot, 'collection-result.json'));
    assert.equal(collection.items[0].fileName, 'sanitized/items/sub/item.md');
    await assertPrivateTree(outputRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeCollectionBundle derives partial from a pagination failure with materialized inventory', async () => {
  const { createArtifactWriter } = await import('./artifact-writer.mjs');
  const { root } = await tempCase('enterprise-pagination-partial-');
  const outputRoot = join(root, 'output-new');

  try {
    const writer = await createArtifactWriter(outputRoot);
    await writer.writeText('markdown/item-1.md', '# Item\n');
    await writer.writeText('sanitized/items/item-1.md', '# Item\n');
    await writer.writeCollectionBundle({ ...validBundle(), paginationFailed: true });
    assert.equal((await readJson(join(outputRoot, 'sanitized/metadata.json'))).collection.status, 'partial');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SOURCE_IDENTITY exposes the exact enterprise connector identities', async () => {
  const { SOURCE_IDENTITY } = await import('./status-model.mjs');
  assert.deepEqual(SOURCE_IDENTITY, {
    dingtalk: { connector: 'dws', source: 'dws', backend: 'dws', sourceSkill: 'dws' },
    feishu: { connector: 'fws', source: 'fws', backend: 'lark-cli', sourceSkill: 'fws' },
    wecom: { connector: 'wecom', source: 'wecom', backend: 'wecom-cli', sourceSkill: 'wecomcli' },
    ima: { connector: 'ima', source: 'ima', backend: 'ima', sourceSkill: 'ima-skill' },
  });
});

test('deriveCollectionStatus aggregates discovery, metadata, pagination, and item states', async () => {
  const { deriveCollectionStatus } = await import('./status-model.mjs');

  assert.equal(deriveCollectionStatus({ discoverySucceeded: false, itemStates: ['materialized'] }), 'failed');
  assert.equal(deriveCollectionStatus({ metadataOnly: true }), 'complete');
  assert.equal(deriveCollectionStatus({ metadataOnly: true, paginationFailed: true }), 'partial');
  assert.equal(deriveCollectionStatus({ itemStates: [] }), 'complete');
  assert.equal(deriveCollectionStatus({ itemStates: ['failed', 'pending'] }), 'failed');
  assert.equal(deriveCollectionStatus({ itemStates: ['materialized', 'failed'] }), 'partial');
  assert.equal(deriveCollectionStatus({ itemStates: ['materialized', 'pending'] }), 'partial');
  assert.equal(deriveCollectionStatus({ itemStates: ['materialized', 'materialized'] }), 'complete');
  assert.throws(() => deriveCollectionStatus({ itemStates: ['unknown'] }), /item state/i);
});

test('handledOutcome returns a continuable normalized result with default counts', async () => {
  const { handledOutcome } = await import('./status-model.mjs');

  assert.deepEqual(handledOutcome('fws', 'partial', '/private/output', { materialized: 2, failed: 1 }), {
    connector: 'fws',
    status: 'partial',
    outputDir: '/private/output',
    continuable: true,
    counts: { discovered: 0, materialized: 2, pending: 0, failed: 1 },
  });
});

test('inventoryCounts derives every outcome count from final materialization states', async () => {
  const { inventoryCounts } = await import('./status-model.mjs');
  assert.deepEqual(inventoryCounts([
    { materialization: { status: 'materialized' } },
    { materialization: { status: 'failed' } },
    { materialization: { status: 'failed' } },
    { materialization: { status: 'pending' } },
  ]), { discovered: 4, materialized: 1, failed: 2, pending: 1 });
});

test('withRateLimitRetry returns immediately after a successful operation', async () => {
  const { withRateLimitRetry } = await import('./retry.mjs');
  let attempts = 0;
  const delays = [];

  const result = await withRateLimitRetry(async () => {
    attempts += 1;
    return { ok: true };
  }, { delay: async (ms) => delays.push(ms) });

  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 1);
  assert.deepEqual(delays, []);
});

test('withRateLimitRetry exhausts three limited attempts with exponential delays', async () => {
  const { withRateLimitRetry } = await import('./retry.mjs');
  let attempts = 0;
  const delays = [];

  const result = await withRateLimitRetry(async () => {
    attempts += 1;
    return attempts === 3
      ? { rateLimited: true, retryAfterMs: 9_999, internal: 'discard-me' }
      : { rateLimited: true };
  }, { delay: async (ms) => delays.push(ms) });

  assert.deepEqual(result, { rateLimited: true, exhausted: true });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1_000, 2_000]);
});

test('withRateLimitRetry honors retryAfterMs and caps each delay at 30000ms', async () => {
  const { withRateLimitRetry } = await import('./retry.mjs');
  let attempts = 0;
  const delays = [];

  const result = await withRateLimitRetry(async () => {
    attempts += 1;
    if (attempts === 1) return { rateLimited: true, retryAfterMs: 12_345 };
    if (attempts === 2) return { rateLimited: true, retryAfterMs: 90_000 };
    return { ok: true };
  }, { delay: async (ms) => delays.push(ms) });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(delays, [12_345, 30_000]);
});

test('withRateLimitRetry propagates non-rate-limit exceptions', async () => {
  const { withRateLimitRetry } = await import('./retry.mjs');
  const failure = new Error('operation failed');

  await assert.rejects(withRateLimitRetry(async () => { throw failure; }, { delay: async () => {} }), failure);
});
