import { createServer, type Server } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BeAttachmentStore, { BE_TOKEN_SOURCE } from '../src/index.ts'

/** A stand-in for BE's /fs/operation/v1: one user per token, files kept in memory. */
class FakeBe {
  readonly files = new Map<string, Buffer>()
  readonly requests: Array<{ method: string; path: string; token: string | undefined }> = []
  stored = 0
  validTokens = new Set(['t1'])
  failPuts = false
  server!: Server
  url = ''

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url!, 'http://be')
      const token = req.headers['beyond-token'] as string | undefined
      this.requests.push({ method: req.method!, path: url.pathname, token })
      if (token === undefined || !this.validTokens.has(token)) { res.writeHead(401).end('expired'); return }
      if (url.pathname === '/byaiService/fs/operation/v1/files/put') {
        const form = await new Request('http://be', { method: 'POST', headers: req.headers as HeadersInit, body: req as never, duplex: 'half' } as RequestInit).formData()
        if (this.failPuts) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 500, msg: 'quota exceeded' })); return }
        expect(form.get('spaceType')).toBe('USER')
        this.files.set(String(form.get('path')), Buffer.from(await (form.get('file') as Blob).arrayBuffer()))
        this.stored += 1
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 0, data: {} }))
        return
      }
      if (url.pathname === '/byaiService/fs/operation/v1/files/get') {
        const file = this.files.get(url.searchParams.get('path')!)
        // As BE does: a missing file is 200 with an error envelope.
        if (file === undefined) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ code: -1, msg: 'Platform file download failed', success: false })); return }
        res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(file)
        return
      }
      res.writeHead(404).end()
    })
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    const address = this.server.address() as { port: number }
    this.url = `http://127.0.0.1:${address.port}/byaiService`
  }

  puts(): number { return this.stored }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

async function host(be: FakeBe, token = 't1', tokenSource?: () => Promise<string | undefined>) {
  const dshHome = await mkdtemp(join(tmpdir(), 'attachment-be-'))
  const ctx = new Context()
  if (tokenSource !== undefined) ctx.provide(BE_TOKEN_SOURCE, { current: tokenSource })
  await ctx.plugin(BeAttachmentStore, { dshHome, be: { baseUrl: be.url, token } })
  cleanups.push(() => rm(dshHome, { recursive: true, force: true }))
  return { ctx, dshHome, store: ctx.get('attachments') as BeAttachmentStore }
}

async function fakeBe(): Promise<FakeBe> {
  const be = new FakeBe()
  await be.start()
  cleanups.push(() => new Promise(resolve => be.server.close(() => resolve())))
  return be
}

const png = (r: number) => sharp({ create: { width: 64, height: 48, channels: 3, background: { r, g: 120, b: 40 } } }).png().toBuffer()
const image = async (r = 200) => ({ data: new Uint8Array(await png(r)), mediaType: 'image/png' as const, name: 'shot.png' })

describe('image attachments kept in the user space', () => {
  it('stores the normalized copy in the user space and reads it back on another host', async () => {
    const be = await fakeBe()
    const first = await host(be)
    const ref = await first.store.saveImage(await image())
    const sha = String(ref.attachmentId).slice('sha256:'.length)
    expect([...be.files.keys()]).toEqual([`/by/.dsh/attachments/${sha.slice(0, 2)}/${sha}`])
    const original = await first.store.readImage(ref)

    const second = await host(be)
    const read = await second.store.readImage(ref)
    expect(Buffer.from(read.data)).toEqual(Buffer.from(original.data))
    // The fetched copy now lives on the second host: a later read needs no BE call.
    const gets = be.requests.filter(r => r.path.endsWith('/files/get')).length
    await second.store.readImage(ref)
    expect(be.requests.filter(r => r.path.endsWith('/files/get')).length).toBe(gets)
    // Request variants for the model go through the same read.
    const third = await host(be)
    const variant = await third.store.readImageRequest(ref, { width: 32, height: 24, maxBytes: 2_000_000 })
    expect(variant.data.byteLength).toBeGreaterThan(0)
  })

  it('refuses a copy that was changed in the user space', async () => {
    const be = await fakeBe()
    const ref = await (await host(be)).store.saveImage(await image())
    const [path] = [...be.files.keys()]
    be.files.set(path!, await png(10))
    const other = await host(be)
    await expect(other.store.readImage(ref)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })
    expect(await readdir(join(other.dshHome))).not.toContain('attachments')
  })

  it('reports a missing copy as not found, like the local store', async () => {
    const be = await fakeBe()
    const ref = await (await host(be)).store.saveImage(await image())
    be.files.clear()
    const other = await host(be)
    const warnings: string[] = []
    other.ctx.logger.warn = ((message: string) => { warnings.push(message) }) as never
    await expect(other.store.readImage(ref)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })
    expect(warnings.join('\n')).toMatch(/BE has no copy: Platform file download failed/)
  })

  it('fails the save when BE does not store the copy', async () => {
    const be = await fakeBe()
    be.failPuts = true
    await expect((await host(be)).store.saveImage(await image())).rejects.toThrow(/quota exceeded/)
  })

  it('uploads one image once per process', async () => {
    const be = await fakeBe()
    const { store } = await host(be)
    const input = await image()
    await store.saveImage(input)
    await store.saveImages([input, await image(90)])
    expect(be.puts()).toBe(2)
  })

  it('takes the user current token when BE rejects the one in hand, and uses renewed tokens', async () => {
    const be = await fakeBe()
    be.validTokens = new Set(['fresh'])
    const { store } = await host(be, 'expired', async () => 'fresh')
    await store.saveImage(await image())
    expect(be.puts()).toBe(1)

    be.validTokens = new Set(['renewed'])
    store.renewBeToken('renewed')
    await store.saveImage(await image(30))
    expect(be.puts()).toBe(2)
    expect(be.requests.at(-1)!.token).toBe('renewed')
  })
})
