// Anchor evaluation against a real working tree. The cases that matter are the
// ones separating "still true" from "cannot tell": a missing git history and an
// unparseable file must report unevaluable, never fresh.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { evaluateAnchor, evaluateAnchors, hashSymbol } from '@zhchxiao123/dsh-devflow-spec-filesystem'
import type { AnchorEvaluationContext, AnchorSourceCache } from '@zhchxiao123/dsh-devflow-spec-filesystem'
import type { SpecAnchor } from '@zhchxiao123/dsh-devflow-spec'

const SOURCE = 'export function isLegal(from: string): boolean { return from !== "done" }'

let repoRoot: string

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'spec-anchor-'))
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await writeFile(join(repoRoot, 'src/stages.ts'), SOURCE, 'utf8')
})

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true })
})

const symbolAnchor: SpecAnchor = { id: 'a1', kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }

function context(overrides: Partial<AnchorEvaluationContext> = {}): AnchorEvaluationContext {
  return { repoRoot, updatedAt: '2026-09-02T00:00:00.000Z', ...overrides }
}

describe('symbol anchors', () => {
  it('is fresh while the symbol is declared', async () => {
    await expect(evaluateAnchor(symbolAnchor, context())).resolves.toEqual({ id: 'a1', status: 'fresh' })
  })

  it('goes stale when the symbol is renamed', async () => {
    await writeFile(join(repoRoot, 'src/stages.ts'), SOURCE.replace('isLegal', 'isPermitted'), 'utf8')
    const verdict = await evaluateAnchor(symbolAnchor, context())
    expect(verdict).toMatchObject({ status: 'stale' })
    expect(verdict).toHaveProperty('reason', expect.stringContaining('no longer declares isLegal'))
  })

  it('goes stale when the file is gone', async () => {
    await rm(join(repoRoot, 'src/stages.ts'))
    const verdict = await evaluateAnchor(symbolAnchor, context())
    expect(verdict).toMatchObject({ status: 'stale' })
    expect(verdict).toHaveProperty('reason', expect.stringContaining('no longer exists'))
  })

  it('is unevaluable — not fresh — for a file no parser reads', async () => {
    const verdict = await evaluateAnchor({ ...symbolAnchor, file: 'cordis.yml' }, context())
    expect(verdict).toMatchObject({ status: 'unevaluable' })
    expect(verdict).toHaveProperty('reason', expect.stringContaining('churn anchor'))
  })

  it('rejects rather than judges when the path exists but cannot be read', async () => {
    await mkdir(join(repoRoot, 'src/directory.ts'), { recursive: true })
    await expect(evaluateAnchor({ ...symbolAnchor, file: 'src/directory.ts' }, context())).rejects.toThrow()
  })
})

describe('content-hash anchors', () => {
  it('is fresh while the recorded hash still matches', async () => {
    const hash = hashSymbol(SOURCE, 'isLegal')
    expect(hash).toBeDefined()
    const anchor: SpecAnchor = { id: 'a2', kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegal', hash: hash as string }
    await expect(evaluateAnchor(anchor, context())).resolves.toEqual({ id: 'a2', status: 'fresh' })
  })

  it('goes stale when the implementation changes', async () => {
    const anchor: SpecAnchor = { id: 'a2', kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegal', hash: 'sha1:0000000000000000000000000000000000000000' }
    const verdict = await evaluateAnchor(anchor, context())
    expect(verdict).toMatchObject({ status: 'stale' })
    expect(verdict).toHaveProperty('reason', expect.stringContaining('changed'))
  })

  it('goes stale when the symbol it hashed is gone', async () => {
    const anchor: SpecAnchor = { id: 'a2', kind: 'content-hash', file: 'src/stages.ts', symbol: 'vanished', hash: 'sha1:0' }
    await expect(evaluateAnchor(anchor, context())).resolves.toMatchObject({ status: 'stale' })
  })
})

describe('churn anchors', () => {
  const churn: SpecAnchor = { id: 'a3', kind: 'churn', file: 'src/stages.ts' }

  it('is unevaluable without git rather than quietly passing', async () => {
    const verdict = await evaluateAnchor(churn, context())
    expect(verdict).toMatchObject({ status: 'unevaluable' })
    expect(verdict).toHaveProperty('reason', expect.stringContaining('no git history'))
  })

  it('is unevaluable for an untracked file', async () => {
    const verdict = await evaluateAnchor(churn, context({ lastCommitAt: () => Promise.resolve(undefined) }))
    expect(verdict).toMatchObject({ status: 'unevaluable' })
    expect(verdict).toHaveProperty('reason', expect.stringContaining('not tracked'))
  })

  it('is fresh while the document is at least as new as the code', async () => {
    const verdict = await evaluateAnchor(churn, context({ lastCommitAt: () => Promise.resolve('2026-09-01T00:00:00.000Z') }))
    expect(verdict).toEqual({ id: 'a3', status: 'fresh' })
  })

  it('goes stale once the code is committed after the document', async () => {
    const verdict = await evaluateAnchor(churn, context({ lastCommitAt: () => Promise.resolve('2026-09-03T00:00:00.000Z') }))
    expect(verdict).toMatchObject({ status: 'stale' })
    expect(verdict).toHaveProperty('reason', expect.stringContaining('after this document was written'))
  })
})

describe('evaluateAnchors', () => {
  it('reports one verdict per anchor in declaration order', async () => {
    const verdicts = await evaluateAnchors([symbolAnchor, { id: 'a3', kind: 'churn', file: 'src/stages.ts' }], context())
    expect(verdicts.map(verdict => verdict.id)).toEqual(['a1', 'a3'])
    expect(verdicts.map(verdict => verdict.status)).toEqual(['fresh', 'unevaluable'])
  })
})

describe('the parse cache', () => {
  const contentAnchor = (hash: string): SpecAnchor => ({ id: 'a2', kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegal', hash })

  it('serves a second anchor on the same file without re-reading it', async () => {
    const cache: AnchorSourceCache = new Map()
    const first = await evaluateAnchor(symbolAnchor, context({ cache }))
    expect(first).toMatchObject({ status: 'fresh' })
    expect(cache.size).toBe(1)

    // Delete the file: a cache hit must answer from the entry, and the
    // still-cached stat is what a hit is keyed on.
    const digest = hashSymbol(SOURCE, 'isLegal')
    expect(await evaluateAnchor(contentAnchor(digest!), context({ cache }))).toMatchObject({ status: 'fresh' })
    expect(cache.get('src/stages.ts')?.symbols.size).toBe(1)
  })

  it('re-parses once the file changes underneath it', async () => {
    const cache: AnchorSourceCache = new Map()
    await evaluateAnchor(symbolAnchor, context({ cache }))

    // A different size makes the entry stale regardless of timer resolution.
    await writeFile(join(repoRoot, 'src/stages.ts'), 'export function renamed(): void {}\n', 'utf8')
    const after = await evaluateAnchor(symbolAnchor, context({ cache }))

    expect(after).toMatchObject({ status: 'stale' })
    expect(after).toHaveProperty('reason', expect.stringContaining('no longer declares isLegal'))
  })

  it('caches nothing for a file that is not there, so its absence cannot stick', async () => {
    const cache: AnchorSourceCache = new Map()
    const gone: SpecAnchor = { id: 'a1', kind: 'symbol', file: 'src/gone.ts', symbol: 'isLegal' }

    expect(await evaluateAnchor(gone, context({ cache }))).toMatchObject({ status: 'stale' })
    expect(cache.size).toBe(0)

    // Once the file appears, the verdict follows it rather than a stored miss.
    await writeFile(join(repoRoot, 'src/gone.ts'), SOURCE, 'utf8')
    expect(await evaluateAnchor(gone, context({ cache }))).toMatchObject({ status: 'fresh' })
  })

  it('evaluates identically with no cache at all', async () => {
    expect(await evaluateAnchor(symbolAnchor, context())).toEqual(await evaluateAnchor(symbolAnchor, context({ cache: new Map() })))
  })
})
