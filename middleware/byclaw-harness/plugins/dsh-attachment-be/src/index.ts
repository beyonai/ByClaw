/**
 * Image attachments that outlive the host. DSH's local attachment store keeps each image's
 * normalized copy under `<dsh-home>/attachments/v1`, and every later turn reads it back from
 * there to send the history to the model. This store keeps that behaviour and also writes the
 * copy into the user's own space through BE (`/fs/operation/v1`), under
 * `/by/.dsh/attachments/<sha256>`; a host that lacks the local copy fetches it from BE. Objects
 * are content-addressed and immutable, so writes need no coordination and the local store's
 * digest check rejects a copy that was changed in the user's space.
 * @module @byclaw/dsh-attachment-be
 */
import { createHash, randomBytes } from 'node:crypto'
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore, { type Config as LocalConfig } from '@deepseek-ai/dsh-attachment-local'

/** Where the copies live and how BE is reached. */
export interface BeConfig {
  /** BE origin including its path prefix, e.g. `http://be:8086/byaiService`. */
  baseUrl: string
  /** The user's Beyond-Token; BE picks the user's space from it. Renewed by the host. */
  token: string
  /** Optional `system-code` header; empty sends none. */
  systemCode: string
  /** Directory in the user's space. */
  root: string
  /** Deadline for one BE request. */
  requestTimeoutMs: number
}

export interface Config extends LocalConfig {
  be: BeConfig
}

/** Service a host may provide with the user's current Beyond-Token, consulted when BE rejects the one in hand. */
export const BE_TOKEN_SOURCE = 'byclawBeTokenSource'

interface TokenSource { current(): Promise<string | undefined> }

class TokenRejectedError extends Error {}

const sha256Of = (ref: ImageAttachmentRef): string => String(ref.attachmentId).replace(/^sha256:/, '')
const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

export class BeAttachmentStore extends LocalAttachmentStore {
  // Typed as the base schema: a static member cannot narrow it, and cordis validates with the runtime value.
  static override Config: typeof LocalAttachmentStore.Config = z.intersect([
    LocalAttachmentStore.Config,
    z.object({
      be: z.object({
        baseUrl: z.string().required(),
        token: z.string().required(),
        systemCode: z.string().default(''),
        root: z.string().default('/by/.dsh/attachments'),
        requestTimeoutMs: z.natural().min(1).default(30_000),
      }),
    }),
  ]) as unknown as typeof LocalAttachmentStore.Config

  private token: string
  /** Objects this process already knows BE holds; a repeated save of the same image uploads once. */
  private readonly uploaded = new Set<string>()
  /** One fetch per object at a time. */
  private readonly fetching = new Map<string, Promise<void>>()

  constructor(ctx: Context, readonly beConfig: Config) {
    super(ctx, beConfig)
    this.token = beConfig.be.token
  }

  /** The host hands over the token of each later PUT BE sends for the user. */
  renewBeToken(token: string): void {
    if (token.trim() !== '') this.token = token.trim()
  }

  override async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    const ref = await super.saveImage(input)
    await this.upload(ref)
    return ref
  }

  override async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    const refs = await super.saveImages(inputs)
    for (const ref of refs) await this.upload(ref)
    return refs
  }

  override async readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    try {
      return await super.readImage(ref, signal)
    } catch (error) {
      if (!(this.isAttachmentError(error) && error.code === 'ATTACHMENT_NOT_FOUND')) throw error
      // Saved on another host, or this host's disk was replaced: bring the copy back, then read it as usual.
      if (!await this.fetch(ref, signal)) throw error
      return super.readImage(ref, signal)
    }
  }

  /** BE path of one object. */
  objectPath(ref: ImageAttachmentRef): string {
    const sha = sha256Of(ref)
    return `${this.beConfig.be.root.replace(/\/+$/, '')}/${sha.slice(0, 2)}/${sha}`
  }

  /** Write the local copy to BE. A failure fails the save: a reference BE does not hold would break on another host. */
  private async upload(ref: ImageAttachmentRef): Promise<void> {
    const sha = sha256Of(ref)
    if (this.uploaded.has(sha)) return
    const data = await readFile(this.imageHostPath(ref))
    await this.withToken(async (token) => {
      const form = new FormData()
      form.append('spaceType', 'USER')
      form.append('path', this.objectPath(ref))
      form.append('contentType', ref.mediaType)
      form.append('file', new Blob([data], { type: ref.mediaType }), sha)
      const response = await this.request('/fs/operation/v1/files/put', { method: 'POST', body: form }, token)
      const text = await response.text()
      let envelope: { code?: unknown; msg?: unknown } = {}
      try { envelope = JSON.parse(text) as typeof envelope } catch { /* reported below */ }
      if (!response.ok || envelope.code !== 0) {
        throw new Error(`storing image attachment ${sha.slice(0, 12)} in the user's space failed: HTTP ${response.status} ${String(envelope.msg ?? text.slice(0, 200))}`)
      }
    })
    this.uploaded.add(sha)
  }

  /** Fetch one object into the local store. False when BE has no usable copy. */
  private fetch(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<boolean> {
    const sha = sha256Of(ref)
    let pending = this.fetching.get(sha)
    if (pending === undefined) {
      pending = this.fetchOnce(ref).finally(() => this.fetching.delete(sha))
      this.fetching.set(sha, pending)
    }
    const fetched = pending.then(() => true, (error: unknown) => {
      this.ctx.logger.warn(`image attachment ${sha.slice(0, 12)} is not on this host and could not be fetched from the user's space: ${(error as Error).message}`)
      return false
    })
    return signal === undefined ? fetched : Promise.race([fetched, new Promise<never>((_, reject) => {
      signal.throwIfAborted()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })])
  }

  private async fetchOnce(ref: ImageAttachmentRef): Promise<void> {
    const sha = sha256Of(ref)
    const data = await this.withToken(async (token) => {
      const query = new URLSearchParams({ spaceType: 'USER', path: this.objectPath(ref) })
      const response = await this.request(`/fs/operation/v1/files/get?${query}`, { method: 'GET' }, token)
      if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 200)}`)
      // BE answers a missing file with 200 and a JSON envelope (`code: -1`) instead of the bytes.
      if ((response.headers.get('content-type') ?? '').includes('application/json')) {
        const text = await response.text()
        let reason = text.slice(0, 200)
        try { reason = String((JSON.parse(text) as { msg?: unknown }).msg ?? reason) } catch { /* keep the raw text */ }
        throw new Error(`BE has no copy: ${reason}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    })
    // Never let a changed copy into the local store; the local read would refuse it anyway.
    if (digest(data) !== sha) throw new Error('the copy in the user\'s space does not match its digest')
    const target = this.imageHostPath(ref)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    const staged = `${target}.${randomBytes(6).toString('hex')}.fetch`
    await writeFile(staged, data, { mode: 0o444, flag: 'wx' })
    try {
      // Hard link publishes atomically and never replaces a copy another fetch or save already put there.
      await link(staged, target).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
    } finally {
      await rm(staged, { force: true })
    }
    this.uploaded.add(sha)
  }

  private async withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
    try {
      return await call(this.token)
    } catch (error) {
      if (!(error instanceof TokenRejectedError)) throw error
      const source = this.ctx.get(BE_TOKEN_SOURCE) as TokenSource | undefined
      const fresh = (await source?.current().catch(() => undefined))?.trim()
      if (fresh === undefined || fresh === '' || fresh === this.token) throw error
      this.token = fresh
      return call(fresh)
    }
  }

  private async request(path: string, init: RequestInit, token: string): Promise<Response> {
    const headers: Record<string, string> = { 'beyond-token': token }
    if (this.beConfig.be.systemCode !== '') headers['system-code'] = this.beConfig.be.systemCode
    const response = await fetch(`${this.beConfig.be.baseUrl.replace(/\/+$/, '')}${path}`, {
      ...init, headers, signal: AbortSignal.timeout(this.beConfig.be.requestTimeoutMs),
    })
    if (response.status === 401) {
      await response.body?.cancel()
      throw new TokenRejectedError(`BE rejected the Beyond-Token for ${path.split('?')[0]}`)
    }
    return response
  }
}

export default BeAttachmentStore
