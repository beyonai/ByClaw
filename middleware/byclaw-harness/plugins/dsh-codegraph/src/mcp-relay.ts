/**
 * One MCP session from the client, served by CodeGraph servers on the tool
 * environment that come and go.
 *
 * A server process holds the tool environment's streams open, and an open
 * stream keeps the tool environment from pausing; before the split CodeGraph
 * cost nothing while unused. So the relay starts a server only for a request,
 * ends it after `idleMs` without one, and starts the next on demand, replaying
 * the client's `initialize` handshake to it. The server's answers to the
 * handshake (`server/discover`, `initialize`, `tools/list`) are cached (also on
 * disk, per server command),
 * so registering the tool at context start needs no server at all once any
 * context has started one.
 */
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import type { Socket } from 'node:net'
import { StringDecoder } from 'node:string_decoder'

type Message = Record<string, unknown> & { id?: unknown; method?: unknown }

/** A server process on the tool environment: newline-delimited JSON-RPC on stdin/stdout. */
export interface RelayServer {
  stdin: NodeJS.WritableStream
  stdout: NodeJS.ReadableStream
  done: Promise<unknown>
  terminate(): void
}

/** Requests of the MCP handshake whose answers do not change while the server command stays the same. */
const HANDSHAKE = new Set(['server/discover', 'initialize', 'tools/list'])

/** An answer without its id: `{ result }` or `{ error }`. */
type Answer = { result: unknown } | { error: unknown }

/** JSON-RPC "method not found": the one error that stays true for this server command. */
const METHOD_NOT_FOUND = -32601

/** What of a server's answer is worth keeping: a result, or that it does not know the method; not a passing failure. */
function lasting(message: Message): Answer | undefined {
  if ('result' in message) return { result: message.result }
  const error = message.error as { code?: unknown } | undefined
  return error?.code === METHOD_NOT_FOUND ? { error } : undefined
}

/** What the relay remembers of the server's handshake, keyed by the server command. */
export class HandshakeCache {
  private answers: { key: string; methods: Record<string, Answer> } | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly path: string, private readonly key: string) {}

  async load(): Promise<void> {
    try {
      const stored = JSON.parse(await readFile(this.path, 'utf8')) as HandshakeCache['answers']
      if (stored?.key === this.key && typeof stored.methods === 'object') this.answers = stored
    } catch {
      // Absent or unreadable: the first server answers instead.
    }
  }

  get(method: string): Answer | undefined {
    return this.answers?.methods[method]
  }

  async set(method: string, answer: Answer): Promise<void> {
    this.answers = { key: this.key, methods: { ...this.answers?.methods, [method]: answer } }
    const answers = JSON.stringify(this.answers)
    // One write at a time, so an older snapshot never lands after a newer one.
    this.writing = this.writing.catch(() => {}).then(async () => {
      // A reader (another context starting) sees the old file or the new one, never a partial write.
      const temporary = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temporary, answers, { mode: 0o600 })
      await rename(temporary, this.path)
    })
    return this.writing
  }
}

/** The request id of a replayed `initialize`; never one the client uses (its ids are numbers). */
const REPLAY_ID = 'dsh-codegraph-relay-initialize'
/** The request id of a `tools/list` the relay sends to refresh its cache. */
const REFRESH_ID = 'dsh-codegraph-relay-tools'

export class McpRelay {
  private server: RelayServer | undefined
  /** Messages for a server whose replayed handshake has not completed yet. */
  private queue: Message[] | undefined
  private initialize: Message | undefined
  private initialized: Message | undefined
  /** Client requests the current server owes an answer, by id, with their method. */
  private readonly pending = new Map<unknown, string>()
  private idleTimer: NodeJS.Timeout | undefined
  private closed = false

  constructor(
    private readonly client: Socket,
    private readonly spawn: () => RelayServer,
    private readonly cache: HandshakeCache,
    private readonly idleMs: number,
    private readonly log: (message: string) => void,
  ) {
    client.once('close', () => { this.close() })
    client.on('data', lines(message => { this.fromClient(message) }, () => { client.destroy() }))
  }

  /** Bytes the client sent before the relay took over (after the bridge handshake). */
  feed(bytes: Buffer): void {
    if (bytes.length > 0) this.client.emit('data', bytes)
  }

  private fromClient(message: Message): void {
    const request = message.id !== undefined && typeof message.method === 'string'
    if (request && message.method === 'initialize') this.initialize = message
    if (request && HANDSHAKE.has(message.method as string)) {
      const known = this.cache.get(message.method as string)
      if (known !== undefined) { this.answer(message.id, known); return }
    } else if (message.method === 'notifications/initialized') {
      this.initialized = message
      if (this.server === undefined) return
    } else if (!request) {
      // A cancelled request is no longer owed, so it does not keep the server from idling out.
      if (message.method === 'notifications/cancelled') this.pending.delete((message.params as { requestId?: unknown } | undefined)?.requestId)
      // A notification for a server that is gone has no one to tell.
      if (this.server === undefined) return
      this.send(message)
      this.idle()
      return
    }
    if (request) this.pending.set(message.id, message.method as string)
    this.send(message)
  }

  private answer(id: unknown, answer: Answer): void {
    this.client.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...answer })}\n`)
  }

  private send(message: Message): void {
    clearTimeout(this.idleTimer)
    if (this.server === undefined) this.start(message)
    if (this.queue !== undefined) this.queue.push(message)
    else this.server!.stdin.write(`${JSON.stringify(message)}\n`)
  }

  /** Start a server; one that has to be handshaken first queues messages until it is. */
  private start(first: Message): void {
    const server = this.spawn()
    this.server = server
    server.stdout.on('data', lines(message => { this.fromServer(server, message) }, () => { server.terminate() }))
    void server.done.then(() => { this.ended(server) }, () => { this.ended(server) })
    // The client's own initialize goes to this server as is; anything else needs the handshake replayed.
    if (first === this.initialize || this.initialize === undefined) return
    this.queue = []
    server.stdin.write(`${JSON.stringify({ ...this.initialize, id: REPLAY_ID })}\n`)
  }

  private fromServer(server: RelayServer, message: Message): void {
    if (server !== this.server) return
    if (message.id === REPLAY_ID) {
      const queued = this.queue ?? []
      this.queue = undefined
      if (this.initialized !== undefined) server.stdin.write(`${JSON.stringify(this.initialized)}\n`)
      // A server that introduces itself differently (a newer CodeGraph) refreshes what later sessions are told.
      if ('result' in message && JSON.stringify(this.cache.get('initialize')) !== JSON.stringify({ result: message.result })) {
        this.remember('initialize', { result: message.result })
        server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: REFRESH_ID, method: 'tools/list' })}\n`)
      }
      for (const next of queued) server.stdin.write(`${JSON.stringify(next)}\n`)
      return
    }
    if (message.id === REFRESH_ID) {
      if ('result' in message) this.remember('tools/list', { result: message.result })
      return
    }
    const method = message.id === undefined ? undefined : this.pending.get(message.id)
    if (method !== undefined) {
      this.pending.delete(message.id)
      const answer = HANDSHAKE.has(method) ? lasting(message) : undefined
      if (answer !== undefined) this.remember(method, answer)
    }
    this.client.write(`${JSON.stringify(message)}\n`)
    this.idle()
  }

  private remember(method: string, answer: Answer): void {
    void this.cache.set(method, answer).catch((error: unknown) => { this.log(`codegraph handshake cache not written: ${String(error)}`) })
  }

  /** With nothing owed, end the server after `idleMs`; the next request starts another. */
  private idle(): void {
    clearTimeout(this.idleTimer)
    if (this.pending.size > 0 || this.idleMs <= 0) return
    this.idleTimer = setTimeout(() => {
      const server = this.server
      if (server === undefined || this.pending.size > 0) return
      this.server = undefined
      this.queue = undefined
      server.terminate()
    }, this.idleMs)
    this.idleTimer.unref()
  }

  private ended(server: RelayServer): void {
    if (server !== this.server) return
    this.server = undefined
    this.queue = undefined
    // Requests the server took with it cannot be answered; the client's reconnect policy takes over.
    if (this.pending.size > 0) this.client.destroy()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.idleTimer)
    this.server?.terminate()
    this.server = undefined
  }
}

/** Newline-delimited JSON messages from a byte stream; `invalid` on a line that is not a JSON object. */
function lines(deliver: (message: Message) => void, invalid: () => void): (chunk: Buffer) => void {
  // A character split across two chunks is decoded once both have arrived.
  const decoder = new StringDecoder('utf8')
  let buffer = ''
  return chunk => {
    buffer += decoder.write(chunk)
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line === '') continue
      let message: unknown
      try { message = JSON.parse(line) } catch { invalid(); return }
      if (typeof message !== 'object' || message === null || Array.isArray(message)) { invalid(); return }
      deliver(message as Message)
    }
  }
}
