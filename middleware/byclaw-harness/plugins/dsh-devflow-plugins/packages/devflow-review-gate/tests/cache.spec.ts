// The verdict cache. What matters is not that it is fast but that it is never
// an authority: every field of the key that determined what the checkers saw
// must break a hit, a damaged record must read as a miss, and a cache that
// cannot be written must leave a working gate behind.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { cacheKey, readCachedVerdict, writeCachedVerdict } from '@zhchxiao123/dsh-devflow-review-gate/src/cache.ts'
import type { VerdictCacheKey } from '@zhchxiao123/dsh-devflow-review-gate/src/cache.ts'
import type { DelegatePreview, RuleGroup } from '@zhchxiao123/dsh-devflow-review-gate/src/types.ts'

let dir: string
const warnings: string[] = []
const ctx = { logger: { warn: (line: string) => { warnings.push(line) } } } as unknown as Context

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-devflow-ocr-cache-'))
  warnings.length = 0
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const PREVIEW: DelegatePreview = {
  mode: 'range',
  repository: '/work',
  mergeBase: 'a'.repeat(40),
  reviewable: [
    { path: 'b.ts', status: 'modified', insertions: 2, deletions: 1 },
    { path: 'a.ts', status: 'added', insertions: 5, deletions: 0 },
  ],
  excluded: [],
}

const GROUPS: RuleGroup[] = [{ pattern: '**/*.ts', source: 'system', rule: 'TS RULE', files: ['a.ts', 'b.ts'] }]

const PARTS = {
  edge: 'developing->reviewing',
  root: '/work/.devflow',
  card: '0001-a',
  preview: PREVIEW,
  groups: GROUPS,
  vetoAtOrAbove: 'high',
  ocrVersion: '1.12.0',
}

const COVERAGE = { totalFiles: 2, reviewedFiles: 2, skippedFiles: 0, coverageRate: 100, skipped: [] }

function record(key: VerdictCacheKey): Parameters<typeof writeCachedVerdict>[2] {
  return { key, verdict: 'allow', coverage: COVERAGE, comments: [] }
}

describe('the key', () => {
  it('sorts the file list so preview order cannot change it', () => {
    const reversed = { ...PREVIEW, reviewable: [...PREVIEW.reviewable].reverse() }
    expect(cacheKey(PARTS)).toEqual(cacheKey({ ...PARTS, preview: reversed }))
  })

  it('carries the line counts, so an edit the CLI reports differently is a new key', () => {
    const edited = {
      ...PREVIEW,
      reviewable: [PREVIEW.reviewable[0], { ...PREVIEW.reviewable[1], insertions: 6 }],
    }
    expect(cacheKey({ ...PARTS, preview: edited })).not.toEqual(cacheKey(PARTS))
  })

  it('omits the merge base in workspace mode rather than inventing one', () => {
    const key = cacheKey({ ...PARTS, preview: { ...PREVIEW, mode: 'workspace', mergeBase: undefined } })
    expect(key.mergeBase).toBeUndefined()
    expect(key.mode).toBe('workspace')
  })
})

describe('what breaks a hit', () => {
  it.each([
    ['a different edge', { edge: 'reviewing->testing' }],
    ['a different card', { card: '0002-b' }],
    ['a different devflow root', { root: '/elsewhere/.devflow' }],
    ['a different threshold', { vetoAtOrAbove: 'critical' }],
    ['a different CLI version', { ocrVersion: '1.13.0' }],
  ])('%s', async (_label, change) => {
    const key = cacheKey(PARTS)
    await writeCachedVerdict(ctx, dir, record(key))
    await expect(readCachedVerdict(ctx, dir, cacheKey({ ...PARTS, ...change }))).resolves.toBeUndefined()
  })

  it('a rule whose body changed, the same files being judged by a new standard', async () => {
    await writeCachedVerdict(ctx, dir, record(cacheKey(PARTS)))
    const edited: RuleGroup[] = [{ ...GROUPS[0], rule: 'TS RULE, revised' }]
    await expect(readCachedVerdict(ctx, dir, cacheKey({ ...PARTS, groups: edited }))).resolves.toBeUndefined()
  })

  it('a changed file list', async () => {
    await writeCachedVerdict(ctx, dir, record(cacheKey(PARTS)))
    const grown = { ...PREVIEW, reviewable: [...PREVIEW.reviewable, { path: 'c.ts', status: 'added', insertions: 1, deletions: 0 }] }
    await expect(readCachedVerdict(ctx, dir, cacheKey({ ...PARTS, preview: grown }))).resolves.toBeUndefined()
  })
})

describe('a hit', () => {
  it('returns the decision the identical attempt earned', async () => {
    const key = cacheKey(PARTS)
    await writeCachedVerdict(ctx, dir, {
      key,
      verdict: 'veto',
      coverage: COVERAGE,
      comments: [{ path: 'a.ts', content: 'leak', severity: 'critical' }],
    })
    const hit = await readCachedVerdict(ctx, dir, cacheKey(PARTS))
    expect(hit).toMatchObject({ verdict: 'veto' })
    expect(hit!.comments[0]).toMatchObject({ path: 'a.ts', severity: 'critical' })
  })

  it('writes atomically, leaving no temporary file behind', async () => {
    await writeCachedVerdict(ctx, dir, record(cacheKey(PARTS)))
    const files = await readdir(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^[0-9a-f]{16}\.json$/)
  })
})

describe('the cache is never an authority', () => {
  async function onlyCacheFile(): Promise<string> {
    const files = await readdir(dir)
    return join(dir, files[0])
  }

  it('reads a corrupt record as a miss, and says so', async () => {
    await writeCachedVerdict(ctx, dir, record(cacheKey(PARTS)))
    await writeFile(await onlyCacheFile(), 'not json', 'utf8')
    await expect(readCachedVerdict(ctx, dir, cacheKey(PARTS))).resolves.toBeUndefined()
    expect(warnings[0]).toContain('is corrupt; treating it as a miss')
  })

  it.each([
    ['a verdict outside the closed set', '{"key":{},"verdict":"maybe","coverage":{},"comments":[]}'],
    ['a record with no key to compare', '{"verdict":"allow","coverage":{},"comments":[]}'],
    ['a record with no coverage account', '{"key":{},"verdict":"allow","comments":[]}'],
    ['a record whose findings are not a list', '{"key":{},"verdict":"allow","coverage":{},"comments":"none"}'],
    ['a JSON array rather than a record', '[]'],
  ])('rejects %s', async (_label, raw) => {
    await writeCachedVerdict(ctx, dir, record(cacheKey(PARTS)))
    await writeFile(await onlyCacheFile(), raw, 'utf8')
    await expect(readCachedVerdict(ctx, dir, cacheKey(PARTS))).resolves.toBeUndefined()
  })

  // Insurance against a filename-hash collision: the file is named by a
  // truncated digest, so the record has to prove it is the one asked for.
  it('rejects a record whose stored key is not the key looked up', async () => {
    const key = cacheKey(PARTS)
    await writeCachedVerdict(ctx, dir, record(key))
    const file = await onlyCacheFile()
    const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    await writeFile(file, JSON.stringify({ ...stored, key: { ...key, card: 'someone-else' } }), 'utf8')
    await expect(readCachedVerdict(ctx, dir, key)).resolves.toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('reads an absent record as a plain miss, without warning', async () => {
    await expect(readCachedVerdict(ctx, dir, cacheKey(PARTS))).resolves.toBeUndefined()
    expect(warnings).toEqual([])
  })

  // Provoked with a directory where the record should be, because that is
  // `EISDIR` on every platform. Putting a regular file where the *cache
  // directory* should be is `ENOTDIR` on POSIX but `ENOENT` on Windows, which
  // this code — correctly — reads as "no record yet" and does not warn about.
  it('warns rather than throwing when a record cannot be read', async () => {
    await writeCachedVerdict(ctx, dir, record(cacheKey(PARTS)))
    const file = await onlyCacheFile()
    await rm(file)
    await mkdir(file)
    await expect(readCachedVerdict(ctx, dir, cacheKey(PARTS))).resolves.toBeUndefined()
    expect(warnings[0]).toContain('could not read the verdict cache')
  })

  it('reads a cache directory that is not a directory as a miss', async () => {
    const blocked = join(dir, 'in-the-way')
    await writeFile(blocked, 'not a directory\n', 'utf8')
    await expect(readCachedVerdict(ctx, blocked, cacheKey(PARTS))).resolves.toBeUndefined()
  })

  it('warns rather than throwing when the cache cannot be written', async () => {
    const blocked = join(dir, 'also-in-the-way')
    await writeFile(blocked, 'not a directory\n', 'utf8')
    await expect(writeCachedVerdict(ctx, blocked, record(cacheKey(PARTS)))).resolves.toBeUndefined()
    expect(warnings[0]).toContain('could not write the verdict cache')
  })
})
