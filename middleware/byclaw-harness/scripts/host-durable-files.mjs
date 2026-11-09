/**
 * State a shared host keeps in a user's DSH home, kept in the database instead of only on this
 * host's disk: the credential store (`.credentials.yaml`), the tool environment's SSH identity,
 * published-key record and sandbox records, and AgentTeams' runtime state (team, inboxes, tasks,
 * archives) and team instances. The files stay where their plugins read and write them; the host
 * restores them before the user's context boots, writes every change back as it happens, and
 * flushes once more when the context goes away. Values are encrypted (AES-256-GCM) with a key
 * derived from the host's service secret and bound to the user and file name.
 *
 * A deleted file leaves a {@link DELETED} row, so a host still holding an old copy deletes it
 * instead of storing it again. A file over {@link MAX_FILE_BYTES} leaves a {@link LOCAL_ONLY} row:
 * the host that wrote it keeps it, and no older copy overwrites it or is stored in its place.
 *
 * One host serves a user at a time (the Redis claim), so the files have one writer.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { mkdirSync, watch } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

const TOOL_ENV = /^byclaw-tool-env\/(?:catalog\/(?!\.{1,2}\/)[A-Za-z0-9._-]+\/)?(?:client_ed25519(?:\.pub)?|host_ed25519(?:\.pub)?|known_hosts|published-keys\.json|tool-sandbox\.json|sandbox\.json)$/
/** AgentTeams state directories: every file below them, except the plugins' atomic-write temporaries. */
export const DURABLE_TREES = ['runtime/byclaw-agent-teams', 'agent-teams/instances']
/** Larger files are left on this host (and logged): the state above is small, an archive should not be. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024
/** Stored value of a file that was deleted. Not ciphertext: sealed values start with `v1:`. */
export const DELETED = 'deleted'
/** Stored value of a file too large to store, kept by the host that wrote it. */
export const LOCAL_ONLY = 'local-only'

/** Whether a DSH-home-relative name is one of the durable files. */
export function isDurableFile(name) {
  if (name === '.credentials.yaml' || TOOL_ENV.test(name)) return true
  const segments = name.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..') || name.endsWith('.tmp')) return false
  if (name.startsWith('runtime/byclaw-agent-teams/')) return segments.length >= 4 && segments.length <= 8
  return /^agent-teams\/instances\/[^/]+\.json$/.test(name)
}

/** Whether a change under this name may have moved or removed durable files (a directory rename or delete). */
function underDurableTree(name) {
  return DURABLE_TREES.some(tree => name === tree || name.startsWith(`${tree}/`) || tree.startsWith(`${name}/`))
}

const KEY_INFO = 'byclaw-host-files/v1'
const FORMAT = 'v1'

/** Derive the file key from the service secret (the same file BE's credential vault uses). */
export function deriveFileKey(secret) {
  const material = Buffer.from(String(secret).trim(), 'utf8')
  if (material.length < 16) throw new Error('service secret is too short to derive a file key')
  return Buffer.from(hkdfSync('sha256', material, Buffer.from('byclaw'), Buffer.from(KEY_INFO), 32))
}

export function sealFile(key, user, name, plaintext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${user}\0${name}`))
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return `${FORMAT}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`
}

export function openFile(key, user, name, sealed) {
  const [format, data] = String(sealed).split(':', 2)
  if (format !== FORMAT || data === undefined) throw new Error(`stored file ${name} has an unknown format`)
  const raw = Buffer.from(data, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  decipher.setAAD(Buffer.from(`${user}\0${name}`))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()])
}

/** Rows in `<schema>.dsh_host_file`, one per user and file. openGauss has no ON CONFLICT: update, then insert. */
export function sqlFileStore(pool, schema = 'byai') {
  const table = `${schema}.dsh_host_file`
  let ready
  const ensure = () => ready ??= pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
    user_code varchar(128) NOT NULL,
    name varchar(512) NOT NULL,
    value text NOT NULL,
    updated_at bigint NOT NULL,
    PRIMARY KEY (user_code, name)
  )`).catch((error) => { ready = undefined; throw error })
  return {
    async list(user) {
      await ensure()
      const { rows } = await pool.query(`SELECT name, value FROM ${table} WHERE user_code = $1`, [user])
      return rows.map(row => ({ name: row.name, value: row.value }))
    },
    async put(user, name, value) {
      await ensure()
      const now = Date.now()
      const updated = await pool.query(`UPDATE ${table} SET value = $1, updated_at = $2 WHERE user_code = $3 AND name = $4`, [value, now, user, name])
      if (updated.rowCount > 0) return
      try {
        await pool.query(`INSERT INTO ${table} (user_code, name, value, updated_at) VALUES ($1, $2, $3, $4)`, [user, name, value, now])
      } catch (error) {
        if (error?.code !== '23505') throw error
        await pool.query(`UPDATE ${table} SET value = $1, updated_at = $2 WHERE user_code = $3 AND name = $4`, [value, now, user, name])
      }
    },
  }
}

const digest = data => createHash('sha256').update(data).digest('hex')

async function readIfPresent(path) {
  try { return await readFile(path) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}

/** @returns whether there was a file to remove. */
async function removeIfPresent(path) {
  try { await rm(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

/** Every durable file present under `home`, by name relative to it. */
async function presentFiles(home) {
  const found = []
  async function walk(dir) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      const name = relative(home, path).split(sep).join('/')
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && isDurableFile(name)) found.push(name)
    }
  }
  if (await readIfPresent(join(home, '.credentials.yaml')) !== undefined) found.push('.credentials.yaml')
  for (const root of ['byclaw-tool-env', ...DURABLE_TREES]) await walk(join(home, root))
  return found
}

/**
 * Keep one user's durable files in the store.
 * @param options - { store, key, user, home, log }.
 */
export class DurableFiles {
  constructor({ store, key, user, home, log = () => {} }) {
    Object.assign(this, { store, key, user, home, log })
    /** name -> what the store holds: the content's digest, {@link DELETED} or {@link LOCAL_ONLY}. Unchanged rewrites are not sent. */
    this.stored = new Map()
    this.queue = new Map()
    this.watchers = []
    this.closed = false
    this.rescan = undefined
  }

  /**
   * Bring the home in line with the store (the store wins): write stored files, delete deleted
   * ones, and leave files kept on their host alone. Then store local files the store never had.
   */
  async restore() {
    const rows = await this.store.list(this.user)
    let restored = 0, deleted = 0
    for (const row of rows) {
      if (!isDurableFile(row.name)) continue
      const path = join(this.home, row.name)
      if (row.value === LOCAL_ONLY || row.value === DELETED) {
        this.stored.set(row.name, row.value)
        if (row.value === DELETED && await removeIfPresent(path)) deleted += 1
        continue
      }
      const data = openFile(this.key, this.user, row.name, row.value)
      this.stored.set(row.name, digest(data))
      const current = await readIfPresent(path)
      // Only this host can have grown it past the limit, after it was last stored: the local file is newer.
      if (current !== undefined && current.length > MAX_FILE_BYTES) {
        await this.sync(row.name)
        continue
      }
      if (current === undefined || !current.equals(data)) {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        const staged = `${path}.${randomBytes(6).toString('hex')}.restore`
        await writeFile(staged, data, { mode: 0o600 })
        await rename(staged, path)
        restored += 1
      }
    }
    const missing = (await presentFiles(this.home)).filter(name => !this.stored.has(name))
    for (const name of missing) await this.sync(name)
    this.log(`durable files for ${this.user}: ${rows.length} stored, ${restored} restored, ${deleted} deleted, ${missing.length} stored new`)
  }

  /**
   * Follow changes to the durable files until {@link close}. Only their own directories are watched:
   * Node's recursive watch on Linux stats every file below its root, and the rest of the home holds
   * plugins' sockets (a `stat` of one before the first context boot breaks DSH's module resolution).
   */
  start() {
    const onChange = prefix => (_event, filename) => {
      if (filename === null || filename === undefined) return
      const name = prefix + String(filename).split(sep).join('/')
      if (isDurableFile(name)) void this.sync(name).catch(error => this.log(`storing ${name} for ${this.user} failed: ${error.message}`))
      // A renamed or removed team directory reports only the directory: rescan the trees shortly after.
      if (underDurableTree(name) && !this.closed) {
        clearTimeout(this.rescan)
        this.rescan = setTimeout(() => {
          void this.flush().catch(error => this.log(`storing durable files for ${this.user} failed: ${error.message}`))
        }, 200)
      }
    }
    const follow = (dir, prefix, recursive) => {
      const watcher = watch(join(this.home, dir), { recursive }, onChange(prefix))
      watcher.on('error', error => this.log(`watching durable files of ${this.user} failed: ${error.message}`))
      this.watchers.push(watcher)
    }
    follow('.', '', false)
    for (const root of ['byclaw-tool-env', ...DURABLE_TREES]) {
      mkdirSync(join(this.home, root), { recursive: true, mode: 0o700 })
      follow(root, `${root}/`, true)
    }
  }

  /** Store one file's current content, or forget it when it is gone. Calls for one name run in order. */
  sync(name) {
    const previous = this.queue.get(name) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      const data = await readIfPresent(join(this.home, name))
      if (data === undefined) {
        if (!this.stored.has(name) || this.stored.get(name) === DELETED) return
        await this.store.put(this.user, name, DELETED)
        this.stored.set(name, DELETED)
        return
      }
      if (data.length > MAX_FILE_BYTES) {
        if (this.stored.get(name) === LOCAL_ONLY) return
        this.log(`durable file ${name} of ${this.user} is ${data.length} bytes; kept on this host only`)
        await this.store.put(this.user, name, LOCAL_ONLY)
        this.stored.set(name, LOCAL_ONLY)
        return
      }
      const hash = digest(data)
      if (this.stored.get(name) === hash) return
      await this.store.put(this.user, name, sealFile(this.key, this.user, name, data))
      this.stored.set(name, hash)
    })
    this.queue.set(name, next)
    void next.finally(() => { if (this.queue.get(name) === next) this.queue.delete(name) }).catch(() => {})
    return next
  }

  /** Store whatever changed since the last write (a missed watch event, or one still queued). */
  async flush() {
    const names = new Set([...await presentFiles(this.home), ...this.stored.keys()])
    await Promise.all([...names].map(name => this.sync(name)))
  }

  async close() {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.rescan)
    for (const watcher of this.watchers) watcher.close()
    await this.flush()
  }
}

