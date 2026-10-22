import type { GoalControlState } from './goal-control.js'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect, type Socket } from 'node:net'
import { extname, resolve, sep } from 'node:path'
import type { Duplex } from 'node:stream'

const MAX_SESSION_ID_BYTES = 512
const SOCKET_TIMEOUT_MS = 30_000

export interface ViewerTarget {
  readonly host: '127.0.0.1'
  readonly port: number
}

export interface ViewerGatewayOptions {
  /** Prepare a shared desktop only when a user opens the viewer. */
  readonly ensureStarted?: () => Promise<void>
  readonly host: string
  readonly port: number
  readonly novncRoot: string
  readonly targetFor: (sessionId: string) => ViewerTarget | undefined
  readonly defaultSessionId?: () => string | undefined
  readonly sharedGoalViewer?: boolean
  readonly goalState?: () => GoalControlState | undefined
  readonly goalControl?: (runId: string, generation: number, command: 'pause' | 'resume' | 'cancel') => GoalControlState
  readonly socketTimeoutMs?: number
}

export interface ViewerGateway {
  readonly host: string
  readonly port: number
  closeSession(sessionId: string): void
  closeAllSessions(): void
  close(): Promise<void>
}

function sessionIdFrom(url: URL): string | undefined {
  const values = url.searchParams.getAll('sessionId')
  if (values.length !== 1) return undefined
  const value = values[0]!
  if (!value || value.includes('\0') || Buffer.byteLength(value, 'utf8') > MAX_SESSION_ID_BYTES) return undefined
  return value
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}

function reject(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(`${code}\n`)
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return
  socket.end([
    `HTTP/1.1 ${status} ${reason}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(reason)}`,
    '',
    reason,
  ].join('\r\n'))
}

function staticPath(root: string, rawPathname: string): string | undefined {
  let pathname: string
  try {
    pathname = decodeURIComponent(rawPathname)
  } catch {
    return undefined
  }
  if (pathname.includes('\0') || pathname.split('/').includes('..')) return undefined
  const relative = pathname.replace(/^\/+/, '') || 'index.html'
  const candidate = resolve(root, relative)
  const normalizedRoot = resolve(root)
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) return undefined
  return candidate
}

export async function startViewerGateway(options: ViewerGatewayOptions): Promise<ViewerGateway> {
  if (!options.host || !Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535
    || !options.novncRoot) throw new Error('browser-viewer-invalid-config')
  const rootState = await stat(options.novncRoot).catch(() => undefined)
  if (!rootState?.isDirectory()) throw new Error('browser-viewer-root-not-found')
  const timeoutMs = options.socketTimeoutMs ?? SOCKET_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('browser-viewer-invalid-config')
  const sockets = new Set<Socket>()
  const sessionSockets = new Map<string, Set<Duplex>>()
  let stopping = false

  const server = createServer(async (request, response) => {
    if (stopping) return reject(response, 503, 'browser-viewer-stopping')
    let url: URL
    try {
      url = new URL(request.url ?? '/', 'http://viewer.local')
    } catch {
      return reject(response, 400, 'browser-viewer-invalid-url')
    }
    if (url.pathname.endsWith('/goal')) {
      const sessionId = sessionIdFrom(url) ?? options.defaultSessionId?.()
      if (!sessionId || !options.targetFor(sessionId) || !options.goalState) return reject(response, 404, 'browser-goal-unavailable')
      // Shares the existing Sandbox viewer access boundary; no lease capability is exposed.
      const state = options.goalState()
      if (state && state.sessionId !== sessionId && !(options.sharedGoalViewer && sessionId === options.defaultSessionId?.())) return reject(response, 403, 'browser-goal-owner-mismatch')
      let result = state
      if (request.method === 'POST') {
        if (request.headers['x-browser-goal-control'] !== '1' || request.headers['sec-fetch-site'] === 'cross-site') return reject(response, 403, 'browser-goal-control-denied')
        const origin = request.headers.origin
        if (origin) {
          try { if (new URL(origin).host !== request.headers.host) return reject(response, 403, 'browser-goal-control-denied') }
          catch { return reject(response, 403, 'browser-goal-control-denied') }
        }
        try {
          let body = ''
          for await (const chunk of request) { body += String(chunk); if (body.length > 1024) return reject(response, 413, 'browser-goal-control-invalid') }
          const value = JSON.parse(body)
          if (!value || Object.keys(value).some(k => !['runId', 'generation', 'command'].includes(k))
            || typeof value.runId !== 'string' || !Number.isSafeInteger(value.generation)
            || !['pause', 'resume', 'cancel'].includes(value.command) || !options.goalControl) return reject(response, 400, 'browser-goal-control-invalid')
          result = options.goalControl(value.runId, value.generation, value.command)
        } catch { return reject(response, 409, 'browser-goal-control-stale') }
      } else if (request.method !== 'GET') return reject(response, 405, 'browser-goal-method-denied')
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      response.end(JSON.stringify({ goal: result ?? null }))
      return
    }
    const path = staticPath(options.novncRoot, url.pathname)
    if (!path) return reject(response, 400, 'browser-viewer-invalid-path')
    if (url.pathname === '/' || url.pathname.endsWith('/index.html')) {
      if (request.method === 'GET' && options.ensureStarted) {
        try { await options.ensureStarted() }
        catch { return reject(response, 503, 'browser-viewer-start-failed') }
        if (stopping || response.destroyed) return
      }
      if (!url.searchParams.has('sessionId')) {
        const defaultSessionId = options.defaultSessionId?.()
        if (defaultSessionId) {
          url.searchParams.set('sessionId', defaultSessionId)
          // A query-only redirect preserves an outer Sandbox proxy path even
          // when that proxy strips the prefix before forwarding to browserd.
          response.writeHead(302, { location: `?${url.searchParams.toString()}` })
          response.end()
          return
        }
      } else {
        const sessionId = sessionIdFrom(url)
        if (!sessionId) return reject(response, 400, 'browser-viewer-session-invalid')
        if (!options.targetFor(sessionId)) return reject(response, 404, 'browser-viewer-session-not-found')
      }
    }
    if (url.pathname.endsWith('/websockify')) return reject(response, 426, 'browser-viewer-upgrade-required')
    try {
      const bytes = await readFile(path)
      response.writeHead(200, {
        'content-type': contentType(path),
        'content-length': bytes.byteLength,
        'cache-control': path.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      })
      if (request.method === 'HEAD') response.end()
      else response.end(bytes)
    } catch {
      reject(response, 404, 'browser-viewer-asset-not-found')
    }
  })

  server.on('connection', socket => {
    sockets.add(socket)
    socket.setTimeout(timeoutMs, () => socket.destroy())
    socket.on('error', () => undefined)
    socket.once('close', () => sockets.delete(socket))
  })

  server.on('upgrade', async (request: IncomingMessage, client, head) => {
    if (stopping) return rejectUpgrade(client, 503, 'Service Unavailable')
    let url: URL
    try {
      url = new URL(request.url ?? '/', 'http://viewer.local')
    } catch {
      return rejectUpgrade(client, 400, 'Bad Request')
    }
    if (!url.pathname.endsWith('/websockify')) return rejectUpgrade(client, 404, 'Not Found')
    if (options.ensureStarted) {
      try { await options.ensureStarted() }
      catch { return rejectUpgrade(client, 503, 'Service Unavailable') }
      if (stopping || client.destroyed) return
    }
    const explicitSession = url.searchParams.has('sessionId')
    const sessionId = explicitSession ? sessionIdFrom(url) : options.defaultSessionId?.()
    if (!sessionId) return rejectUpgrade(client, explicitSession ? 400 : 404, explicitSession ? 'Bad Request' : 'Not Found')
    const goal = options.goalState?.()
    if (goal && goal.status !== 'paused') return rejectUpgrade(client, 423, 'Browser Automation Active')
    const target = options.targetFor(sessionId)
    if (!target) return rejectUpgrade(client, 404, 'Not Found')
    const active = sessionSockets.get(sessionId) ?? new Set<Duplex>()
    active.add(client)
    sessionSockets.set(sessionId, active)
    client.once('close', () => {
      active.delete(client)
      if (active.size === 0) sessionSockets.delete(sessionId)
    })
    const upstream = connect(target.port, target.host)
    sockets.add(upstream)
    upstream.setTimeout(timeoutMs, () => upstream.destroy())
    upstream.on('error', () => {
      if (!client.destroyed) rejectUpgrade(client, 502, 'Bad Gateway')
    })
    upstream.once('close', () => sockets.delete(upstream))
    upstream.once('connect', () => {
      const requestLine = `${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/${request.httpVersion}\r\n`
      const headers: string[] = []
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        headers.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`)
      }
      upstream.write(`${requestLine}${headers.join('\r\n')}\r\n\r\n`)
      if (head.byteLength > 0) upstream.write(head)
      client.pipe(upstream)
      upstream.pipe(client)
    })
    client.on('error', () => upstream.destroy())
    client.once('close', () => upstream.destroy())
  })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onError = (error: Error) => { server.off('listening', onListening); rejectPromise(error) }
    const onListening = () => { server.off('error', onError); resolvePromise() }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(options.port, options.host)
  })
  const controlTimer = options.goalState ? setInterval(() => {
    const goal = options.goalState!()
    if (goal && goal.status !== 'paused') for (const active of sessionSockets.values()) for (const socket of active) socket.destroy()
  }, 25) : undefined
  controlTimer?.unref()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('browser-viewer-address-unavailable')
  let closing: Promise<void> | undefined
  return {
    host: options.host,
    port: address.port,
    closeAllSessions(): void {
      for (const active of sessionSockets.values()) for (const socket of active) socket.destroy()
      sessionSockets.clear()
    },
    closeSession(sessionId: string): void {
      for (const socket of sessionSockets.get(sessionId) ?? []) socket.destroy()
      sessionSockets.delete(sessionId)
    },
    close(): Promise<void> {
      if (closing) return closing
      stopping = true
      if (controlTimer) clearInterval(controlTimer)
      closing = new Promise<void>(resolvePromise => {
        for (const socket of sockets) socket.destroy()
        if (!server.listening) return resolvePromise()
        server.close(() => resolvePromise())
      })
      return closing
    },
  }
}
