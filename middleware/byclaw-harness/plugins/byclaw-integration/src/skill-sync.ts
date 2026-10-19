/** Safe ByClaw Hub Skill download cache, adapted from baiying-enhance. */

import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { privateGenerationRoot } from './generation-paths.ts'
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { ByClawSkillRef } from './types.ts'

/** Cold-start Skill downloads can legitimately approach the old 30s ceiling. */
export const DEFAULT_BYCLAW_SKILL_SYNC_TIMEOUT_MS = 60_000
export const DEFAULT_BYCLAW_SKILL_SYNC_ATTEMPTS = 3
export const DEFAULT_BYCLAW_SKILL_SYNC_RETRY_DELAY_MS = 250

const execFileAsync = promisify(execFile)
const METADATA_FILE = '.byclaw-hub-skill.json'

class ByClawSkillHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
    this.name = 'ByClawSkillHttpError'
  }
}

function retryableSkillRequestError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 6 && current !== undefined; depth += 1) {
    if (current instanceof ByClawSkillHttpError) {
      return current.status === 408 || current.status === 425 || current.status === 429 || current.status >= 500
    }
    if (current instanceof DOMException && (current.name === 'TimeoutError' || current.name === 'AbortError')) return true
    if (current instanceof TypeError) return true
    current = current instanceof Error ? current.cause : undefined
  }
  return false
}

async function retrySkillRequest<T>(options: {
  attempts: number
  retryDelayMs: number
  operation: () => Promise<T>
}): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await options.operation()
    } catch (error: unknown) {
      lastError = error
      if (attempt === options.attempts || !retryableSkillRequestError(error)) throw error
      await delay(options.retryDelayMs * attempt)
    }
  }
  throw lastError
}

export interface ByClawSkillMetadata {
  code: string
  version: string
  downloadUrl: string
  versionUrl: string
}

export interface CachedByClawSkill {
  metadata: ByClawSkillMetadata
  skillFile: string
}

async function ensureOwnerWritableTree(path: string): Promise<void> {
  let stats
  try {
    stats = await lstat(path)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (stats.isSymbolicLink()) return
  if (!stats.isDirectory()) {
    await chmod(path, stats.mode | 0o600)
    return
  }
  await chmod(path, stats.mode | 0o700)
  for (const entry of await readdir(path)) await ensureOwnerWritableTree(join(path, entry))
}

/** Reject absolute and parent-traversing ZIP entries before extraction. */
export function validateByClawSkillZipEntryName(name: string): void {
  const normalized = name.replace(/\\/gu, '/')
  if (normalized === '' || normalized.startsWith('/') || /^[a-zA-Z]:/u.test(normalized)
    || normalized.split('/').some(part => part === '..')) {
    throw new Error(`unsafe ByClaw Skill ZIP entry path: ${name}`)
  }
}

/** Read a complete local cache generation. */
export async function readCachedByClawSkill(targetDir: string): Promise<CachedByClawSkill | undefined> {
  try {
    const metadata = JSON.parse(await readFile(join(targetDir, METADATA_FILE), 'utf8')) as ByClawSkillMetadata
    if (typeof metadata.code !== 'string' || typeof metadata.version !== 'string') return undefined
    const skillFile = join(targetDir, 'SKILL.md')
    await readFile(skillFile, 'utf8')
    return { metadata, skillFile }
  } catch {
    return undefined
  }
}

/** Atomically publish one already-validated extracted Skill directory. */
export async function writeCachedByClawSkill(options: {
  sourceDir: string
  targetDir: string
  metadata: ByClawSkillMetadata
}): Promise<void> {
  await mkdir(dirname(options.targetDir), { recursive: true })
  const suffix = `${process.pid}-${Date.now()}`
  const generations = privateGenerationRoot(options.targetDir)
  await mkdir(generations, { recursive: true, mode: 0o700 })
  const swap = join(generations, `skill.tmp-${suffix}`)
  const backup = join(generations, `skill.bak-${suffix}`)
  await cp(options.sourceDir, swap, { recursive: true, force: true })
  await ensureOwnerWritableTree(swap)
  await writeFile(join(swap, METADATA_FILE), `${JSON.stringify(options.metadata, null, 2)}\n`, { mode: 0o600 })
  let hadExisting = false
  try {
    await rename(options.targetDir, backup)
    hadExisting = true
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    await rename(swap, options.targetDir)
  } catch (error: unknown) {
    if (hadExisting) await rename(backup, options.targetDir).catch(() => undefined)
    await ensureOwnerWritableTree(swap)
    await rm(swap, { recursive: true, force: true })
    throw error
  }
  if (hadExisting) {
    await ensureOwnerWritableTree(backup)
    await rm(backup, { recursive: true, force: true })
  }
}

function absoluteUrl(baseUrl: string, value: string): string {
  const base = baseUrl.replace(/\/+$/u, '')
  if (/^https?:\/\//iu.test(value)) return value
  if (value.startsWith('/')) return new URL(value, new URL(base).origin).toString()
  return new URL(value, `${base}/`).toString()
}

/** Resolve a Skill endpoint and reject origins outside the configured ByClaw service. */
export function byClawSkillUrl(baseUrl: string, value: string): string {
  const url = new URL(absoluteUrl(baseUrl, value))
  const configured = new URL(baseUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`ByClaw Skill URL must use HTTP(S): ${value}`)
  if (url.origin !== configured.origin) throw new Error(`ByClaw Skill URL origin is not configured: ${url.origin}`)
  return url.toString()
}

/** Resolve one untrusted Skill identifier beneath the owned cache root. */
export function byClawSkillCacheDir(cacheRoot: string, code: string): string {
  const windowsStem = code.split('.')[0] ?? ''
  if (code === '' || code === '.' || code === '..'
    || code.includes('/') || code.includes('\\')
    || /[<>:"|?*\u0000-\u001f]/u.test(code)
    || /%2e|%2f|%5c/iu.test(code)
    || /[. ]$/u.test(code)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(windowsStem)) {
    throw new Error(`unsafe ByClaw Skill code: ${code}`)
  }
  const root = resolve(cacheRoot)
  const target = resolve(root, code)
  const contained = relative(root, target)
  if (contained === '' || contained === '..' || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
    throw new Error(`unsafe ByClaw Skill code: ${code}`)
  }
  return target
}

async function responseVersion(response: Response): Promise<{ version: string; downloadUrl?: string }> {
  if (!response.ok) throw new ByClawSkillHttpError(response.status)
  const root = await response.json() as Record<string, unknown>
  const data = root['data'] as Record<string, unknown> | undefined
  const version = typeof data?.['version'] === 'string' || typeof data?.['version'] === 'number'
    ? String(data['version']).trim()
    : ''
  if (version === '') throw new Error('ByClaw Skill version response omitted data.version')
  const downloadUrl = typeof data?.['skillUrl'] === 'string' ? data['skillUrl'].trim() : ''
  return { version, ...downloadUrl === '' ? {} : { downloadUrl } }
}

async function validateZip(path: string): Promise<string[]> {
  const { stdout } = await execFileAsync('unzip', ['-Z', '-1', path], { maxBuffer: 20 * 1024 * 1024 })
  const entries = stdout.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  for (const entry of entries) {
    validateByClawSkillZipEntryName(entry)
  }
  return entries
}

function isBackslashSeparatorWarning(error: unknown): boolean {
  const failure = error as NodeJS.ErrnoException & { code?: number; stderr?: string }
  if (failure.code !== 1 || typeof failure.stderr !== 'string') return false
  const lines = failure.stderr.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  return lines.length > 0 && lines.every(line => /^warning: .* appears to use backslashes as path separators$/u.test(line))
}

async function pathKind(path: string): Promise<'file' | 'directory' | undefined> {
  try {
    return (await lstat(path)).isDirectory() ? 'directory' : 'file'
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function normalizeExtractedBackslashEntries(extractDir: string, entries: readonly string[]): Promise<void> {
  for (const entry of [...entries].filter(value => value.includes('\\')).sort((left, right) => right.length - left.length)) {
    const literalPath = join(extractDir, entry)
    const normalizedPath = join(extractDir, ...entry.replace(/\\/gu, '/').split('/'))
    const literalKind = await pathKind(literalPath)
    if (literalKind === undefined || literalPath === normalizedPath) continue
    const normalizedKind = await pathKind(normalizedPath)
    if (normalizedKind !== undefined) {
      if (literalKind === 'directory' && normalizedKind === 'directory') {
        await rm(literalPath, { recursive: true, force: true })
        continue
      }
      throw new Error(`ByClaw Skill ZIP contains colliding entry paths: ${entry}`)
    }
    await mkdir(dirname(normalizedPath), { recursive: true })
    await rename(literalPath, normalizedPath)
  }
}

async function extractZip(zipPath: string, extractDir: string, entries: readonly string[]): Promise<void> {
  try {
    await execFileAsync('unzip', ['-q', zipPath, '-d', extractDir], { maxBuffer: 20 * 1024 * 1024 })
  } catch (error: unknown) {
    if (!isBackslashSeparatorWarning(error)) throw error
  }
  await normalizeExtractedBackslashEntries(extractDir, entries)
  await ensureOwnerWritableTree(extractDir)
}

/** Synchronize one Hub Skill by remote version and return its local root. */
export async function syncByClawSkill(options: {
  ref: ByClawSkillRef
  baseUrl: string
  headers: Record<string, string>
  cacheRoot: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  attempts?: number
  retryDelayMs?: number
}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_BYCLAW_SKILL_SYNC_TIMEOUT_MS
  const attempts = options.attempts ?? DEFAULT_BYCLAW_SKILL_SYNC_ATTEMPTS
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_BYCLAW_SKILL_SYNC_RETRY_DELAY_MS
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('ByClaw Skill sync attempts must be a positive integer')
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new Error('ByClaw Skill sync retryDelayMs must be a non-negative integer')
  }
  const versionUrl = byClawSkillUrl(options.baseUrl, options.ref.versionUrl)
  let version: { version: string; downloadUrl?: string }
  try {
    version = await retrySkillRequest({ attempts, retryDelayMs, operation: async () => (
      responseVersion(await fetchImpl(versionUrl, {
        headers: options.headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      }))
    ) })
  } catch (error: unknown) {
    throw new Error(`ByClaw Skill ${options.ref.code} version request failed: ${String(error)}`, { cause: error })
  }
  const downloadUrl = byClawSkillUrl(options.baseUrl, version.downloadUrl ?? options.ref.downloadUrl)
  const targetDir = byClawSkillCacheDir(options.cacheRoot, options.ref.code)
  const cached = await readCachedByClawSkill(targetDir)
  // Hub download URLs may be short-lived signed URLs. The version is the
  // immutable content identity; a refreshed signature must not force every
  // DSH cold start to download the same Skill archive again.
  if (cached?.metadata.code === options.ref.code && cached.metadata.version === version.version) return targetDir

  const scratch = await mkdtemp(join(tmpdir(), 'dsh-byclaw-skill-'))
  try {
    const zipPath = join(scratch, 'skill.zip')
    const extractDir = join(scratch, 'extract')
    await mkdir(extractDir, { recursive: true })
    try {
      await retrySkillRequest({ attempts, retryDelayMs, operation: async () => {
        const response = await fetchImpl(downloadUrl, {
          headers: options.headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) throw new ByClawSkillHttpError(response.status)
        if (response.body === null) throw new Error('ByClaw Skill download response omitted its body')
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(zipPath))
      } })
    } catch (error: unknown) {
      throw new Error(`ByClaw Skill ${options.ref.code} download failed: ${String(error)}`, { cause: error })
    }
    const entries = await validateZip(zipPath)
    await extractZip(zipPath, extractDir, entries)
    let sourceDir = extractDir
    try {
      await readFile(join(sourceDir, 'SKILL.md'), 'utf8')
    } catch {
      const entries = (await import('node:fs/promises')).readdir(extractDir, { withFileTypes: true })
      const candidates = (await entries).filter(entry => entry.isDirectory() && entry.name !== '__MACOSX')
      const roots: string[] = []
      for (const candidate of candidates) {
        const path = join(extractDir, candidate.name)
        try { await readFile(join(path, 'SKILL.md'), 'utf8'); roots.push(path) } catch { /* not a Skill root */ }
      }
      if (roots.length !== 1) throw new Error('ByClaw Skill ZIP must contain exactly one SKILL.md root')
      sourceDir = roots[0] as string
    }
    await writeCachedByClawSkill({
      sourceDir,
      targetDir,
      metadata: { code: options.ref.code, version: version.version, downloadUrl, versionUrl },
    })
    return targetDir
  } finally {
    await ensureOwnerWritableTree(scratch)
    await rm(scratch, { recursive: true, force: true })
  }
}
