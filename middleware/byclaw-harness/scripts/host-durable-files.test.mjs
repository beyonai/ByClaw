import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, rename, writeFile, stat } from 'node:fs/promises'
import fs from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DELETED, DurableFiles, DurableFilesLostError, LOCAL_ONLY, MAX_FILE_BYTES, deriveFileKey, isDurableFile, openFile, sealFile, sqlFileStore } from './host-durable-files.mjs'

const key = deriveFileKey('a-service-secret-of-enough-length')

function memoryStore() {
  const rows = new Map()
  const epochs = new Map()
  const id = (user, name) => `${user}\0${name}`
  return {
    rows,
    epochs,
    async list(user) { return [...rows].filter(([k]) => k.startsWith(`${user}\0`)).map(([k, value]) => ({ name: k.split('\0')[1], value })) },
    async claim(user) { epochs.set(user, (epochs.get(user) ?? 0) + 1); return epochs.get(user) },
    async put(user, epoch, name, value) {
      if (epochs.get(user) !== epoch) throw new DurableFilesLostError(user)
      rows.set(id(user, name), value)
    },
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

test('names: credentials, SSH identities, sandbox records and AgentTeams state, nothing else', () => {
  for (const name of ['runtime/byclaw-agent-teams/abc123/研发专家团-官方认证/team.json', 'runtime/byclaw-agent-teams/abc123/研发专家团-官方认证/inbox/captain.jsonl',
    'runtime/byclaw-agent-teams/abc123/retired-members.json', 'agent-teams/instances/0a1b.json']) assert.ok(isDurableFile(name), name)
  for (const name of ['runtime/byclaw-agent-teams/abc123/t/team.json.123.uuid.tmp', 'runtime/byclaw-agent-teams/abc123/../x/team.json', 'runtime/byclaw-agent-teams/x',
    'runtime/other/a/b', 'agent-teams/templates/t.json', 'agent-teams/instances/sub/x.json']) assert.ok(!isDurableFile(name), name)
  for (const name of ['.credentials.yaml', 'byclaw-tool-env/client_ed25519', 'byclaw-tool-env/host_ed25519.pub', 'byclaw-tool-env/known_hosts',
    'byclaw-tool-env/tool-sandbox.json', 'byclaw-tool-env/sandbox.json', 'byclaw-tool-env/published-keys.json', 'byclaw-tool-env/catalog/unity-1/client_ed25519']) assert.ok(isDurableFile(name), name)
  for (const name of ['storages/workspace.json', 'byclaw-tool-env/ssh_config', 'byclaw-tool-env/endpoint.json', 'byclaw-tool-env/catalog/../client_ed25519',
    'byclaw-tool-env/catalog/a/b/client_ed25519', 'x/.credentials.yaml']) assert.ok(!isDurableFile(name), name)
})

test('restore: the store wins, local-only files are stored, and the store holds only ciphertext', async () => {
  const store = memoryStore()
  const { dir, cleanup } = await home()
  try {
    store.rows.set('u1\0.credentials.yaml', sealFile(key, 'u1', '.credentials.yaml', Buffer.from('records: {stored: secret}\n')))
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

test('changes are stored as they happen, including atomic renames; close stores the rest and marks deleted files', async () => {
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
    assert.equal(store.rows.get('u1\0byclaw-tool-env/known_hosts'), DELETED)
    assert.ok(![...store.rows.keys()].some(k => k.includes('unrelated')))
  } finally { await cleanup() }
})

test('a team directory moved or removed as a whole is followed by a rescan', async () => {
  const store = memoryStore()
  const { dir, cleanup } = await home()
  let files
  try {
    const team = join(dir, 'runtime/byclaw-agent-teams/h1/team-a')
    await mkdir(join(team, 'inbox'), { recursive: true })
    await writeFile(join(team, 'team.json'), '{"name":"team-a"}')
    await writeFile(join(team, 'inbox/captain.jsonl'), '{"m":1}\n')
    files = new DurableFiles({ store, key, user: 'u1', home: dir })
    await files.restore()
    assert.ok(store.rows.has('u1\0runtime/byclaw-agent-teams/h1/team-a/inbox/captain.jsonl'))
    files.start()
    await mkdir(join(dir, 'runtime/byclaw-agent-teams/h1/archive'), { recursive: true })
    await rename(team, join(dir, 'runtime/byclaw-agent-teams/h1/archive/team-a'))
    const live = row => store.rows.has(row) && store.rows.get(row) !== DELETED
    await waitFor(() => live('u1\0runtime/byclaw-agent-teams/h1/archive/team-a/team.json')
      && store.rows.get('u1\0runtime/byclaw-agent-teams/h1/team-a/team.json') === DELETED)
    await rm(join(dir, 'runtime/byclaw-agent-teams/h1/archive'), { recursive: true })
    await waitFor(() => ![...store.rows.keys()].some(row => row.includes('byclaw-agent-teams') && live(row)))
  } finally { await files?.close(); await cleanup() }
})

test('the rest of the home is not watched: a plugin socket there is never stat-ed', async () => {
  const store = memoryStore()
  const { dir, cleanup } = await home()
  const statSync = fs.statSync
  const statted = []
  try {
    await mkdir(join(dir, 'codegraph'))
    const socket = join(dir, 'codegraph/mcp-bridge.sock')
    const server = net.createServer()
    await new Promise(resolve => server.listen(socket, resolve))
    const files = new DurableFiles({ store, key, user: 'u1', home: dir })
    await files.restore()
    fs.statSync = (path, ...rest) => { statted.push(String(path)); return statSync(path, ...rest) }
    files.start()
    fs.statSync = statSync
    await mkdir(join(dir, 'agent-teams/instances'), { recursive: true })
    await writeFile(join(dir, 'agent-teams/instances/i1.json'), '{}')
    await waitFor(() => store.rows.has('u1\0agent-teams/instances/i1.json'))
    await files.close()
    await new Promise(resolve => server.close(resolve))
    assert.ok(!statted.some(path => path.includes('codegraph')), statted.join('\n'))
  } finally {
    fs.statSync = statSync
    await cleanup()
  }
})

test('a file over the size limit stays on this host', async () => {
  const store = memoryStore()
  const { dir, cleanup } = await home()
  try {
    await mkdir(join(dir, 'agent-teams/instances'), { recursive: true })
    await writeFile(join(dir, 'agent-teams/instances/big.json'), Buffer.alloc(MAX_FILE_BYTES + 1))
    const logs = []
    await new DurableFiles({ store, key, user: 'u1', home: dir, log: m => logs.push(m) }).restore()
    assert.deepEqual([...store.rows], [['u1\0agent-teams/instances/big.json', LOCAL_ONLY]])
    assert.match(logs.join('\n'), /kept on this host only/)
  } finally { await cleanup() }
})

test('a file that grew past the limit is not overwritten by its last stored copy, here or elsewhere', async () => {
  const store = memoryStore()
  const writer = await home(), other = await home()
  const name = 'runtime/byclaw-agent-teams/abc123/t/inbox/captain.jsonl'
  try {
    await mkdir(join(writer.dir, dirname(name)), { recursive: true })
    await writeFile(join(writer.dir, name), 'small')
    const files = new DurableFiles({ store, key, user: 'u1', home: writer.dir })
    await files.restore()
    await new DurableFiles({ store, key, user: 'u1', home: other.dir }).restore()
    assert.equal(await readFile(join(other.dir, name), 'utf8'), 'small')

    // It grows past the limit while the host is down, or between two flushes.
    const big = Buffer.alloc(MAX_FILE_BYTES + 1, 7)
    await writeFile(join(writer.dir, name), big)
    await new DurableFiles({ store, key, user: 'u1', home: writer.dir }).restore()
    assert.ok((await readFile(join(writer.dir, name))).equals(big))
    assert.equal(store.rows.get(`u1\0${name}`), LOCAL_ONLY)
    await new DurableFiles({ store, key, user: 'u1', home: writer.dir }).restore()
    assert.ok((await readFile(join(writer.dir, name))).equals(big))

    // Another host keeps its older copy, and does not store it in place of the newer one.
    await new DurableFiles({ store, key, user: 'u1', home: other.dir }).restore()
    assert.equal(await readFile(join(other.dir, name), 'utf8'), 'small')
    assert.equal(store.rows.get(`u1\0${name}`), LOCAL_ONLY)

    // Once it is small again, it is stored again.
    const again = new DurableFiles({ store, key, user: 'u1', home: writer.dir })
    await again.restore()
    await writeFile(join(writer.dir, name), 'compacted')
    await again.sync(name)
    assert.equal(openFile(key, 'u1', name, store.rows.get(`u1\0${name}`)).toString(), 'compacted')
  } finally { await writer.cleanup(); await other.cleanup() }
})

test('a file deleted on one host is deleted from another host that kept a copy, not stored again', async () => {
  const store = memoryStore()
  const a = await home(), b = await home()
  const name = 'byclaw-tool-env/tool-sandbox.json'
  try {
    await mkdir(join(a.dir, 'byclaw-tool-env'), { recursive: true })
    await writeFile(join(a.dir, name), '{"sandboxId":"b-1"}')
    await new DurableFiles({ store, key, user: 'u1', home: a.dir }).restore()

    // The user moves to host B, whose sandbox is released there: the record is deleted.
    const onB = new DurableFiles({ store, key, user: 'u1', home: b.dir })
    await onB.restore()
    await rm(join(b.dir, name))
    await onB.sync(name)
    assert.equal(store.rows.get(`u1\0${name}`), DELETED)

    // Back on host A, which still has the old record on its disk.
    const logs = []
    await new DurableFiles({ store, key, user: 'u1', home: a.dir, log: m => logs.push(m) }).restore()
    await assert.rejects(stat(join(a.dir, name)), { code: 'ENOENT' })
    assert.equal(store.rows.get(`u1\0${name}`), DELETED)
    assert.match(logs.join('\n'), /1 deleted, 0 kept from this host, 0 stored new/)

    // A new record is stored as usual.
    const again = new DurableFiles({ store, key, user: 'u1', home: a.dir })
    await again.restore()
    await writeFile(join(a.dir, name), '{"sandboxId":"b-2"}')
    await again.sync(name)
    assert.equal(openFile(key, 'u1', name, store.rows.get(`u1\0${name}`)).toString(), '{"sandboxId":"b-2"}')
  } finally { await a.cleanup(); await b.cleanup() }
})

test('a host that never had a file kept on another host does not mark it deleted', async () => {
  const store = memoryStore()
  const a = await home(), b = await home()
  const name = 'runtime/byclaw-agent-teams/abc123/t/archive/big.json'
  const big = Buffer.alloc(MAX_FILE_BYTES + 1, 3)
  try {
    await mkdir(join(a.dir, dirname(name)), { recursive: true })
    await writeFile(join(a.dir, name), big)
    await new DurableFiles({ store, key, user: 'u1', home: a.dir }).restore()
    assert.equal(store.rows.get(`u1\0${name}`), LOCAL_ONLY)

    // The user moves to host B, which has no copy, and its context goes away again.
    const onB = new DurableFiles({ store, key, user: 'u1', home: b.dir })
    await onB.restore()
    await onB.sync(name)
    await onB.close()
    assert.equal(store.rows.get(`u1\0${name}`), LOCAL_ONLY)

    // Back on A the file is still there; deleting it there is a deletion.
    const onA = new DurableFiles({ store, key, user: 'u1', home: a.dir })
    await onA.restore()
    assert.ok((await readFile(join(a.dir, name))).equals(big))
    await rm(join(a.dir, name))
    await onA.sync(name)
    assert.equal(store.rows.get(`u1\0${name}`), DELETED)
  } finally { await a.cleanup(); await b.cleanup() }
})

test('an older copy of a file kept on another host is not stored by a flush, only a new change is', async () => {
  const store = memoryStore()
  const a = await home(), b = await home()
  const name = 'runtime/byclaw-agent-teams/abc123/t/inbox/captain.jsonl'
  try {
    await mkdir(join(b.dir, dirname(name)), { recursive: true })
    await writeFile(join(b.dir, name), 'old')
    await new DurableFiles({ store, key, user: 'u1', home: b.dir }).restore()
    await new DurableFiles({ store, key, user: 'u1', home: a.dir }).restore()
    await writeFile(join(a.dir, name), Buffer.alloc(MAX_FILE_BYTES + 1, 5))
    await new DurableFiles({ store, key, user: 'u1', home: a.dir }).restore()
    assert.equal(store.rows.get(`u1\0${name}`), LOCAL_ONLY)

    const logs = []
    const onB = new DurableFiles({ store, key, user: 'u1', home: b.dir, log: m => logs.push(m) })
    await onB.restore()
    await onB.flush()
    assert.equal(store.rows.get(`u1\0${name}`), LOCAL_ONLY)
    assert.match(logs.join('\n'), /kept on another host/)
    await writeFile(join(b.dir, name), 'new on B')
    await onB.close()
    assert.equal(openFile(key, 'u1', name, store.rows.get(`u1\0${name}`)).toString(), 'new on B')
  } finally { await a.cleanup(); await b.cleanup() }
})

test('a host that cannot open a row leaves the store alone: another service secret overwrites nothing', async () => {
  const store = memoryStore()
  const { dir, cleanup } = await home()
  let files
  try {
    const other = deriveFileKey('another-service-secret-value')
    const sealed = sealFile(other, 'u1', '.credentials.yaml', Buffer.from('theirs'))
    store.rows.set('u1\0.credentials.yaml', sealed)
    await writeFile(join(dir, '.credentials.yaml'), 'local')
    await mkdir(join(dir, 'byclaw-tool-env'), { recursive: true })
    await writeFile(join(dir, 'byclaw-tool-env/known_hosts'), 'only here')
    const logs = []
    files = new DurableFiles({ store, key, user: 'u1', home: dir, log: m => logs.push(m) })
    await files.restore()
    files.start()
    // Neither the unreadable row, nor a file the store never had, nor a later change is written with this host's key.
    await writeFile(join(dir, 'byclaw-tool-env/client_ed25519'), 'generated here')
    await files.flush()
    await files.close()
    assert.deepEqual([...store.rows], [['u1\0.credentials.yaml', sealed]])
    assert.equal(await readFile(join(dir, '.credentials.yaml'), 'utf8'), 'local')
    assert.match(logs.join('\n'), /ERROR: durable file \.credentials\.yaml of u1 cannot be opened .*service secret differs/)
    assert.match(logs.join('\n'), /1 unreadable/)
  } finally { await files?.close(); await cleanup() }
})

test('a host another host took the files from stores nothing more', async () => {
  const store = memoryStore()
  const first = await home()
  const second = await home()
  let old
  try {
    await writeFile(join(first.dir, '.credentials.yaml'), 'v1')
    const logs = []
    old = new DurableFiles({ store, key, user: 'u1', home: first.dir, log: m => logs.push(m) })
    await old.restore()
    old.start()
    const next = new DurableFiles({ store, key, user: 'u1', home: second.dir })
    await next.restore()
    await writeFile(join(second.dir, '.credentials.yaml'), 'v2 from the new host')
    await next.sync('.credentials.yaml')
    // The old host is still alive (a stall, a lost Redis claim) and writes what it changed meanwhile.
    await writeFile(join(first.dir, '.credentials.yaml'), 'v1 changed on the old host')
    await old.sync('.credentials.yaml')
    await mkdir(join(first.dir, 'byclaw-tool-env'), { recursive: true })
    await writeFile(join(first.dir, 'byclaw-tool-env/known_hosts'), 'late')
    await old.close()
    assert.equal(openFile(key, 'u1', '.credentials.yaml', store.rows.get('u1\0.credentials.yaml')).toString(), 'v2 from the new host')
    assert.ok(!store.rows.has('u1\0byclaw-tool-env/known_hosts'))
    assert.equal(logs.filter(m => /now written by another host/.test(m)).length, 1)
    // The new host keeps writing.
    await writeFile(join(second.dir, '.credentials.yaml'), 'v3')
    await next.close()
    assert.equal(openFile(key, 'u1', '.credentials.yaml', store.rows.get('u1\0.credentials.yaml')).toString(), 'v3')
  } finally { await old?.close(); await first.cleanup(); await second.cleanup() }
})

test('a file change stores that file without rescanning the trees; a directory change rescans', async () => {
  const store = memoryStore()
  const { dir, cleanup } = await home()
  let files
  try {
    const team = join(dir, 'runtime/byclaw-agent-teams/h1/team-a')
    await mkdir(join(team, 'inbox'), { recursive: true })
    await writeFile(join(team, 'inbox/captain.jsonl'), '{"m":1}\n')
    files = new DurableFiles({ store, key, user: 'u1', home: dir })
    await files.restore()
    files.start()
    // Starting creates the watched directories, which is itself a directory change.
    await new Promise(r => setTimeout(r, 400))
    let rescans = 0
    const flush = files.flush.bind(files)
    files.flush = () => { rescans += 1; return flush() }
    const row = 'u1\0runtime/byclaw-agent-teams/h1/team-a/inbox/captain.jsonl'
    const text = () => openFile(key, 'u1', 'runtime/byclaw-agent-teams/h1/team-a/inbox/captain.jsonl', store.rows.get(row)).toString()
    // The plugins write a temporary beside the file, then rename it over.
    await writeFile(join(team, 'inbox/captain.jsonl.1.tmp'), '{"m":1}\n{"m":2}\n')
    await rename(join(team, 'inbox/captain.jsonl.1.tmp'), join(team, 'inbox/captain.jsonl'))
    await waitFor(() => text() === '{"m":1}\n{"m":2}\n')
    await new Promise(r => setTimeout(r, 400))
    assert.equal(rescans, 0)
    await mkdir(join(team, 'tasks'))
    await waitFor(() => rescans > 0)
  } finally { await files?.close(); await cleanup() }
})

test('a restore interrupted mid-write leaves no file that is stored later', async () => {
  const store = memoryStore()
  const { dir, cleanup } = await home()
  try {
    // What a crash between the staged write and the rename leaves behind.
    const left = 'runtime/byclaw-agent-teams/h1/team-a/team.json.0a1b2c3d4e5f.tmp'
    await mkdir(dirname(join(dir, left)), { recursive: true })
    await writeFile(join(dir, left), 'half')
    const files = new DurableFiles({ store, key, user: 'u1', home: dir })
    await files.restore()
    await files.close()
    assert.deepEqual([...store.rows.keys()], [])
  } finally { await cleanup() }
})

/** A pool over rows in memory that understands the statements {@link sqlFileStore} sends. */
function memoryPool() {
  const rows = new Map()
  const statements = []
  const id = (user, name) => `${user}\0${name}`
  const query = async (text, values = []) => {
    statements.push(text)
    if (/^(?:BEGIN|COMMIT|ROLLBACK|CREATE TABLE)/.test(text)) return { rows: [], rowCount: 0 }
    if (/^SELECT value FROM .* FOR UPDATE$/.test(text)) {
      const value = rows.get(id(values[0], values[1]))
      return { rows: value === undefined ? [] : [{ value }], rowCount: value === undefined ? 0 : 1 }
    }
    if (text.startsWith('SELECT name, value')) {
      const found = [...rows].filter(([k]) => k.startsWith(`${values[0]}\0`)).map(([k, value]) => ({ name: k.split('\0')[1], value }))
      return { rows: found, rowCount: found.length }
    }
    if (text.startsWith('UPDATE')) {
      if (!rows.has(id(values[2], values[3]))) return { rows: [], rowCount: 0 }
      rows.set(id(values[2], values[3]), values[0])
      return { rows: [], rowCount: 1 }
    }
    if (text.startsWith('INSERT')) {
      if (rows.has(id(values[0], values[1]))) throw Object.assign(new Error('duplicate key'), { code: '23505' })
      rows.set(id(values[0], values[1]), values[2])
      return { rows: [], rowCount: 1 }
    }
    throw new Error(`unexpected statement: ${text}`)
  }
  return { rows, statements, query, connect: async () => ({ query, release() {} }) }
}

test('the store gives each claim a higher epoch and refuses writes from an older one', async () => {
  const pool = memoryPool()
  const store = sqlFileStore(pool)
  const first = await store.claim('u1')
  await store.put('u1', first, 'a', 'one')
  const second = await store.claim('u1')
  assert.equal(second, first + 1)
  await assert.rejects(store.put('u1', first, 'a', 'stale'), DurableFilesLostError)
  await assert.rejects(store.put('u1', first, 'b', 'stale'), DurableFilesLostError)
  await store.put('u1', second, 'a', 'two')
  // The epoch row is not one of the user's files, and another user's epoch is their own.
  assert.deepEqual(await store.list('u1'), [{ name: 'a', value: 'two' }])
  assert.equal(await store.claim('u2'), 1)
  // A refused write is rolled back, and every write checks the epoch under a row lock in its transaction.
  assert.ok(pool.statements.includes('ROLLBACK'))
  assert.ok(pool.statements.some(text => /FOR UPDATE$/.test(text)))
})

test('a change whose write failed is stored at the next restore instead of being overwritten', async () => {
  const store = memoryStore()
  let failing = false
  const flaky = { list: user => store.list(user), claim: user => store.claim(user), put: async (...args) => { if (failing) throw new Error('db down'); return store.put(...args) } }
  const a = await home(), b = await home()
  const credentials = '.credentials.yaml', key2 = 'byclaw-tool-env/client_ed25519'
  try {
    await writeFile(join(a.dir, credentials), 'v1')
    await mkdir(join(a.dir, 'byclaw-tool-env'), { recursive: true })
    await writeFile(join(a.dir, key2), 'id-1')
    const first = new DurableFiles({ store: flaky, key, user: 'u1', home: a.dir })
    await first.restore()

    failing = true
    await writeFile(join(a.dir, credentials), 'v2')
    await rm(join(a.dir, key2))
    await assert.rejects(first.close(), /db down/)
    failing = false

    await new DurableFiles({ store: flaky, key, user: 'u1', home: a.dir }).restore()
    assert.equal(await readFile(join(a.dir, credentials), 'utf8'), 'v2')
    assert.equal(openFile(key, 'u1', credentials, store.rows.get(`u1\0${credentials}`)).toString(), 'v2')
    assert.equal(store.rows.get(`u1\0${key2}`), DELETED)

    // A change another host stored still wins over this host's unchanged copy.
    const onB = new DurableFiles({ store, key, user: 'u1', home: b.dir })
    await onB.restore()
    await writeFile(join(b.dir, credentials), 'v3')
    await onB.close()
    await new DurableFiles({ store, key, user: 'u1', home: a.dir }).restore()
    assert.equal(await readFile(join(a.dir, credentials), 'utf8'), 'v3')
  } finally { await a.cleanup(); await b.cleanup() }
})

test('a row only opens for its own user and name, and only with the right key', () => {
  const sealed = sealFile(key, 'u1', '.credentials.yaml', Buffer.from('secret'))
  assert.throws(() => openFile(key, 'u2', '.credentials.yaml', sealed))
  assert.throws(() => openFile(key, 'u1', 'byclaw-tool-env/client_ed25519', sealed))
  assert.throws(() => openFile(deriveFileKey('another-service-secret-value'), 'u1', '.credentials.yaml', sealed))
  assert.throws(() => deriveFileKey('short'), /too short/)
})
