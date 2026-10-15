/** Real published Connection/BrowserAuth signs the cookie; custom WebServer routes must check it explicitly. */
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
let context: Context | undefined
let directory: string | undefined
afterEach(async () => { await context?.fiber.dispose(); if (directory) await rm(directory, { recursive: true, force: true }) })
function http(port: number, path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { ...headers, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) } }, (res) => {
      res.resume(); res.on('end', () => { resolve(res.statusCode ?? 0) })
    })
    req.on('error', reject); req.end(method === 'POST' ? JSON.stringify({ sessionId: 'owner', id: '0001' }) : undefined)
  })
}
function socketStatus(port: number, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/devflow/ws`, { headers })
    socket.once('open', () => { socket.close(); resolve(101) })
    socket.once('unexpected-response', (_req, res) => { res.resume(); socket.terminate(); resolve(res.statusCode ?? 0) })
    socket.once('error', (error) => { if (!error.message.includes('before the connection was established')) reject(error) })
  })
}
it('protects reports, build information, summary, existing API and push using real signed browser cookies', async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'devflow-auth-')))
  const workspace = join(directory, 'workspace'), output = join(directory, 'reports')
  const runId = '00000000-0000-4000-8000-000000000001', run = join(output, runId)
  await mkdir(workspace); await mkdir(run, { recursive: true })
  await writeFile(join(run, 'manifest.json'), JSON.stringify({ version: 1, runId, identity: { workspace }, results: [] }))
  await writeFile(join(run, 'test-report.md'), 'private acceptance report')
  const ctx = new Context(); context = ctx
  let record: Awaited<ReturnType<Context['credentials']['readRecord']>>
  const credentials: Pick<Context['credentials'], 'modifyRecord'> = {
    modifyRecord: async (_key, mutate) => { record = await mutate(record) ?? record; return record },
  }
  ctx.provide('credentials', credentials as Context['credentials'])
  const detail = vi.fn().mockResolvedValue({ id: '0001' })
  ctx.provide('devflow', { detailForSession: detail } as unknown as Context['devflow'])
  ctx.provide('sessions', { get: () => ({ header: { cwd: workspace } }) } as unknown as Context['sessions'])
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const connection = await ctx.plugin(Connection, { trustedHosts: [] })
  apply(ctx, { trustedHosts: [], acceptanceReports: [{ workspace, output }] })
  const port = ctx.webServer.port
  const base = `http://127.0.0.1:${port}`
  let cookie = ''
  expect(ctx.connection.authorizeIndex({ method: 'GET', url: ctx.connection.authenticatedUrl(base), headers: { host: `127.0.0.1:${port}` } }, {
    writeHead: (status, headers) => { expect(status).toBe(303); cookie = headers?.['set-cookie']?.split(';')[0] ?? '' }, end: () => {},
  })).toBe(false)
  expect(cookie).not.toBe('')
  const routes = [
    [`/devflow/reports/owner/${runId}/test-report.md`, 'GET'],
    ['/devflow/api/build-info', 'POST'], ['/devflow/api/midscene-summary', 'POST'], ['/devflow/api/detail', 'POST'],
  ] as const
  for (const [path, method] of routes) {
    expect(await http(port, path, {}, method)).toBe(401)
    expect(await http(port, path, { cookie: 'invalid=cookie' }, method)).toBe(401)
    expect(await http(port, path, { cookie }, method)).toBe(200)
    expect(await http(port, path, { cookie, host: 'attacker.invalid' }, method)).toBe(403)
    expect(await http(port, path, { cookie, origin: 'https://attacker.invalid' }, method)).toBe(403)
  }
  expect(detail).toHaveBeenCalledTimes(2)
  expect(await socketStatus(port)).toBe(401)
  expect(await socketStatus(port, { cookie })).toBe(101)
  expect(await socketStatus(port, { cookie, host: 'attacker.invalid' })).toBe(403)
  // Existing routes stay closed when Connection unloads, even with a previously valid cookie.
  await connection.dispose()
  expect(await http(port, routes[0][0], { cookie })).toBe(401)
  expect(await http(port, '/devflow/api/build-info', { cookie }, 'POST')).toBe(401)
  expect(await socketStatus(port, { cookie })).toBe(401)
})
it('fails closed when the Connection provider throws, and preserves its independent host policy', async () => {
  const ctx = new Context(); context = ctx
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const rejection = vi.fn((): 403 | undefined => { throw new Error('auth owner unavailable') })
  ctx.provide('connection', { requestRejection: rejection } as unknown as Context['connection'])
  apply(ctx, { trustedHosts: [] })
  expect(await http(ctx.webServer.port, '/devflow/api/build-info', {}, 'POST')).toBe(401)
  rejection.mockReturnValue(403)
  expect(await http(ctx.webServer.port, '/devflow/api/build-info', {}, 'POST')).toBe(403)
})
