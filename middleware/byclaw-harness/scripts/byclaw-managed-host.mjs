/** Durable, tenant-context fenced lifecycle. No DSH or Redis imports. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

const fail = (message, status = 409) => Object.assign(new Error(message), { status })
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const same = (a, b) => a.instanceId === b.instanceId && a.mappingId === b.mappingId && a.generation === b.generation
const fence = value => ({ managed: true, instanceId: value.instanceId, mappingId: value.mappingId, generation: value.generation })

/** Bound cold context startup independently of resident capacity. Never release an active boot early. */
export function limitContextStartup(boot, concurrency = 1, { queueCapacity = 128, now = Date.now, log = () => {} } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('startup concurrency must be a positive integer')
  if (!Number.isSafeInteger(queueCapacity) || queueCapacity < 0) throw new Error('startup queue capacity must be a nonnegative integer')
  let active = 0
  const queue = []
  const drain = () => {
    while (active < concurrency && queue.length) {
      const item = queue.shift()
      if (item.hooks.admission?.allowed() === false) { item.cancel(); continue }
      item.waiting = false
      active++
      item.resolve()
    }
  }
  return async (key, request, hooks) => {
    const queuedAt = now()
    const startup = hooks.startup = { phase: 'queued', queuedAt }
    if (active >= concurrency && queue.length >= queueCapacity) {
      Object.assign(startup, { phase: 'rejected', queueMs: 0 })
      throw fail('context startup queue is full', 429)
    }
    let item
    const admitted = new Promise((resolve, reject) => {
      item = { hooks, resolve, waiting: true, cancel() {
        if (!item.waiting) return
        item.waiting = false
        const index = queue.indexOf(item)
        if (index !== -1) queue.splice(index, 1)
        startup.phase = 'cancelled'; startup.queueMs = now() - queuedAt
        reject(new Error('context startup cancelled before admission'))
      } }
      hooks.cancelStartup = item.cancel
      queue.push(item)
      drain()
    })
    log(`context ${key} startup queued; active=${active}; waiting=${queue.length}`)
    await admitted
    const startedAt = now()
    Object.assign(startup, { phase: 'booting', startedAt, queueMs: startedAt - queuedAt })
    log(`context ${key} startup admitted; queueMs=${startup.queueMs}; active=${active}`)
    try {
      // Removal can win between permit delivery and this continuation.
      if (hooks.admission?.allowed() === false) throw new Error('context removed/released before boot')
      const handle = await boot(key, request, hooks)
      startup.phase = 'ready'
      return handle
    } catch (error) {
      startup.phase = 'failed'
      throw error
    } finally {
      startup.bootMs = now() - startedAt
      log(`context ${key} startup ${startup.phase}; queueMs=${startup.queueMs}; bootMs=${startup.bootMs}`)
      delete hooks.cancelStartup
      active--
      drain()
    }
  }
}

export function startupDiagnostics(hooks, now = Date.now) {
  const value = hooks.startup
  if (!value) return {}
  return { startup: { ...value, queueMs: value.queueMs ?? now() - value.queuedAt,
    ...(value.startedAt === undefined ? {} : { bootMs: value.bootMs ?? now() - value.startedAt }) } }
}

export class ManagedUserRegistry {
  managed = true
  entries = new Map()
  serial = Promise.resolve()
  scope = new AsyncLocalStorage()
  closing = false
  constructor({ root, hostId, capacity, boot, startupConcurrency = 1, startupQueueCapacity = 128, claim = async () => {}, release = async () => {}, now = Date.now, log = () => {} }) {
    Object.assign(this, { root, hostId, capacity, claim, release, now, log })
    this.boot = limitContextStartup(boot, startupConcurrency, { queueCapacity: startupQueueCapacity, now, log })
  }
  locked(operation) {
    const result = this.serial.then(operation)
    this.serial = result.catch(() => {})
    return result
  }
  validate(key, value) {
    if (!keyPattern.test(key) || key.includes('..')) throw fail('invalid context key', 400)
    if (!value || value.instanceId !== this.hostId || !uuid.test(value.instanceId) || !uuid.test(value.mappingId)
      || !Number.isSafeInteger(value.generation) || value.generation < 1) throw fail('invalid managed identity fence', 400)
    if (value.contextKey !== undefined && value.contextKey !== key) throw fail('context identity mismatch')
    return fence(value)
  }
  async saved(key) {
    try { return JSON.parse(await readFile(join(this.root, 'managed-fences', `${key}.json`), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  }
  async persist(key, value) {
    const dir = join(this.root, 'managed-fences')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const target = join(dir, `${key}.json`)
    const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(JSON.stringify(value)); await file.sync() } finally { await file.close() }
    await rename(temporary, target)
    const directory = await open(dir, 'r')
    try { await directory.sync() } finally { await directory.close() }
  }
  async check(key, value, creating = false) {
    this.validate(key, value)
    const current = this.entries.get(key)
    if (current && !same(current.request, value)) throw fail('live context fence mismatch')
    const saved = await this.saved(key)
    if (saved && !same(saved, value) && (!creating || !saved.deleted || value.generation <= saved.generation)) throw fail('persisted fence mismatch')
    return saved
  }
  get(key) { return this.entries.get(key) }
  list() { return [...this.entries.values()].map(e => ({ contextKey: e.user, status: e.status })) }
  servedUsers() { return [...this.entries.keys()] }
  webToken(key) { return this.admitting(key) ? this.get(key)?.webToken : undefined }
  admitting(key) { const e = this.get(key); return !!e && !e.draining && e.request.leaseExpiresAt > this.now() && e.status === 'ready' }
  beginWeb(key, disconnect) {
    if (!this.admitting(key)) throw fail('context lease expired or draining', 503)
    const entry = this.get(key); if (disconnect) entry.sockets.add(disconnect); entry.webRequests++; entry.lastActiveAt = this.now()
    let finished = false
    return () => { if (!finished) { finished = true; if (disconnect) entry.sockets.delete(disconnect); entry.webRequests--; entry.lastActiveAt = this.now() } }
  }
  async activity(entry) {
    let value
    try { value = await entry.handle?.activity?.() } catch { /* unknown is busy */ }
    const known = value && typeof value.busy === 'boolean' && Number.isSafeInteger(value.activeRequests) && value.activeRequests >= 0
    const activeRequests = entry.webRequests + (known ? value.activeRequests : 0)
    const busy = !known || value.busy || activeRequests > 0
    if (busy) entry.lastActiveAt = this.now()
    return { activeRequests, busy, lastActiveAt: entry.lastActiveAt }
  }
  async describe(key, value) {
    await this.locked(() => this.check(key, value))
    const entry = this.get(key)
    return { ...fence(value), contextKey: key, status: entry?.status ?? 'absent', hostId: this.hostId,
      ...(entry ? { ...await this.activity(entry), ...startupDiagnostics(entry.hooks, this.now) } : { activeRequests: 0, busy: false, lastActiveAt: this.now() }),
      ...(this.admitting(key) ? { webPath: `/u/${key}/`, webToken: entry.webToken } : {}) }
  }
  async ensure(key, request) {
    const entry = await this.locked(async () => {
      if (this.closing) throw fail('host is shutting down', 503)
      const saved = await this.check(key, request, true)
      if (saved?.deleted && same(saved, request)) throw fail('generation is tombstoned/released')
      if (request.managed !== true || request.sandboxId !== this.hostId || request.capacity !== this.capacity
        || !keyPattern.test(request.userCode ?? '') || !Number.isSafeInteger(request.leaseExpiresAt)
        || request.leaseExpiresAt <= this.now() || request.workerAgentType !== `BYCLAW_DSH_SHARED_${key}_${request.generation}`) throw fail('invalid managed identity or expired lease', 400)
      const current = this.get(key)
      if (current) {
        if (current.draining || current.request.leaseExpiresAt <= this.now()) throw fail('context lease expired/released')
        if (current.request.userCode !== request.userCode || current.request.enterpriseId !== request.enterpriseId || current.request.userId !== request.userId) throw fail('tenant identity mismatch')
        current.request.leaseExpiresAt = Math.max(current.request.leaseExpiresAt, request.leaseExpiresAt)
        // No context ran for a rejected admission. Keep the original fence,
        // capacity reservation and owned/renewed claim; only retry its boot.
        if (current.status === 'failed' && current.hooks.startup?.phase === 'rejected') this.start(current, false)
        return current
      }
      if (!request.env || typeof request.env !== 'object' || Array.isArray(request.env)) throw fail('fresh context requires env', 400)
      for (const [name, value] of Object.entries(request.env)) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== 'string') throw fail('invalid env', 400)
      if (this.entries.size >= this.capacity) throw fail('host capacity exceeded', 429)
      await this.persist(key, { ...fence(request), deleted: false })
      const e = { user: key, status: 'starting', request: { ...request, env: { ...request.env } }, hooks: {}, sockets: new Set(), webRequests: 0, lastActiveAt: this.now(), webToken: randomBytes(32).toString('base64url') }
      e.hooks.admission = { allowed: () => !e.draining && e.request.leaseExpiresAt > this.now() }
      this.entries.set(key, e)
      this.start(e, true)
      return e
    })
    return entry.ready
  }
  start(entry, claim) {
    entry.status = 'starting'
    delete entry.error
    entry.booted = this.scope.run(entry, async () => {
      if (claim) await this.claim(entry.user, entry.request)
      entry.handle = await this.boot(entry.user, entry.request, entry.hooks)
      return entry.handle
    })
    entry.ready = entry.booted.then(() => this.locked(() => {
      if (entry.draining || entry.request.leaseExpiresAt <= this.now()) throw fail('context removed/released while starting')
      entry.status = 'ready'; return entry
    })).catch(error => { entry.status = 'failed'; entry.error = String(error); throw error })
    entry.ready.catch(() => {})
  }
  async remove(key, value) {
    const entry = await this.locked(async () => {
      const saved = await this.check(key, value)
      if (!saved?.deleted) await this.persist(key, { ...fence(value), deleted: true })
      const e = this.get(key)
      if (e) { e.draining = true; e.hooks.cancelStartup?.() }
      return e
    })
    if (!entry) return
    // A tombstone is durable before awaiting startup, stopping admission or disposal.
    for (const disconnect of entry.sockets) disconnect()
    await entry.booted.catch(() => {})
    if (entry.handle) {
      await entry.handle.stopAdmission?.()
      if ((await this.activity(entry)).busy) throw fail('context is busy; draining', 409)
      entry.disposal ??= Promise.resolve().then(() => entry.handle.dispose()).catch(error => { entry.disposal = undefined; throw error })
      await entry.disposal
    }
    await this.release(key, entry.request)
    await this.locked(() => { if (this.get(key) === entry) this.entries.delete(key) })
  }
  async sweep() {
    await Promise.all([...this.entries.values()].map(async entry => {
      if ((entry.draining || entry.request.leaseExpiresAt <= this.now()) && !entry.sweeping) {
        entry.sweeping = true
        try { await this.remove(entry.user, entry.request) }
        catch (error) { this.log(`drain ${entry.user}: ${error.message}`) }
        finally { entry.sweeping = false }
      }
    }))
  }
  handleProcessError(error, origin) {
    const entry = this.scope.getStore()
    if (!entry) { this.log(origin, String(error)); return }
    // Unknown failures cannot establish quiescence. Fence and stop admission.
    entry.draining = true
    void this.remove(entry.user, entry.request).catch(error => this.log(String(error)))
    return entry.user
  }
  async disposeAll() { this.closing = true; await Promise.allSettled([...this.entries.values()].map(e => this.remove(e.user, e.request))) }
}
