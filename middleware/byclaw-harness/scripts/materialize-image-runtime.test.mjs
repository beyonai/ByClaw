import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm, lstat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { materializeImageRuntime } from './materialize-image-runtime.mjs';

test('native image dependencies remain usable through a preserved pnpm consumer path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-image-layout-'));
  try {
    const consumer = join(root, 'packages/attachment/attachment-local');
    const sharpEnv = join(root, 'node_modules/.pnpm/sharp@0.35.5/node_modules');
    const libc = join(root, 'node_modules/.pnpm/detect-libc@2.1.2/node_modules/detect-libc');
    const native = join(root, 'node_modules/.pnpm/native-fixture@1.0.0/node_modules/native-fixture');
    for (const dir of [consumer, join(sharpEnv, 'sharp/dist'), libc, native, join(consumer, 'node_modules/@deepseek-ai')]) await mkdir(dir, { recursive: true });
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-attachment-local', version: '0.2.1-rc.2', dependencies: { sharp: '0.35.5' } }));
    await writeFile(join(sharpEnv, 'sharp/package.json'), JSON.stringify({ name: 'sharp', version: '0.35.5', main: 'dist/index.cjs', dependencies: { 'detect-libc': '2.1.2' }, optionalDependencies: { 'native-fixture': '1.0.0', 'unavailable-other-platform': '1.0.0' } }));
    await writeFile(join(sharpEnv, 'sharp/dist/index.cjs'), "module.exports={libc:require('detect-libc'),native:require('native-fixture')};\n");
    await writeFile(join(libc, 'package.json'), JSON.stringify({ name: 'detect-libc', version: '2.1.2', main: 'index.js' }));
    await writeFile(join(libc, 'index.js'), "module.exports='glibc';\n");
    await writeFile(join(native, 'package.json'), JSON.stringify({ name: 'native-fixture', version: '1.0.0', main: 'index.js' }));
    await writeFile(join(native, 'index.js'), "module.exports=require('./payload.json');\n");
    await writeFile(join(native, 'payload.json'), JSON.stringify({ platform: 'fixture' }));
    await symlink(libc, join(sharpEnv, 'detect-libc'));
    await symlink(native, join(sharpEnv, 'native-fixture'));
    await symlink(join(sharpEnv, 'sharp'), join(consumer, 'node_modules/sharp'));
    const peer = join(consumer, 'node_modules/@deepseek-ai/cordis');
    await symlink('/image-owned-cordis-singleton', peer);
    const probe = `const {createRequire}=require('node:module');const r=createRequire(${JSON.stringify(join(consumer, 'package.json'))});console.log(JSON.stringify(r('sharp')));`;
    assert.equal(JSON.parse(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' })).libc, 'glibc');
    const broken = spawnSync(process.execPath, ['--preserve-symlinks', '-e', probe], { encoding: 'utf8' });
    assert.notEqual(broken.status, 0);
    assert.match(broken.stderr, /Cannot find module 'detect-libc'/);
    await materializeImageRuntime(root);
    const fixed = spawnSync(process.execPath, ['--preserve-symlinks', '-e', probe], { encoding: 'utf8' });
    assert.equal(fixed.status, 0, fixed.stderr);
    assert.deepEqual(JSON.parse(fixed.stdout), { libc: 'glibc', native: { platform: 'fixture' } });
    assert.equal((await lstat(join(consumer, 'node_modules/sharp'))).isSymbolicLink(), false);
    assert.equal((await lstat(peer)).isSymbolicLink(), true, 'Cordis peer identity remains image-owned');
    assert.equal(JSON.parse(await readFile(join(sharpEnv, 'sharp/package.json'), 'utf8')).version, '0.35.5', 'pnpm installation stays intact');
    await materializeImageRuntime(root);
    assert.equal(spawnSync(process.execPath, ['--preserve-symlinks', '-e', probe]).status, 0, 'repeat builds remain valid');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
