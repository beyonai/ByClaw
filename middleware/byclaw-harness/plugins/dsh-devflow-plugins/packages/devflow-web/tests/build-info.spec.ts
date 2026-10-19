import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { artifactIdentity, createBuildInfo } from '../src/build-info.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
it('binds advertised combo bytes to raw local artifacts and rejects missing, stale or unrelated registry entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devflow-build-')); roots.push(root)
  const server = join(root, 'index.js'), artifact = join(root, 'client.js')
  await writeFile(server, 'server-v1'); await writeFile(artifact, 'client-v1\n//# sourceMappingURL=client.js.map\n//# sourceURL=client.js\n')
  const client = { artifact, entry: '@scope/ui' }, url = pathToFileURL(server).href
  const entry = { id: client.entry, url: '/plugins/??@scope/ui/client.js&rev=actual', rev: 'actual' }
  const body = 'client-v1\n;\n//# sourceMappingURL=/plugins/??@scope/ui/client.js.map&rev=actual\n'
  const graph = vi.fn(() => ({ rev: 'graph', entries: [entry], batches: [] }))
  const clientPath = vi.fn((): string | undefined => artifact)
  const fetchBundle = vi.fn((_request: Request) => new Response(body))
  const registry = () => ({ graph, clientPath, fetchBundle })
  const read = createBuildInfo(client, url, registry)
  expect(await read()).toMatchObject({ available: true, buildId: artifactIdentity(server, client).buildId, client: { path: entry.url } })
  expect(await read()).not.toEqual(await createBuildInfo(client, url, registry)())
  expect(JSON.stringify(await read())).not.toContain(root)
  expect(new URL(fetchBundle.mock.calls[0]?.[0]?.url ?? 'http://invalid').pathname).toBe('/plugins/')
  const unavailable = { schemaVersion: 1, available: false }
  expect(await createBuildInfo(client, url)()).toEqual(unavailable)
  expect(await createBuildInfo(client, url, () => undefined)()).toEqual(unavailable)
  graph.mockReturnValueOnce({ rev: 'none', entries: [], batches: [] })
  expect(await read()).toEqual(unavailable)
  clientPath.mockReturnValueOnce(undefined).mockReturnValueOnce(server)
  expect(await read()).toEqual(unavailable); expect(await read()).toEqual(unavailable)
  for (const path of ['https://other.invalid/plugins/', '/other', '/plugins/#fragment']) {
    graph.mockReturnValueOnce({ rev: 'bad', entries: [{ ...entry, url: path }], batches: [] })
    expect(await read()).toEqual(unavailable)
  }
  fetchBundle.mockReturnValueOnce(new Response('denied', { status: 404 })).mockReturnValueOnce(new Response('other source'))
  expect(await read()).toEqual(unavailable); expect(await read()).toEqual(unavailable)
  fetchBundle.mockImplementationOnce(() => { throw new Error('registry unavailable') })
  expect(await read()).toEqual(unavailable)
  fetchBundle.mockImplementationOnce(() => new Response(new ReadableStream({ async start(controller) { await writeFile(server, 'changed during response'); controller.enqueue(new TextEncoder().encode(body)); controller.close() } })))
  expect(await read()).toEqual(unavailable)
  expect(await read()).toEqual(unavailable)
  const next = createBuildInfo(client, url, registry)
  await rm(artifact)
  expect(await next()).toEqual(unavailable)
  expect(await createBuildInfo(client, url, registry)()).toEqual(unavailable)
  expect(await createBuildInfo(client, url + '.ts', registry)()).toEqual(unavailable)
  expect(await createBuildInfo()()).toEqual(unavailable)
})
it('accepts an unchanged client already ending in a newline without debug trailers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devflow-build-')); roots.push(root)
  const server = join(root, 'index.js'), artifact = join(root, 'client.js')
  await writeFile(server, 'server'); await writeFile(artifact, 'client\n')
  const read = createBuildInfo({ artifact, entry: 'ui' }, pathToFileURL(server).href, () => ({
    graph: () => ({ rev: 'graph', entries: [{ id: 'ui', url: '/plugins/??ui/client.js&rev=one', rev: 'one' }], batches: [] }),
    clientPath: () => artifact, fetchBundle: () => new Response('client\n;\n'),
  }))
  expect(await read()).toMatchObject({ available: true })
})
it('composes optional report configuration through direct plugin application', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: WebServer } = await import('@deepseek-ai/dsh-host-webserver')
  const { apply } = await import('../src/index.ts')
  const ctx = new Context()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  apply(ctx, { trustedHosts: [] })
  await ctx.fiber.dispose()
})
it('matches the published rc.2 registry graph and exact fetchBundle transformation through real Loader composition', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: Loader } = await import('@deepseek-ai/cordis-plugin-loader')
  const { default: Registry } = await import('@deepseek-ai/dsh-client-modules')
  const { mkdir } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'devflow-build-registry-')); roots.push(root)
  const packageRoot = join(root, 'node_modules', 'fixture-ui')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: 'fixture-ui', version: '1.0.0', type: 'module', main: './index.js', exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' }, dsh: { client: { platform: 'web' } } }))
  await writeFile(join(packageRoot, 'index.js'), 'export function apply() {}\n')
  const artifact = join(packageRoot, 'client.js')
  await writeFile(artifact, 'globalThis.fixture = true;\n//# sourceURL=fixture-ui.js\n')
  const server = join(root, 'index.js'); await writeFile(server, 'server')
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root + '/').href
  try {
    await ctx.plugin(Loader)
    ctx.loader.internal = { version: 'v2', import: async () => { const value: unknown = await import(pathToFileURL(join(packageRoot, 'index.js')).href); return value } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'fixture-ui' })
    await ctx.loader.await()
    await ctx.plugin(Registry)
    const entry = ctx.clientModules.graph().entries.find(value => value.id === 'fixture-ui')
    expect(entry?.url).toContain('/plugins/??fixture-ui/client.js&rev=')
    const result = await createBuildInfo({ artifact, entry: 'fixture-ui' }, pathToFileURL(server).href, () => ctx.clientModules)()
    expect(result).toMatchObject({ available: true, client: { path: entry?.url } })
    if (!result.available) throw new Error('Published registry identity unavailable')
    const { createHash } = await import('node:crypto')
    const body = await ctx.clientModules.fetchBundle(new Request(new URL(result.client.path, 'http://fixture.invalid'))).arrayBuffer()
    expect(result.client.sha256).toBe(createHash('sha256').update(Buffer.from(body)).digest('hex'))
  } finally { await ctx.fiber.dispose() }
})
