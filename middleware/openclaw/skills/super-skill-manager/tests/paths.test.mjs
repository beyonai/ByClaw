import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertContained,
  resolveManagedRoot,
  resolveSkillTarget,
  validateSkillName,
} from '../scripts/core/paths.mjs';

async function withRoot(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'super-skill-paths-'));
  const root = path.join(directory, 'skills');
  await mkdir(root);
  try {
    await run({ directory, root });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('resolves a managed root and an exact direct child', async () => {
  await withRoot(async ({ root }) => {
    await mkdir(path.join(root, 'valid-skill'));
    assert.equal(await resolveManagedRoot(root), await realpath(root));
    assert.equal(await resolveSkillTarget(root, 'valid-skill'), await realpath(path.join(root, 'valid-skill')));
  });
});

test('allows a missing direct child after proving its parent is contained', async () => {
  await withRoot(async ({ root }) => {
    assert.equal(await resolveSkillTarget(root, 'new-skill'), path.join(await realpath(root), 'new-skill'));
  });
});

test('rejects missing roots and roots that are not directories', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'super-skill-root-'));
  const file = path.join(directory, 'not-a-directory');
  await writeFile(file, 'x');
  try {
    await assert.rejects(resolveManagedRoot(path.join(directory, 'missing')), /directory/i);
    await assert.rejects(resolveManagedRoot(file), /directory/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects traversal, roots, absolute paths, separators, and globs', async () => {
  await withRoot(async ({ root }) => {
    for (const name of ['', '.', '..', '../outside', '/absolute', 'nested/child', 'nested\\child', 'bad*', 'bad?', '[bad]']) {
      assert.throws(() => validateSkillName(name), /skill name/i, name || 'empty');
      await assert.rejects(resolveSkillTarget(root, name), /skill name|target/i, name || 'empty');
    }
  });
});

test('contains only real descendants and defeats prefix sibling traps', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'super-skill-contained-'));
  const root = path.join(directory, 'skills');
  const sibling = path.join(directory, 'skills-evil');
  await mkdir(root);
  await mkdir(sibling);
  try {
    assert.doesNotThrow(() => assertContained(root, path.join(root, 'child')));
    assert.throws(() => assertContained(root, sibling), /contained/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a symlinked target which escapes the managed root', { skip: process.platform === 'win32' }, async () => {
  await withRoot(async ({ directory, root }) => {
    const outside = path.join(directory, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(root, 'escaped-skill'));
    await assert.rejects(resolveSkillTarget(root, 'escaped-skill'), /contained|symlink/i);
  });
});

test('protects the manager skill itself', async () => {
  await withRoot(async ({ root }) => {
    await assert.rejects(resolveSkillTarget(root, 'super-skill-manager'), /protected/i);
  });
});

test('permits only an explicit protected read target', async () => {
  await withRoot(async ({ root }) => {
    await mkdir(path.join(root, 'super-skill-manager'));
    assert.equal(
      await resolveSkillTarget(root, 'super-skill-manager', { allowMissing: false, allowProtectedRead: true }),
      await realpath(path.join(root, 'super-skill-manager')),
    );
    await assert.rejects(resolveSkillTarget(root, 'super-skill-manager', { allowMissing: true }), /protected/i);
  });
});
