/**
 * Devflow's own browser channel: a Consumer that projects the read side of the
 * [`ctx.devflow`](../../devflow/README.md) seam onto one prefixed JSON route.
 * The board reaches its cards through this plugin instead of any framework
 * forwarding face, which is what lets the devflow plugins compose into a stock
 * harness.
 *
 * The face is session-scoped: a request body names the viewing session and the
 * host resolves that session's workspace to a devflow root, so the wire never
 * carries a path.
 *
 * Reads project the seam's read side. Writes project exactly the decisions a
 * person makes about a card's place on the board — filing finished work,
 * filing one card, dropping one — and nothing else. Stage moves, creation,
 * claims, and artifact registration remain the model tool plane's: the board
 * is a surface people decide on, not a second executor. A deployment that does
 * not compose this plugin keeps the tool and `/devflow` planes and simply has
 * no web board.
 * @module @zhchxiao123/dsh-devflow-web
 */

import { applyAcceptanceReports } from './acceptance-reports.ts'
import { readDetail, readMidsceneSummary } from './midscene-summary.ts'
import type { MidsceneSummary } from './types.ts'
import type { AcceptanceReports } from './types.ts'
import { isAbsolute } from 'node:path'
import { createBuildInfo } from './build-info.ts'
import type { BuildClient } from './types.ts'
export { artifactIdentity } from './build-info.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import WebSocket, { WebSocketServer } from 'ws'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardPage, DevActor, DevCard, DevCardDetail } from '@zhchxiao123/dsh-devflow'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-modules'
import { requestRejection } from './request-auth.ts'
import { assertTrustedAuthority } from './request-trust.ts'
import type {
  DevflowChangeFrame,
  DevflowWebReadMethod,
  DevflowWebRequest,
  DevflowWebResponse,
  DevflowWebWriteMethod,
  DevflowWriteOutcome,
} from './types.ts'

export type * from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'devflow-web'

/** Services required before the route can be claimed. */
export const inject = ['devflow', 'webServer']

/**
 * Route prefix of the read face. It names the domain, not the npm scope, so
 * republishing these plugins under another scope is not a breaking rename.
 */
export const DEVFLOW_API_PREFIX = '/devflow/api'

/** Upgrade path of the push face; named on the same terms as the route prefix. */
export const DEVFLOW_WS_PATH = '/devflow/ws'

/**
 * Largest request body the face accepts. Fixed, not configurable: the largest
 * legitimate body is a session id plus a card id, three orders of magnitude
 * below this, so the only thing a deployment could tune is how much memory an
 * untrusted client may pin per request.
 */
const MAX_BODY_BYTES = 64 * 1024

/**
 * Largest page an untrusted caller may ask the archived read for. Fixed, not
 * configurable: what it bounds is how many card directories one request can
 * make the host walk, which is a property of serving untrusted callers rather
 * than a deployment preference. The store's own default page size is the
 * tunable one.
 */
const MAX_ARCHIVED_LIMIT = 200

/** Longest cursor the face will carry; the store's own are far shorter. */
const MAX_CURSOR_LENGTH = 256

/** Archive bucket names, the one archived-read argument with a known shape. */
const MONTH_BUCKET = /^\d{4}-\d{2}$/

/** Longest abandonment reason the face will carry; a decision, not an essay. */
const MAX_REASON_LENGTH = 2_000

/**
 * Journal identity of a board write. Distinct from the `/devflow` plane's
 * `command` actor on purpose: both are people deciding, and the journal should
 * say which surface the decision was made on.
 */
const BOARD_ACTOR: DevActor = { kind: 'human' }

/** Plugin config: which non-loopback authorities this deployment serves. */
export interface Config {
  acceptanceReports?: AcceptanceReports[]
  /** Operator-selected client artifact; browser acceptance also verifies its served bytes. */
  buildClient?: BuildClient | undefined
  /**
   * Authorities the trust fence admits besides loopback: an exact `host:port`,
   * or a port-less `host` matching any port. Must match what the harness's own
   * `/api` fence is configured with, or the board breaks exactly where the
   * chat does.
   */
  trustedHosts: string[]
}

export const Config: z<Config> = z.object({
  trustedHosts: z.array(String).default([]),
  acceptanceReports: z.array(z.object({ workspace: String, output: String })).default([]),
  buildClient: z.union([z.const(undefined), z.object({ artifact: String, entry: String })]),
})

/** One read method's projection onto the store. */
type ReadMethod = (ctx: Context, request: DevflowWebRequest) => Promise<DevCard[] | DevCardDetail | CardPage | MidsceneSummary>

/** One write method's projection onto the store. */
type WriteMethod = (ctx: Context, request: DevflowWebRequest) => Promise<DevflowWriteOutcome>

/**
 * The dispatch table, and the whole of the face: a method absent here has no
 * route at all. Every entry is a read.
 */
const READS: Readonly<Record<DevflowWebReadMethod, ReadMethod>> = {
  list: (ctx, request) => ctx.devflow.listForSession(undefined, request.sessionId),
  detail: readDetail,
  'midscene-summary': readMidsceneSummary,
  // The set is fixed here rather than taken from the body: opening the seam's
  // full query to an untrusted caller would let it choose which set the host
  // walks, and the board has no need to.
  archived: (ctx, request) => ctx.devflow.queryForSession({
    set: 'archived',
    ...request.month === undefined ? {} : { month: request.month },
    ...request.limit === undefined ? {} : { limit: Math.min(request.limit, MAX_ARCHIVED_LIMIT) },
    ...request.cursor === undefined ? {} : { cursor: request.cursor },
  }, request.sessionId),
}

/**
 * The write table. Kept apart from {@link READS} rather than merged into it:
 * a read's failure is a settled "cannot see it" whose reason stays host-side,
 * while a write's domain rejection is the branch the caller acts on. One table
 * carrying both semantics would have to give up one of them.
 *
 * Every entry resolves its own request: the actor is the host's, never the
 * body's — a browser does not get to say who it is — and the devflow root
 * comes from the session the same way every read's does.
 */
const WRITES: Readonly<Record<DevflowWebWriteMethod, WriteMethod>> = {
  'archive-done': async (ctx, request) => {
    const archived = await ctx.devflow.archiveDoneForSession(request.sessionId)
    return { result: { ok: true }, archived: [...archived] }
  },
  archive: async (ctx, request) => {
    const filed = await ctx.devflow.archiveForSession(
      { ...requireCardTarget(request), by: BOARD_ACTOR },
      request.sessionId,
    )
    return { result: filed.ok ? { ok: true } : { ok: false, code: filed.code, message: filed.message } }
  },
  abandon: async (ctx, request) => {
    if (request.reason === undefined) throw new Error('abandon needs a reason')
    const dropped = await ctx.devflow.abandonForSession(
      { ...requireCardTarget(request), by: BOARD_ACTOR, reason: request.reason },
      request.sessionId,
    )
    return { result: dropped.ok ? { ok: true } : { ok: false, code: dropped.code, message: dropped.message } }
  },
}

/** The card and revision every single-card write names. */
function requireCardTarget(request: DevflowWebRequest): { id: DevflowCardId; expectedRevision: number } {
  if (request.id === undefined) throw new Error('this write needs a card id')
  if (request.expectedRevision === undefined) throw new Error('this write needs the revision it was read at')
  return { id: DevflowCardId(request.id), expectedRevision: request.expectedRevision }
}

/** Whether a last path segment names a projected read. */
function isReadMethod(segment: string): segment is DevflowWebReadMethod {
  return Object.hasOwn(READS, segment)
}

/** Whether a last path segment names a projected write. */
function isWriteMethod(segment: string): segment is DevflowWebWriteMethod {
  return Object.hasOwn(WRITES, segment)
}

/**
 * Decode one request body. This is where JSON validation happens: everything
 * past this function is typed.
 * @param req - the incoming request.
 * @returns the decoded body.
 * @throws {Error} for an oversized, unparsable, or non-object body.
 */
async function readBody(req: IncomingMessage): Promise<DevflowWebRequest> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null) throw new Error('request body is not an object')
  const { sessionId, id } = parsed as Record<string, unknown>
  const { month, limit, cursor } = parsed as Record<string, unknown>
  if (sessionId !== undefined && typeof sessionId !== 'string') throw new Error('sessionId is not a string')
  if (id !== undefined && typeof id !== 'string') throw new Error('id is not a string')
  if (month !== undefined && (typeof month !== 'string' || !MONTH_BUCKET.test(month))) throw new Error('month is not YYYY-MM')
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) {
    throw new Error('limit is not a positive integer')
  }
  // The cursor's shape belongs to the store, so this checks only that it is a
  // string of sane length; the store rejects one it did not issue.
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > MAX_CURSOR_LENGTH)) {
    throw new Error('cursor is not a string of usable length')
  }
  const { expectedRevision, reason } = parsed as Record<string, unknown>
  if (expectedRevision !== undefined && (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0)) {
    throw new Error('expectedRevision is not a non-negative integer')
  }
  // A blank reason is rejected here as well as by the store: this is what the
  // caller sent, so it is described back to them, while the store's own
  // `empty-reason` stays the contract it has always been.
  if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > MAX_REASON_LENGTH)) {
    throw new Error('reason is not a non-blank string of usable length')
  }
  return {
    ...sessionId === undefined ? {} : { sessionId },
    ...id === undefined ? {} : { id },
    ...month === undefined ? {} : { month },
    ...limit === undefined ? {} : { limit },
    ...cursor === undefined ? {} : { cursor },
    ...expectedRevision === undefined ? {} : { expectedRevision },
    ...reason === undefined ? {} : { reason },
  }
}

/** Answer with a JSON envelope. */
function respond(res: ServerResponse, status: number, envelope: DevflowWebResponse<unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/**
 * Refuse one request without reading its body. `connection: close` is what
 * makes the refusal readable: answering a request whose body is still in
 * flight leaves unread bytes on a keep-alive socket, which node resolves by
 * destroying it — the caller would see a hang-up instead of the status.
 * @param res - the response to write.
 * @param status - the refusal status.
 * @param error - the envelope reason, or absent to answer with a bare status.
 */
function refuse(res: ServerResponse, status: number, error?: string): void {
  if (error === undefined) {
    // The trust fence answers bare: an untrusted caller learns the status and
    // nothing about what this route is or expects.
    res.writeHead(status, { connection: 'close' })
    res.end()
    return
  }
  res.writeHead(status, { connection: 'close', 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error } satisfies DevflowWebResponse<never>))
}

/** Refuse one upgrade before protocol negotiation; the caller keeps the socket. */
function refuseUpgrade(socket: Duplex, status: 401 | 403): void {
  socket.end([
    status === 401 ? 'HTTP/1.1 401 Unauthorized' : 'HTTP/1.1 403 Forbidden',
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${status === 401 ? 12 : 9}`,
    '',
    status === 401 ? 'unauthorized' : 'forbidden',
  ].join('\r\n'))
}

/**
 * Claim the push endpoint: one downlink telling connected browsers that
 * something in this host's devflow moved, so they refetch through the read
 * face. Frames go one way — a client message is a protocol violation.
 * @param ctx - plugin context carrying the webserver and the store's events.
 * @param trustedHosts - the fence's configured non-loopback authorities.
 */
function applyPushFace(ctx: Context, trustedHosts: readonly string[]): void {
  const negotiator = new WebSocketServer({ noServer: true })
  const live = new Set<WebSocket>()
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: DEVFLOW_WS_PATH,
    handler: (req, socket, head) => {
      const rejection = requestRejection(ctx, req, trustedHosts)
      if (rejection !== undefined) {
        refuseUpgrade(socket, rejection)
        return
      }
      negotiator.handleUpgrade(req, socket, head, (accepted) => {
        live.add(accepted)
        accepted.once('close', () => live.delete(accepted))
        accepted.once('error', () => { accepted.terminate() })
        accepted.once('message', () => { accepted.close(1008, 'downlink only') })
      })
    },
  }), 'devflow-web: push face')
  const announce = (type: DevflowChangeFrame['type']) => (): void => {
    const frame = JSON.stringify({ type } satisfies DevflowChangeFrame)
    for (const socket of live) {
      socket.send(frame, () => {
        // The callback form is what makes a write to a socket that dropped
        // between this event and here a reported failure instead of a throw;
        // its close handler is on the way and will drop it from `live`, and
        // the browser refetches on its next open regardless.
      })
    }
  }
  ctx.effect(() => ctx.on('devflow/card-created', announce('devflow/card-created')), 'devflow-web: creation frames')
  ctx.effect(() => ctx.on('devflow/stage-changed', announce('devflow/stage-changed')), 'devflow-web: transition frames')
  ctx.effect(() => ctx.on('devflow/card-archived', announce('devflow/card-archived')), 'devflow-web: archiving frames')
  ctx.effect(() => ctx.on('devflow/card-restored', announce('devflow/card-restored')), 'devflow-web: restore frames')
  ctx.effect(() => () => {
    for (const socket of live) socket.terminate()
    live.clear()
    negotiator.close()
  }, 'devflow-web: connected sockets')
}

/**
 * Claim the read route and the push endpoint.
 * @param ctx - plugin context carrying the devflow store and the webserver.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const trustedHosts = config.trustedHosts
  if (config.buildClient && (!isAbsolute(config.buildClient.artifact) || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(config.buildClient.entry))) throw new Error('Invalid build client artifact')
  const buildInfo = createBuildInfo(config.buildClient, import.meta.url, ctx.get.bind(ctx, 'clientModules'))
  // A typo in a trusted authority silently voids or broadens the grant, so it
  // fails the load rather than surfacing later as a board that will not fetch.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  applyPushFace(ctx, trustedHosts)
  applyAcceptanceReports(ctx, config.acceptanceReports ?? [], trustedHosts)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: DEVFLOW_API_PREFIX,
    handler: async (req, res) => {
      const rejection = requestRejection(ctx, req, trustedHosts)
      if (rejection !== undefined) { refuse(res, rejection); return }
      /* v8 ignore next -- node:http always sets url on server requests */
      const segment = new URL(req.url ?? '/', 'http://x').pathname.slice(DEVFLOW_API_PREFIX.length + 1)
      const write = isWriteMethod(segment)
      if (segment !== 'build-info' && !write && !isReadMethod(segment)) {
        refuse(res, 404, `devflow-web: no method named ${JSON.stringify(segment)}`)
        return
      }
      if (req.method !== 'POST') {
        refuse(res, 405, 'devflow-web: every method is POST')
        return
      }
      let request: DevflowWebRequest
      try {
        // A body failure describes what the caller sent, so it travels back.
        request = await readBody(req)
      } catch (error) {
        respond(res, 400, { ok: false, error: `devflow-web: ${reasonOf(error)}` })
        return
      }
      try {
        const value = segment === 'build-info' ? await buildInfo() : write ? await WRITES[segment](ctx, request) : await READS[segment](ctx, request)
        respond(res, 200, { ok: true, value })
      } catch (error) {
        // An unknown session, a missing card, or an unreadable journal is a
        // settled answer the board renders as "no board", not a transport
        // failure. The reason itself stays host-side: the store names files
        // under the devflow root, and the browser must not learn a path it
        // could not have sent in the first place. A write's *domain* rejection
        // never reaches here — it travels inside the outcome, where the board
        // can branch on its code.
        ctx.logger.warn(`devflow-web: ${segment} failed: ${String(error)}`)
        respond(res, 200, { ok: false, error: `devflow-web: ${segment} failed` })
      }
    },
  }), 'devflow-web: read face')
}

/** First line of a thrown value's description; a stack never travels. */
function reasonOf(error: unknown): string {
  return String(error).replace(/\n[\s\S]*/, '')
}
