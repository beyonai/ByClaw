import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const source = await readFile(new URL('../docker-entrypoint.sh', import.meta.url), 'utf8')
// Exercise the exact startup helper with this test user's identity; production
// resolves the image's byclaw account before calling the same function as root.
const match = source.match(/<<'BYCLAW_SHARED_ROOT'\n([\s\S]+?)\nBYCLAW_SHARED_ROOT/)
const helper = match?.[1].split("if __name__ == '__main__':")[0]

const run = (path, userRoot = '') => {
  assert.ok(helper, 'root entrypoint must initialize its shared runtime directory before dropping privileges')
  return spawnSync('python3', ['-c', `${helper}\nos.umask(0o077)\nprepare_host_root(sys.argv[1], os.getuid(), os.getgid())`, path], {
    env: { ...process.env, BYCLAW_MULTI_HOST_USER_ROOT: userRoot }, encoding: 'utf8',
  })
}

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'shared-host-root-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('shared root initialization creates a private directory and preserves existing descendants', async t => {
  const parent = await fixture(t)
  const root = join(parent, 'host')
  let result = run(root)
  assert.equal(result.status, 0, result.stderr)
  assert.equal((await lstat(root)).mode & 0o777, 0o700)
  const child = join(root, 'existing-user-state')
  await writeFile(child, 'keep')
  await chmod(child, 0o644)
  await chmod(root, 0o755)
  result = run(root)
  assert.equal(result.status, 0, result.stderr)
  assert.equal((await lstat(root)).mode & 0o777, 0o700)
  assert.equal((await lstat(child)).mode & 0o777, 0o644)
  assert.equal(await readFile(child, 'utf8'), 'keep')
})

test('shared root initialization creates three missing trusted parents with traversable permissions', async t => {
  const parent = await fixture(t)
  const first = join(parent, 'new-data')
  const second = join(first, 'runtime')
  const third = join(second, 'node')
  const root = join(third, 'host')
  const result = run(root)
  assert.equal(result.status, 0, result.stderr)
  assert.equal((await lstat(first)).mode & 0o777, 0o755)
  assert.equal((await lstat(second)).mode & 0o777, 0o755)
  assert.equal((await lstat(third)).mode & 0o777, 0o755)
  assert.equal((await lstat(root)).mode & 0o777, 0o700)
})

test('shared root initialization rejects leaf and ancestor symlinks without touching their target', async t => {
  const parent = await fixture(t)
  const target = join(parent, 'target')
  await mkdir(target, { mode: 0o755 })
  const alias = join(parent, 'alias')
  await symlink(target, alias)
  assert.notEqual(run(alias).status, 0)
  assert.notEqual(run(join(alias, 'host')).status, 0)
  assert.equal((await lstat(target)).mode & 0o777, 0o755)
})

test('shared root initialization rejects files, writable existing directories and overlapping user storage', async t => {
  const parent = await fixture(t)
  const file = join(parent, 'file')
  await writeFile(file, 'keep')
  assert.notEqual(run(file).status, 0)
  assert.equal(await readFile(file, 'utf8'), 'keep')
  const writable = join(parent, 'untrusted')
  await mkdir(writable)
  await chmod(writable, 0o777)
  assert.notEqual(run(writable).status, 0)
  assert.equal((await lstat(writable)).mode & 0o777, 0o777)
  assert.notEqual(run(join(parent, 'host'), parent).status, 0)
  assert.notEqual(run('relative/host').status, 0)
})
