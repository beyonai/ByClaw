/** Authenticated, session-scoped access to explicitly published acceptance artifacts. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { requestRejection } from './request-auth.ts'
import type { AcceptanceReports } from './types.ts'

export const ACCEPTANCE_REPORT_PREFIX = '/devflow/reports'
const MAX_REPORT_BYTES = 64 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIME: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8', json: 'application/json; charset=utf-8',
  md: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
}
function within(root: string, path: string): boolean {
  const part = relative(root, path)
  return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part)
}
function segments(path: string): string[] {
  const parts = path.split('/')
  if (!parts.length || parts.some(p => !p || p === '.' || p === '..' || /[\\\0]/.test(p))) throw new Error('Invalid artifact path')
  return parts
}
/** Inspect every component and compare the opened inode to the inspected file before reading. */
async function readAsset(root: string, path: string): Promise<Buffer> {
  const parts = segments(path)
  let target = root
  for (const part of parts) {
    target = join(target, part)
    if ((await lstat(target)).isSymbolicLink()) throw new Error('Symbolic artifact')
  }
  const expected = await lstat(target)
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const actual = await file.stat()
    if (!actual.isFile() || actual.size > MAX_REPORT_BYTES || actual.ino !== expected.ino || actual.dev !== expected.dev || !within(root, await realpath(target))) throw new Error('Unreadable artifact')
    return await file.readFile()
  } finally { await file.close() }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid run record')
  return value as Record<string, unknown>
}
/** Only durable records produced by a run nominate files for publication; private working folders stay inaccessible. */
async function permittedAssets(root: string, runId: string, workspace: string): Promise<Set<string>> {
  let manifest: Buffer | undefined
  try { manifest = await readAsset(root, 'manifest.json') } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  if (manifest) {
    const record = object(JSON.parse(manifest.toString('utf8')) as unknown)
    if (record.version !== 1 || record.runId !== runId || object(record.identity).workspace !== workspace || !Array.isArray(record.results)) throw new Error('Run identity mismatch')
    const assets = new Set(['manifest.json', 'report.html', 'test-report.md', 'results.json'])
    for (const item of record.results) {
      const result = object(item)
      for (const value of [result.report, result.screenshot]) {
        if (value === undefined) continue
        if (typeof value !== 'string' || !/^case-\d+\.(html|png)$/.test(value)) throw new Error('Invalid case artifact')
        assets.add(value)
      }
    }
    return assets
  }
  const record = object(JSON.parse((await readAsset(root, 'exploration.json')).toString('utf8')) as unknown)
  if (record.purpose !== 'exploration' || record.runId !== runId || record.workspace !== workspace) throw new Error('Run identity mismatch')
  const assets = new Set(['exploration.json'])
  if (record.artifacts !== undefined) {
    if (!Array.isArray(record.artifacts)) throw new Error('Invalid exploration artifacts')
    for (const path of record.artifacts) {
      if (typeof path !== 'string' || segments(path).some(p => p.startsWith('.') || p === 'tmp' || p === 'private')) throw new Error('Private artifact')
      assets.add(path)
    }
  }
  return assets
}
async function sessionWorkspace(ctx: Context, sessionId: string): Promise<string> {
  const id = sessionId as SessionId
  const live = ctx.get('sessions')?.get(id)
  const header = live?.header ?? (await ctx.get('sessionPersistence')?.stat(id))?.header
  if (!header?.cwd) throw new Error('Unknown session workspace')
  return realpath(header.cwd)
}
function refuse(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end()
}
/** Mount a read-only report face under the host's authentication boundary. */
export function applyAcceptanceReports(ctx: Context, configs: readonly AcceptanceReports[], trustedHosts: readonly string[]): void {
  for (const config of configs) {
    if (!isAbsolute(config.workspace) || !isAbsolute(config.output)) throw new Error('Acceptance reports require absolute directories')
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: ACCEPTANCE_REPORT_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const rejection = requestRejection(ctx, req, trustedHosts)
      if (rejection !== undefined) { refuse(res, rejection); return }
      if (req.method !== 'GET') { refuse(res, 405); return }
      try {
        /* v8 ignore next -- node:http always supplies url on an incoming server request. */
        const url = new URL(req.url ?? '/', 'http://reports.invalid')
        const parts = url.pathname.slice(ACCEPTANCE_REPORT_PREFIX.length + 1).split('/').map(decodeURIComponent)
        const [sessionId, runId, ...assetParts] = parts
        if (!sessionId || sessionId.length > 512 || !runId || !UUID.test(runId) || !assetParts.length) throw new Error('Invalid report target')
        const asset = assetParts.join('/')
        segments(asset)
        const extension = asset.slice(asset.lastIndexOf('.') + 1)
        const mime = Object.hasOwn(MIME, extension) ? MIME[extension] : undefined
        if (!mime) throw new Error('Unsupported artifact type')
        const workspace = await sessionWorkspace(ctx, sessionId)
        const dynamic = await ctx.get('devflowMidsceneReports')?.output(workspace)
        let selected = dynamic
        if (dynamic) {
          try { await lstat(join(dynamic, runId)) } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
            selected = undefined
          }
        }
        if (!selected) {
          const candidates = await Promise.all(configs.map(async config => ({
            workspace: await realpath(config.workspace), output: config.output,
          })))
          selected = candidates.find(config => config.workspace === workspace)?.output
        }
        if (!selected) throw new Error('Unknown report workspace')
        const output = await realpath(selected)
        if (within(workspace, output)) throw new Error('Report output must be external')
        const run = join(output, runId)
        if ((await lstat(run)).isSymbolicLink() || await realpath(run) !== run) throw new Error('Invalid run directory')
        if (!(await permittedAssets(run, runId, workspace)).has(asset)) throw new Error('Artifact is not published')
        const bytes = await readAsset(run, asset)
        res.writeHead(200, {
          'content-type': mime, 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; img-src 'self' data: blob:; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'",
          'referrer-policy': 'no-referrer',
        })
        res.end(bytes)
      } catch { refuse(res, 404) }
    },
  }), 'devflow-web: acceptance reports')
}
