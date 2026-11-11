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
 * Restoring lets the store win, except where it still holds what this host last stored and the
 * file changed here since (the write failed, or the host died first): {@link SYNCED_FILE}
 * remembers what this host stored.
 *
 * One host serves a user at a time (the Redis claim). The store enforces it for these files too:
 * restoring raises the user's epoch, and a write from a host holding an older one is refused
 * ({@link DurableFilesLostError}), after which that host stores nothing more for the user.
 *
 * A row this host cannot open (another service secret, or a damaged value) is never replaced:
 * the host then stores nothing for the user, so a host with the wrong secret cannot overwrite
 * what the others wrote.
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
/** Digests of what this host last stored or restored, in the home: a local file that differs changed here since. */
export const SYNCED_FILE = '.byclaw-durable-files.json'

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

/** Name of the row holding a user's epoch; not a durable file name. */
const OWNER_ROW = '.owner'

/** A newer host took the user's durable files; this host may not write them any more. */
export class DurableFilesLostError extends Error {
  constructor(user) {
    super(`durable files of ${user} are now written by another host`)
    this.name = 'DurableFilesLostError'
  }
}

/** Run `body` in one transaction on a checked-out client; a connection that broke is not reused. */
async function transaction(pool, body) {
  const client = await pool.connect()
  // The pool stops listening once a client is checked out; unhandled, a dropped connection would kill the host.
  let broken
  const onError = (error) => { broken = error }
  client.on?.('error', onError)
  try {
    await client.query('BEGIN')
    const result = await body(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    if (broken === undefined) await client.query('ROLLBACK').catch((rollback) => { broken = rollback })
    throw error
  } finally {
    client.off?.('error', onError)
    client.release(broken)
  }
}

/**
 * Rows in `<schema>.dsh_host_file`, one per user and file, plus one holding the user's epoch.
 * openGauss has no ON CONFLICT: update, then insert.
 */
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
      return rows.filter(row => row.name !== OWNER_ROW).map(row => ({ name: row.name, value: row.value }))
    },
    /** Take the user's files for this host: raise the epoch and return it. Earlier holders can no longer write. */
    async claim(user) {
      await ensure()
      const raise = () => transaction(pool, async (tx) => {
        const { rows } = await tx.query(`SELECT value FROM ${table} WHERE user_code = $1 AND name = $2 FOR UPDATE`, [user, OWNER_ROW])
        const epoch = rows[0] === undefined ? 1 : Number(rows[0].value) + 1
        if (rows[0] === undefined) await tx.query(`INSERT INTO ${table} (user_code, name, value, updated_at) VALUES ($1, $2, $3, $4)`, [user, OWNER_ROW, String(epoch), Date.now()])
        else await tx.query(`UPDATE ${table} SET value = $1, updated_at = $2 WHERE user_code = $3 AND name = $4`, [String(epoch), Date.now(), user, OWNER_ROW])
        return epoch
      })
      // Two hosts creating the row at once: the loser finds it on the second try.
      return raise().catch((error) => { if (error?.code !== '23505') throw error; return raise() })
    },
    /**
     * Write one row while this host still holds `epoch`.
     * @throws {DurableFilesLostError} when another host claimed the user since.
     */
    async put(user, epoch, name, value) {
      await ensure()
      await transaction(pool, async (tx) => {
        // The lock on the epoch row also orders the user's writers, so the insert below cannot race another.
        const { rows } = await tx.query(`SELECT value FROM ${table} WHERE user_code = $1 AND name = $2 FOR UPDATE`, [user, OWNER_ROW])
        if (rows[0] === undefined || Number(rows[0].value) !== epoch) throw new DurableFilesLostError(user)
        const now = Date.now()
        const updated = await tx.query(`UPDATE ${table} SET value = $1, updated_at = $2 WHERE user_code = $3 AND name = $4`, [value, now, user, name])
        if (updated.rowCount === 0) await tx.query(`INSERT INTO ${table} (user_code, name, value, updated_at) VALUES ($1, $2, $3, $4)`, [user, name, value, now])
      })
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
    /** name -> digest of the content this host last stored or restored, kept in {@link SYNCED_FILE} across boots. */
    this.synced = new Map()
    /** {@link LOCAL_ONLY} files this host holds: only their deletion here is a deletion. */
    this.held = new Set()
    /** name -> digest of a local copy older than the one another host keeps; not stored unless it changes. */
    this.stale = new Map()
    this.queue = new Map()
    this.savingSynced = Promise.resolve()
    this.watchers = []
    this.closed = false
    /** Set once this host may no longer store the user's files: another host took them, or a row here cannot be opened. */
    this.stopped = false
    this.epoch = undefined
    this.rescan = undefined
  }

  /**
   * Bring the home in line with the store: write stored files, delete deleted ones, and leave
   * files kept on their host alone. The store wins, except where it still holds what this host
   * last stored and the file changed here since (the write failed, or the host died first).
   * Then store local files the store never had. A row that cannot be opened is left as it is,
   * and from then on this host stores nothing for the user.
   */
  async restore() {
    // Claim before reading: whatever an earlier host writes after this is refused, not missed.
    this.epoch = await this.store.claim(this.user)
    const rows = await this.store.list(this.user)
    this.synced = await this.readSynced()
    let restored = 0, deleted = 0, kept = 0, unreadable = 0
    for (const row of rows) {
      if (!isDurableFile(row.name)) continue
      const path = join(this.home, row.name)
      const current = await readIfPresent(path)
      if (row.value === LOCAL_ONLY) {
        this.stored.set(row.name, LOCAL_ONLY)
        if (current !== undefined && current.length > MAX_FILE_BYTES) this.held.add(row.name)
        else if (current !== undefined) {
          // Only the host holding it can have grown it past the limit: this copy is older.
          this.stale.set(row.name, digest(current))
          this.log(`durable file ${row.name} of ${this.user} is kept on another host; this host's copy is older and not stored`)
        }
        continue
      }
      if (row.value === DELETED) {
        this.stored.set(row.name, DELETED)
        if (current === undefined) continue
        await removeIfPresent(path)
        this.synced.delete(row.name)
        deleted += 1
        continue
      }
      let data
      try {
        data = openFile(this.key, this.user, row.name, row.value)
      } catch (error) {
        // Writes above followed a row this key opened, so a host with another secret has written nothing yet.
        if (!this.stopped) this.stop(`ERROR: durable file ${row.name} of ${this.user} cannot be opened (${error.message}): this host's service secret differs from the one that stored it, or the row is damaged. Nothing of this user is stored from this host until the secret matches or the row is removed`)
        unreadable += 1
        continue
      }
      const hash = digest(data)
      this.stored.set(row.name, hash)
      if (current !== undefined && current.equals(data)) { this.synced.set(row.name, hash); continue }
      // Only this host can have grown it past the limit, after it was last stored: the local file is newer.
      // So is a file changed or deleted here while the store still holds what this host last stored.
      const changedHere = this.synced.get(row.name) === hash
      if ((current !== undefined && current.length > MAX_FILE_BYTES) || changedHere) {
        await this.sync(row.name)
        kept += 1
        continue
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      // Named like the plugins' own temporaries, so one left by a crash is never taken for a durable file.
      const staged = `${path}.${randomBytes(6).toString('hex')}.tmp`
      await writeFile(staged, data, { mode: 0o600 })
      await rename(staged, path)
      this.synced.set(row.name, hash)
      restored += 1
    }
    const missing = this.stopped ? [] : (await presentFiles(this.home)).filter(name => !this.stored.has(name))
    for (const name of missing) await this.sync(name)
    await this.saveSynced()
    this.log(`durable files for ${this.user}: ${rows.length} stored, ${restored} restored, ${deleted} deleted, ${kept} kept from this host, ${missing.length} stored new${unreadable > 0 ? `, ${unreadable} unreadable` : ''}`)
  }

  /**
   * Follow changes to the durable files until {@link close}. Only their own directories are watched:
   * Node's recursive watch on Linux stats every file below its root, and the rest of the home holds
   * plugins' sockets (a `stat` of one before the first context boot breaks DSH's module resolution).
   */
  start() {
    if (this.stopped) return
    // A renamed or removed team directory reports only the directory: rescan the trees shortly after.
    const rescan = () => {
      if (this.closed || this.stopped) return
      clearTimeout(this.rescan)
      this.rescan = setTimeout(() => {
        void this.flush().catch(error => this.log(`storing durable files for ${this.user} failed: ${error.message}`))
      }, 200)
    }
    const onChange = prefix => (_event, filename) => {
      if (filename === null || filename === undefined) return
      const name = prefix + String(filename).split(sep).join('/')
      if (isDurableFile(name)) {
        // A file's own change needs no rescan. The name is a directory when it cannot be read as a file,
        // and may have been one when nothing is there and no file of that name was ever stored.
        void this.sync(name).then(() => { if (!this.stored.has(name)) rescan() }, (error) => {
          if (error.code === 'EISDIR') rescan()
          else this.log(`storing ${name} for ${this.user} failed: ${error.message}`)
        })
      } else if (underDurableTree(name) && !name.endsWith('.tmp')) rescan()
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

  /** Store one file's current state. Calls for one name run in order; losing the files to another host stops this one. */
  sync(name) {
    const previous = this.queue.get(name) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => this.storeOne(name).catch((error) => {
      if (!(error instanceof DurableFilesLostError)) throw error
      this.stop(`ERROR: ${error.message}; this host stores nothing more for the user`)
    }))
    this.queue.set(name, next)
    void next.finally(() => { if (this.queue.get(name) === next) this.queue.delete(name) }).catch(() => {})
    return next
  }

  /** Stop storing and watching: the store's rows are no longer this host's to write. */
  stop(reason) {
    if (this.stopped) return
    this.stopped = true
    clearTimeout(this.rescan)
    for (const watcher of this.watchers) watcher.close()
    this.log(reason)
  }

  /** Store one file's current content, or mark it deleted when it is gone. */
  async storeOne(name) {
    if (this.stopped) return
    const data = await readIfPresent(join(this.home, name))
    if (data === undefined) {
      const stored = this.stored.get(name)
      // A file kept on another host is not missing there.
      if (stored === undefined || stored === DELETED || (stored === LOCAL_ONLY && !this.held.has(name))) return
      await this.store.put(this.user, this.epoch, name, DELETED)
      this.stored.set(name, DELETED)
      this.held.delete(name)
      this.markSynced(name, undefined)
      return
    }
    if (data.length > MAX_FILE_BYTES) {
      this.held.add(name)
      if (this.stored.get(name) === LOCAL_ONLY) return
      this.log(`durable file ${name} of ${this.user} is ${data.length} bytes; kept on this host only`)
      await this.store.put(this.user, this.epoch, name, LOCAL_ONLY)
      this.stored.set(name, LOCAL_ONLY)
      this.markSynced(name, undefined)
      return
    }
    const hash = digest(data)
    if (this.stored.get(name) === hash || this.stale.get(name) === hash) return
    await this.store.put(this.user, this.epoch, name, sealFile(this.key, this.user, name, data))
    this.stored.set(name, hash)
    this.held.delete(name)
    this.stale.delete(name)
    this.markSynced(name, hash)
  }

  async readSynced() {
    const raw = await readIfPresent(join(this.home, SYNCED_FILE))
    if (raw === undefined) return new Map()
    try {
      return new Map(Object.entries(JSON.parse(raw.toString('utf8'))).filter(([, hash]) => typeof hash === 'string'))
    } catch {
      this.log(`${SYNCED_FILE} of ${this.user} is unreadable; the store wins for every file`)
      return new Map()
    }
  }

  markSynced(name, hash) {
    if (hash === undefined) this.synced.delete(name)
    else this.synced.set(name, hash)
    void this.saveSynced()
  }

  /** Write {@link synced} to the home; writes run in order, and a failed one only loses the newer-here check. */
  saveSynced() {
    this.savingSynced = this.savingSynced.then(async () => {
      const path = join(this.home, SYNCED_FILE)
      const staged = `${path}.${randomBytes(6).toString('hex')}.tmp`
      await writeFile(staged, JSON.stringify(Object.fromEntries(this.synced)), { mode: 0o600 })
      await rename(staged, path)
    }).catch(error => this.log(`writing ${SYNCED_FILE} of ${this.user} failed: ${error.message}`))
    return this.savingSynced
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
    try { await this.flush() } finally { await this.savingSynced }
  }
}

