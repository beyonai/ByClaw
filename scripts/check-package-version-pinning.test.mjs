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

test('accepts Harness host compatibility ranges but still rejects installable SDK ranges', () => {
  // DevOps 曾将 engines 和 peerDependencies 按文本匹配，误报宿主兼容性声明。
  const pkg = {
    engines: { node: '^22.19 || >=24' },
    peerDependencies: {
      '@deepseek-ai/cordis': '^4.0.1-rc.1',
      '@deepseek-ai/dsh-agent': '^0.1.2-alpha.1',
    },
    dependencies: { '@deepseek-ai/dsh-agent': '0.1.5-rc.2' },
    devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
  };
  assert.deepEqual(violations(pkg), []);
  assert.deepEqual(violations({ ...pkg, dependencies: { '@deepseek-ai/dsh-agent': '^0.1.5-rc.2' } }), [
    'dependencies.@deepseek-ai/dsh-agent: ^0.1.5-rc.2',
  ]);
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

    // 实验目录即使已跟踪也不作为生产依赖检查；相邻插件仍必须锁定安装版本。
    writeFileSync(pkg, JSON.stringify({ dependencies: { sample: '1.2.3' } }));
    const scratchPath = 'middleware/plugins/devflow/.scratch/anchor/package.json';
    const scratch = path.join(root, scratchPath);
    mkdirSync(path.dirname(scratch), { recursive: true });
    writeFileSync(scratch, JSON.stringify({ dependencies: { 'web-tree-sitter': '^0.27.0' } }));
    execFileSync('git', ['add', '--', 'tests/package.json', scratchPath], { cwd: root });
    assert.equal(run(scratch).status, 0);
    assert.equal(run().status, 0);

    const productionPath = 'middleware/plugins/devflow/package.json';
    writeFileSync(path.join(root, productionPath), JSON.stringify({ dependencies: { sample: '^1.2.3' } }));
    execFileSync('git', ['add', '--', productionPath], { cwd: root });
    assert.equal(run().status, 1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
