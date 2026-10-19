import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { violations } from './check-package-version-pinning.mjs';

test('rejects ranges in every install section while preserving compatibility declarations', () => {
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const version of ['^1.2.3', '~1.2.3']) {
      assert.deepEqual(violations({ [section]: { example: version } }), [`${section}.example: ${version}`]);
    }
  }
  assert.deepEqual(violations({ engines: { node: '^22.19.0 || >=24' },
    peerDependencies: { react: '^18.2.0' }, dependencies: { host: 'workspace:*', sdk: '0.1.5-rc.2' } }), []);
});

test('CLI handles tracked discovery, spaced paths, invalid JSON and fixture exclusion', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'byclaw-pinning-'));
  const root = path.join(temp, 'tests', 'checkout with spaces');
  const script = fileURLToPath(new URL('./check-package-version-pinning.mjs', import.meta.url));
  try {
    mkdirSync(root, { recursive: true });
    execFileSync('git', ['init', '-q', root]);
    const pkg = path.join(root, 'package.json');
    writeFileSync(pkg, JSON.stringify({ dependencies: { sample: '1.2.3' } }));
    execFileSync('git', ['add', 'package.json'], { cwd: root });
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(run().status, 0);
    assert.equal(run(pkg).status, 0);
    writeFileSync(pkg, JSON.stringify({ dependencies: { sample: '^1.2.3' } }));
    assert.equal(run().status, 1);
    assert.equal(run(pkg).status, 1);
    writeFileSync(pkg, '{broken');
    assert.equal(run().status, 1);
    mkdirSync(path.join(root, 'tests'));
    const fixture = path.join(root, 'tests', 'package.json');
    writeFileSync(fixture, '{broken');
    assert.equal(run(fixture).status, 0);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
