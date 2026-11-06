import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, rename, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DURABLE_FILE, DurableFiles, deriveFileKey, openFile, sealFile } from './host-durable-files.mjs'

const key = deriveFileKey('a-service-secret-of-enough-length')

function memoryStore() {
  const rows = new Map()
  const id = (user, name) => `${user}\0${name}`
  return {
    rows,
    async list(user) { return [...rows].filter(([k]) => k.startsWith(`${user}\0`)).map(([k, value]) => ({ name: k.split('\0')[1], value })) },
    async put(user, name, value) { rows.set(id(user, name), value) },
    async remove(user, name) { rows.delete(id(user, name)) },
  }
}

async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'durable-files-'))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const waitFor = async (check, ms = 3000) => {
  const until = Date.now() + ms
  while (Date.now() < until) { if (await check()) return; await new Promise(r => setTimeout(r, 25)) }
  assert.fail('condition not reached')
}

test('names: credentials, SSH identities and sandbox records, nothing else', () => {
  for (const name of ['.credentials.yaml', 'byclaw-tool-env/client_ed25519', 'byclaw-tool-env/host_ed25519.pub', 'byclaw-tool-env/known_hosts',
    'byclaw-tool-env/tool-sandbox.json', 'byclaw-tool-env/sandbox.json', 'byclaw-tool-env/published-keys.json', 'byclaw-tool-env/catalog/unity-1/client_ed25519']) assert.ok(DURABLE_FILE.test(name), name)
  for (const name of ['storages/workspace.json', 'byclaw-tool-env/ssh_config', 'byclaw-tool-env/endpoint.json', 'byclaw-tool-env/catalog/../client_ed25519',
    'byclaw-tool-env/catalog/a/b/client_ed25519', 'x/.credentials.yaml']) assert.ok(!DURABLE_FILE.test(name), name)
})

test('restore: the store wins, local-only files are stored, and the store holds only ciphertext', async () => {
  const store = memoryStore()
  const { dir, cleanup } = await home()
  try {
    await store.put('u1', '.credentials.yaml', sealFile(key, 'u1', '.credentials.yaml', Buffer.from('records: {stored: secret}\n')))
    await writeFile(join(dir, '.credentials.yaml'), 'records: {stale: local}\n')
    await mkdir(join(dir, 'byclaw-tool-env/catalog/t1'), { recursive: true })
    await writeFile(join(dir, 'byclaw-tool-env/catalog/t1/client_ed25519'), 'PRIVATE KEY')
    await writeFile(join(dir, 'byclaw-tool-env/ssh_config'), 'derived, not stored')
    const files = new DurableFiles({ store, key, user: 'u1', home: dir })
    await files.restore()
    assert.equal(await readFile(join(dir, '.credentials.yaml'), 'utf8'), 'records: {stored: secret}\n')
    assert.equal((await stat(join(dir, '.credentials.yaml'))).mode & 0o777, 0o600)
    assert.deepEqual([...store.rows.keys()].sort(), ['u1\0.credentials.yaml', 'u1\0byclaw-tool-env/catalog/t1/client_ed25519'])
    for (const value of store.rows.values()) assert.ok(!value.includes('secret') && !value.includes('PRIVATE'))
    assert.equal(openFile(key, 'u1', 'byclaw-tool-env/catalog/t1/client_ed25519', store.rows.get('u1\0byclaw-tool-env/catalog/t1/client_ed25519')).toString(), 'PRIVATE KEY')
  } finally { await cleanup() }
})

test('a fresh home on another host gets the files back', async () => {
  const store = memoryStore()
  const first = await home(), second = await home()
  try {
    await mkdir(join(first.dir, 'byclaw-tool-env'), { recursive: true })
    await writeFile(join(first.dir, 'byclaw-tool-env/client_ed25519'), 'K1')
    await writeFile(join(first.dir, 'byclaw-tool-env/tool-sandbox.json'), '{"sandboxId":"b-1"}')
    await new DurableFiles({ store, key, user: 'u1', home: first.dir }).restore()
    await new DurableFiles({ store, key, user: 'u1', home: second.dir }).restore()
    assert.equal(await readFile(join(second.dir, 'byclaw-tool-env/client_ed25519'), 'utf8'), 'K1')
    assert.equal(await readFile(join(second.dir, 'byclaw-tool-env/tool-sandbox.json'), 'utf8'), '{"sandboxId":"b-1"}')
  } finally { await first.cleanup(); await second.cleanup() }
})

test('changes are stored as they happen, including atomic renames; close stores the rest and forgets deleted files', async () => {
  const store = memoryStore()
  const { dir, cleanup } = await home()
  try {
    const files = new DurableFiles({ store, key, user: 'u1', home: dir })
    await files.restore()
    files.start()
    await writeFile(join(dir, '.credentials.yaml.tmp'), 'v: 1\n')
    await rename(join(dir, '.credentials.yaml.tmp'), join(dir, '.credentials.yaml'))
    const value = () => store.rows.get('u1\0.credentials.yaml')
    await waitFor(() => value() !== undefined && openFile(key, 'u1', '.credentials.yaml', value()).toString() === 'v: 1\n')
    await mkdir(join(dir, 'byclaw-tool-env'), { recursive: true })
    await writeFile(join(dir, 'byclaw-tool-env/known_hosts'), 'host key')
    await waitFor(() => store.rows.has('u1\0byclaw-tool-env/known_hosts'))
    await writeFile(join(dir, 'unrelated.json'), '{}')
    await rm(join(dir, 'byclaw-tool-env/known_hosts'))
    await writeFile(join(dir, '.credentials.yaml'), 'v: 2\n')
    await files.close()
    assert.equal(openFile(key, 'u1', '.credentials.yaml', value()).toString(), 'v: 2\n')
    assert.ok(!store.rows.has('u1\0byclaw-tool-env/known_hosts'))
    assert.ok(![...store.rows.keys()].some(k => k.includes('unrelated')))
  } finally { await cleanup() }
})

test('a row only opens for its own user and name, and only with the right key', () => {
  const sealed = sealFile(key, 'u1', '.credentials.yaml', Buffer.from('secret'))
  assert.throws(() => openFile(key, 'u2', '.credentials.yaml', sealed))
  assert.throws(() => openFile(key, 'u1', 'byclaw-tool-env/client_ed25519', sealed))
  assert.throws(() => openFile(deriveFileKey('another-service-secret-value'), 'u1', '.credentials.yaml', sealed))
  assert.throws(() => deriveFileKey('short'), /too short/)
})
