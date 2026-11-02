import { authenticatedFixture } from './auth-fixture.ts'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { mkdir, mkdtemp, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { applyAcceptanceReports } from '../src/acceptance-reports.ts'
let ctx: Context
let root: string
let workspace: string
let output: string
let run: string
let base: string
let configs: { workspace: string; output: string }[]
const id = '00000000-0000-4000-8000-000000000001'
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'devflow-reports-')))
  workspace = join(root, 'workspace'); output = join(root, 'output'); run = join(output, id)
  await mkdir(workspace); await mkdir(run, { recursive: true })
  await writeFile(join(run, 'manifest.json'), JSON.stringify({ version: 1, runId: id, identity: { workspace }, results: [{ report: 'case-0.html', screenshot: 'case-0.png' }] }))
  await writeFile(join(run, 'case-0.html'), '<html><script>window.test = true</script></html>')
  await writeFile(join(run, 'case-0.png'), 'png')
  ctx = new Context()
  authenticatedFixture(ctx)
  ctx.provide('sessions', { get: (id: string) => id === 'live' ? { header: { cwd: workspace } } : undefined })
  ctx.provide('sessionPersistence', { stat: (id: string) => Promise.resolve(id === 'cold' ? { header: { cwd: workspace } } : undefined) })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  configs = [{ workspace, output }]
  applyAcceptanceReports(ctx, configs, [])
  base = `http://127.0.0.1:${ctx.webServer.port}/devflow/reports`
})
afterEach(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
const url = (asset: string, session = 'live'): string => `${base}/${session}/${id}/${asset}`
it('serves project-scoped reports without global output mappings and retains legacy runs', async () => {
  let resolved = output
  ctx.provide('devflowMidsceneReports', { output: async (cwd: string) => { expect(cwd).toBe(workspace); return resolved } })
  configs.length = 0
  expect((await fetch(url('case-0.html'))).status).toBe(200)
  workspace = root
  expect((await fetch(url('case-0.html'))).status).toBe(404)
  workspace = join(root, 'workspace')
  configs.push({ workspace, output })
  resolved = join(root, 'new-output')
  expect((await fetch(url('case-0.html'))).status).toBe(200)
  configs.length = 0
  expect((await fetch(url('case-0.html'))).status).toBe(404)
  const blocked = join(root, 'file')
  await writeFile(blocked, 'not a directory')
  resolved = blocked
  expect((await fetch(url('case-0.html'))).status).toBe(404)
})
it('serves only registered report bytes for the resolved live or persisted session with HTML isolation', async () => {
  for (const session of ['live', 'cold']) {
    const response = await fetch(url('case-0.html', session))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('window.test')
    expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts;')
    expect(response.headers.get('content-security-policy')).not.toContain('allow-same-origin')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  }
  expect((await fetch(url('case-0.png'))).headers.get('content-type')).toBe('image/png')
  await writeFile(join(run, 'private.txt'), 'secret')
  for (const asset of ['private.txt', 'case-1.html', '%2E%2E%2Fprivate.txt', 'case-0.svg', '%00.html', 'nested//case-0.html', '%5Ccase-0.html', '%E0%A4%A.html']) expect((await fetch(url(asset))).status).toBe(404)
  expect((await fetch(url('case-0.html'), { method: 'POST' })).status).toBe(405)
  expect((await fetch(url('case-0.html'), { headers: { origin: 'https://other.invalid' } })).status).toBe(403)
  expect((await fetch(url('case-0.html', 'unknown'))).status).toBe(404)
  expect((await fetch(`${base}/live/not-a-uuid/case-0.html`)).status).toBe(404)
})
it('refuses cross-workspace run identities, malformed records, symlinks, and oversized artifacts', async () => {
  const manifest = join(run, 'manifest.json')
  const good = { version: 1, runId: id, identity: { workspace }, results: [] }
  for (const value of [null, [], { ...good, version: 2 }, { ...good, runId: 'other' }, { ...good, identity: { workspace: root } }, { ...good, results: 'invalid' }, { ...good, results: [null] }, { ...good, results: [{ report: '../secret.html' }] }]) {
    await writeFile(manifest, JSON.stringify(value))
    expect((await fetch(url('manifest.json'))).status).toBe(404)
  }
  await writeFile(manifest, JSON.stringify(good))
  await writeFile(join(run, 'report.html'), 'report')
  await truncate(join(run, 'report.html'), 64 * 1024 * 1024 + 1)
  expect((await fetch(url('report.html'))).status).toBe(404)
  await rm(join(run, 'report.html'))
  await symlink(join(run, 'manifest.json'), join(run, 'report.html'))
  expect((await fetch(url('report.html'))).status).toBe(404)
  await rm(run, { recursive: true })
  await symlink(workspace, run)
  expect((await fetch(url('manifest.json'))).status).toBe(404)
})
it('publishes exploration assets only from its explicit scrubbed list and never private working files', async () => {
  await rm(join(run, 'manifest.json'))
  const good = { purpose: 'exploration', runId: id, workspace, artifacts: ['case-0.png'] }
  const path = join(run, 'exploration.json')
  await writeFile(path, JSON.stringify(good))
  expect((await fetch(url('case-0.png'))).status).toBe(200)
  await writeFile(path, JSON.stringify({ ...good, artifacts: undefined }))
  expect((await fetch(url('exploration.json'))).status).toBe(200)
  expect((await fetch(url('case-0.png'))).status).toBe(404)
  for (const value of [{ ...good, purpose: 'other' }, { ...good, runId: 'wrong' }, { ...good, workspace: root }, { ...good, artifacts: false }, { ...good, artifacts: [null] }, { ...good, artifacts: ['tmp/state.json'] }, { ...good, artifacts: ['private/state.json'] }, { ...good, artifacts: ['.env'] }]) {
    await writeFile(path, JSON.stringify(value))
    expect((await fetch(url('exploration.json'))).status).toBe(404)
  }
})
it('rejects report configurations with relative directories', () => {
  for (const config of [{ workspace: '.', output }, { workspace, output: '.' }]) expect(() => { applyAcceptanceReports(ctx, [config], []) }).toThrow('absolute directories')
})

it('refuses a linked manifest and permits sparse case metadata without expanding the allowlist', async () => {
  const manifest = join(run, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ version: 1, runId: id, identity: { workspace }, results: [{}] }))
  expect((await fetch(url('manifest.json'))).status).toBe(200)
  await rm(manifest)
  await symlink(join(run, 'case-0.html'), manifest)
  expect((await fetch(url('manifest.json'))).status).toBe(404)
})
it('refuses an unconfigured session workspace and output redirected inside the workspace', async () => {
  const original = workspace
  workspace = root
  expect((await fetch(url('case-0.html'))).status).toBe(404)
  workspace = original
  await rm(output, { recursive: true })
  await symlink(workspace, output)
  expect((await fetch(url('case-0.html'))).status).toBe(404)
})

it('does not treat inherited object names as supported artifact MIME types', async () => {
  await rm(join(run, 'manifest.json'))
  await writeFile(join(run, 'exploration.json'), JSON.stringify({ purpose: 'exploration', workspace, runId: id, artifacts: ['secret.constructor'] }))
  await writeFile(join(run, 'secret.constructor'), 'unpublished executable bytes')
  expect((await fetch(url('secret.constructor'))).status).toBe(404)
})
