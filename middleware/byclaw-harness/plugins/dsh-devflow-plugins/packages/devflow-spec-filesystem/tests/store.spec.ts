// The provider's read and write faces against a real tree: reads always carry
// anchor verdicts, and the write path refuses every document that could not be
// checked afterwards — including one that would be born stale.
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SpecStore, { encodeSpecFile, hashSymbol } from '@zhchxiao123/dsh-devflow-spec-filesystem'
import type { SpecAnchor, SpecWriteRequest } from '@zhchxiao123/dsh-devflow-spec'

const SOURCE = 'export function isLegal(from: string): boolean { return from !== "done" }\n'
const BODY = '## Source of truth\n\nThe predicate [[a1]] decides edge legality.\n'

let specRoot: string
let repoRoot: string
let store: InstanceType<typeof SpecStore>

const symbolAnchor: SpecAnchor = { id: 'a1', kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }

function request(overrides: Partial<SpecWriteRequest> = {}): SpecWriteRequest {
  return { id: 'guides/edges', title: 'Edges', body: BODY, anchors: [symbolAnchor], ...overrides }
}

beforeEach(async () => {
  specRoot = await mkdtemp(join(tmpdir(), 'spec-root-'))
  repoRoot = await mkdtemp(join(tmpdir(), 'spec-repo-'))
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await writeFile(join(repoRoot, 'src/stages.ts'), SOURCE, 'utf8')
  const ctx = new Context()
  await ctx.plugin(SpecStore, { root: specRoot, repoRoot })
  store = ctx.get('devflowSpec') as InstanceType<typeof SpecStore>
})

afterEach(async () => {
  await rm(specRoot, { recursive: true, force: true })
  await rm(repoRoot, { recursive: true, force: true })
})

async function seed(id: string, overrides: Partial<Parameters<typeof encodeSpecFile>[0]> = {}): Promise<void> {
  const path = join(specRoot, `${id}.md`)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, encodeSpecFile({
    title: 'Edges',
    updatedAt: '2026-09-02T00:00:00.000Z',
    anchors: [symbolAnchor],
    body: BODY,
    ...overrides,
  }), 'utf8')
}

describe('write', () => {
  it('commits a document whose anchors all resolve', async () => {
    const result = await store.write(store.resolveWrite(request({ description: 'Edge legality' })))
    expect(result).toMatchObject({
      ok: true,
      document: {
        id: 'guides/edges',
        freshness: 'fresh',
        description: 'Edge legality',
        anchorRefs: [{ kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }],
      },
    })
    const written = await readFile(join(specRoot, 'guides/edges.md'), 'utf8')
    expect(written).toContain('## Source of truth')
    expect(written).toContain('symbol: isLegal')
  })

  it('leaves no temporary file behind', async () => {
    await store.write(store.resolveWrite(request()))
    await expect(readFile(join(specRoot, 'guides/edges.md.tmp'), 'utf8')).rejects.toThrow()
  })

  it('refuses an id that could open a path of its own', async () => {
    await expect(store.write(store.resolveWrite(request({ id: '../escape' })))).resolves.toMatchObject({ ok: false, code: 'invalid-id' })
  })

  it('refuses a replacement id that could delete outside the spec root', async () => {
    const outside = `${specRoot}-outside.md`
    const traversal = `../${basename(specRoot)}-outside`
    await writeFile(outside, 'belongs outside the spec store', 'utf8')
    try {
      const result = await store.write(store.resolveWrite(request({ replaces: [traversal] })))
      expect(result).toMatchObject({ ok: false, code: 'invalid-id' })
      expect(await readFile(outside, 'utf8')).toBe('belongs outside the spec store')
    } finally {
      await rm(outside, { force: true })
    }
  })

  it('refuses a document that never says what it rests on', async () => {
    await expect(store.write(store.resolveWrite(request({ body: 'Some prose citing [[a1]].' })))).resolves.toMatchObject({ ok: false, code: 'missing-source-of-truth' })
  })

  it('refuses a document that anchors nothing', async () => {
    const result = await store.write(store.resolveWrite(request({ anchors: [], body: '## Source of truth\n\nNothing.\n' })))
    expect(result).toMatchObject({ ok: false, code: 'no-anchors' })
  })

  it('refuses a broken citation relation', async () => {
    await expect(store.write(store.resolveWrite(request({ body: '## Source of truth\n\nNo citation here.\n' }))))
      .resolves.toMatchObject({ ok: false, code: 'uncited-anchor' })
  })

  it('refuses a document that would be born stale', async () => {
    const stale: SpecAnchor = { id: 'a1', kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegal', hash: 'sha1:0' }
    const result = await store.write(store.resolveWrite(request({ anchors: [stale] })))
    expect(result).toMatchObject({ ok: false, code: 'anchor-unresolvable' })
    expect(result).toHaveProperty('message', expect.stringContaining('born stale'))
  })

  it('refuses to overwrite an existing document unless it is being revised', async () => {
    await store.write(store.resolveWrite(request()))
    const blind = await store.write(store.resolveWrite(request()))
    expect(blind).toMatchObject({ ok: false, code: 'exists' })
    expect(blind).toHaveProperty('message', expect.stringContaining('list it in "replaces"'))
  })

  describe('replaces', () => {
    /** The whole root as comparable state, to prove a rejection changed nothing. */
    async function tree(): Promise<Map<string, string>> {
      const state = new Map<string, string>()
      for (const summary of await store.list()) {
        state.set(summary.id, await readFile(summary.path, 'utf8'))
      }
      return state
    }

    it('revises a document in place when it names its own id', async () => {
      await store.write(store.resolveWrite(request({ title: 'Old' })))
      const revised = await store.write(store.resolveWrite(request({ title: 'New', replaces: ['guides/edges'] })))

      expect(revised).toMatchObject({ ok: true, replaced: [] })
      expect(await readFile(join(specRoot, 'guides/edges.md'), 'utf8')).toContain('title: New')
      expect((await store.list()).map(summary => summary.id)).toEqual(['guides/edges'])
    })

    it('merges a cluster: the replacement is written and the others are gone', async () => {
      await seed('guides/a')
      await seed('guides/b')
      await seed('guides/keep')

      const merged = await store.write(store.resolveWrite(request({
        id: 'guides/merged',
        replaces: ['guides/a', 'guides/b'],
      })))

      expect(merged).toMatchObject({ ok: true, replaced: ['guides/a', 'guides/b'] })
      expect((await store.list()).map(summary => summary.id)).toEqual(['guides/keep', 'guides/merged'])
    })

    it('refuses an id that is not there, leaving the root untouched', async () => {
      await seed('guides/a')
      const before = await tree()

      const result = await store.write(store.resolveWrite(request({ id: 'guides/merged', replaces: ['guides/a', 'guides/ghost'] })))

      expect(result).toMatchObject({ ok: false, code: 'unknown-replaced' })
      expect(result).toHaveProperty('message', expect.stringContaining('guides/ghost'))
      expect(await tree()).toEqual(before)
    })

    it('budgets the NET change, so a merge passes where the same addition would not', async () => {
      const ctx = new Context()
      await ctx.plugin(SpecStore, { root: specRoot, repoRoot, maxNetGrowthBytes: 400 })
      const tight = ctx.get('devflowSpec') as InstanceType<typeof SpecStore>
      await seed('guides/a')
      await seed('guides/b')
      const before = await tree()
      const padded = `${BODY}\n${'x'.repeat(500)}\n`

      const addition = await tight.write(tight.resolveWrite(request({ id: 'guides/added', body: padded })))
      expect(addition).toMatchObject({ ok: false, code: 'budget-exceeded' })
      expect(addition).toHaveProperty('message', expect.stringContaining('400 byte ceiling'))
      expect(await tree()).toEqual(before)

      // The same bytes, arriving as a merge of two documents, are a reduction.
      const merge = await tight.write(tight.resolveWrite(request({
        id: 'guides/merged',
        body: padded,
        replaces: ['guides/a', 'guides/b'],
      })))
      expect(merge).toMatchObject({ ok: true, replaced: ['guides/a', 'guides/b'] })
    })

    it('settles every rejection before the first write, however far down it fires', async () => {
      await seed('guides/a')
      const before = await tree()
      const stale: SpecAnchor = { id: 'a1', kind: 'symbol', file: 'src/stages.ts', symbol: 'gone' }

      // An anchor rejection fires AFTER the replaced ids have been resolved,
      // which is exactly where a half-applied merge would show up.
      const result = await store.write(store.resolveWrite(request({
        id: 'guides/merged',
        anchors: [stale],
        replaces: ['guides/a'],
      })))

      expect(result).toMatchObject({ ok: false, code: 'anchor-unresolvable' })
      expect(await tree()).toEqual(before)
    })
  })

  it('lets the caller pin a root, and stamps the write time', () => {
    const spec = store.resolveWrite(request({ root: specRoot }))
    expect(spec.root).toBe(specRoot)
    expect(Number.isNaN(Date.parse(spec.updatedAt))).toBe(false)
  })
})

describe('read', () => {
  it('rejects an invalid id before it can read outside the spec root', async () => {
    await expect(store.read('../escape')).rejects.toThrow(/not a legal spec id/)
  })

  it('carries the verdicts beside the body', async () => {
    await seed('guides/edges')
    const document = await store.read('guides/edges')
    expect(document).toMatchObject({ id: 'guides/edges', freshness: 'fresh', body: BODY })
    expect(document.verdicts).toEqual([{ id: 'a1', status: 'fresh' }])
    expect(document.anchorRefs).toEqual([{ kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }])
  })

  it('reports stale once the anchored symbol is renamed', async () => {
    await seed('guides/edges')
    await writeFile(join(repoRoot, 'src/stages.ts'), SOURCE.replace('isLegal', 'isPermitted'), 'utf8')
    const document = await store.read('guides/edges')
    expect(document.freshness).toBe('stale')
    expect(document.verdicts[0]).toMatchObject({ status: 'stale' })
  })

  it('keeps an optional description and omits it when absent', async () => {
    await seed('with-description', { description: 'Present' })
    await seed('without-description')
    expect(await store.read('with-description')).toHaveProperty('description', 'Present')
    expect(await store.read('without-description')).not.toHaveProperty('description')
  })

  it('names the document it cannot find', async () => {
    await expect(store.read('guides/absent')).rejects.toThrow(/guides\/absent does not exist/)
  })

  it('accepts a caller-pinned root', async () => {
    await seed('guides/edges')
    await expect(store.read('guides/edges', specRoot)).resolves.toMatchObject({ id: 'guides/edges' })
  })
})

describe('evaluate', () => {
  it('rejects an invalid id before it can read outside the spec root', async () => {
    await expect(store.evaluate('../escape')).rejects.toThrow(/not a legal spec id/)
  })

  it('reports one verdict per anchor without the body', async () => {
    await seed('guides/edges')
    await expect(store.evaluate('guides/edges')).resolves.toEqual([{ id: 'a1', status: 'fresh' }])
    await expect(store.evaluate('guides/edges', specRoot)).resolves.toHaveLength(1)
    await expect(store.evaluate('guides/edges', specRoot, repoRoot)).resolves.toHaveLength(1)
  })
})

describe('list', () => {
  it('walks nested scopes and orders by id', async () => {
    await seed('guides/edges')
    await seed('@scope/pkg/backend/errors')
    await writeFile(join(specRoot, 'guides/notes.txt'), 'ignored', 'utf8')
    const ids = (await store.list()).map(summary => summary.id)
    expect(ids).toEqual(['@scope/pkg/backend/errors', 'guides/edges'])
  })

  it('narrows to one scope, by exact id and by prefix', async () => {
    await seed('guides/edges')
    await seed('guides')
    await seed('other/doc')
    expect((await store.list('guides')).map(summary => summary.id)).toEqual(['guides', 'guides/edges'])
    expect(await store.list('missing')).toEqual([])
  })

  it('carries description and freshness in the index', async () => {
    await seed('guides/edges', { description: 'Edge legality' })
    const [summary] = await store.list()
    expect(summary).toMatchObject({ description: 'Edge legality', freshness: 'fresh' })
  })

  it('carries each anchor\'s reference face in declaration order, digests and ids omitted', async () => {
    const hash = hashSymbol(SOURCE, 'isLegal') as string
    await seed('guides/edges', {
      anchors: [
        { id: 'a1', kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' },
        { id: 'a2', kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegal', hash },
        { id: 'a3', kind: 'churn', file: 'src/other.ts' },
      ],
      body: '## Source of truth\n\nClaims [[a1]], [[a2]], and [[a3]].\n',
    })
    const [summary] = await store.list()
    // toEqual rejects any extra defined property, which is what keeps `hash`
    // and the anchor ids out of the index.
    expect(summary?.anchorRefs).toEqual([
      { kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' },
      { kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegal' },
      { kind: 'churn', file: 'src/other.ts' },
    ])
    // toEqual treats an undefined-valued `symbol` as equal to an absent one;
    // the churn reference must genuinely not carry the property.
    expect(summary?.anchorRefs[2]).not.toHaveProperty('symbol')
  })

  it('reports an empty root rather than failing', async () => {
    await expect(store.list(undefined, join(specRoot, 'nowhere'))).resolves.toEqual([])
  })

  it('rejects when the root is not a directory at all', async () => {
    const file = join(specRoot, 'a-file')
    await writeFile(file, 'x', 'utf8')
    await expect(store.list(undefined, file)).rejects.toThrow()
  })
})

describe('reads that cannot proceed', () => {
  it('rejects rather than reporting absent when the path exists but is unreadable', async () => {
    await mkdir(join(specRoot, 'a-directory.md'), { recursive: true })
    await expect(store.read('a-directory')).rejects.toThrow()
  })
})

describe('churn anchors with git', () => {
  it('go stale once the anchored file is committed after the document', async () => {
    const run = promisify(execFile)
    await run('git', ['init', '-q'], { cwd: repoRoot })
    await run('git', ['add', 'src/stages.ts'], { cwd: repoRoot })
    await run('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'add'], { cwd: repoRoot })
    const ctx = new Context()
    await ctx.plugin(SpecStore, { root: specRoot, repoRoot })
    const gitStore = ctx.get('devflowSpec') as InstanceType<typeof SpecStore>
    await seed('guides/churn', { anchors: [{ id: 'a1', kind: 'churn', file: 'src/stages.ts' }] })
    const verdicts = await gitStore.evaluate('guides/churn')
    expect(verdicts[0]).toMatchObject({ status: 'stale' })
  })
})

describe('churn anchors without git', () => {
  it('are unevaluable, so the document is not reported fresh', async () => {
    await seed('guides/churn', { anchors: [{ id: 'a1', kind: 'churn', file: 'src/stages.ts' }] })
    const document = await store.read('guides/churn')
    expect(document.verdicts[0]).toMatchObject({ status: 'unevaluable' })
    expect(document.freshness).toBe('unevaluable')
  })
})

describe('content-hash anchors', () => {
  it('take the current digest when the caller states none', async () => {
    const result = await store.write(store.resolveWrite(request({
      anchors: [{ id: 'a1', kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegal' }],
    })))
    expect(result).toMatchObject({ ok: true })
    const written = await readFile(join(specRoot, 'guides/edges.md'), 'utf8')
    expect(written).toMatch(/hash: sha1:[0-9a-f]{40}/)
    await expect(store.evaluate('guides/edges')).resolves.toEqual([{ id: 'a1', status: 'fresh' }])
  })

  it('cannot be filled for a symbol that is not there, and the write says so', async () => {
    const result = await store.write(store.resolveWrite(request({
      anchors: [{ id: 'a1', kind: 'content-hash', file: 'src/stages.ts', symbol: 'vanished' }],
    })))
    expect(result).toMatchObject({ ok: false, code: 'anchor-unresolvable' })
  })

  it('cannot be filled from a file that is not there either', async () => {
    const result = await store.write(store.resolveWrite(request({
      anchors: [{ id: 'a1', kind: 'content-hash', file: 'src/missing.ts', symbol: 'isLegal' }],
    })))
    expect(result).toMatchObject({ ok: false, code: 'anchor-unresolvable' })
  })

  it('cannot be filled for a file no evaluator claims, even one that exists', async () => {
    await writeFile(join(repoRoot, 'notes.txt'), 'isLegal is documented here\n', 'utf8')
    const result = await store.write(store.resolveWrite(request({
      anchors: [{ id: 'a1', kind: 'content-hash', file: 'notes.txt', symbol: 'isLegal' }],
    })))
    expect(result).toMatchObject({ ok: false, code: 'anchor-unresolvable' })
    expect(result).toHaveProperty('message', expect.stringContaining('only a churn anchor can watch it'))
  })

  it('stay fresh while the recorded hash matches', async () => {
    const hash = hashSymbol(SOURCE, 'isLegal') as string
    await seed('guides/hash', { anchors: [{ id: 'a1', kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegal', hash }] })
    await expect(store.evaluate('guides/hash')).resolves.toEqual([{ id: 'a1', status: 'fresh' }])
  })
})

describe('waived scopes', () => {
  it('lands in the frontmatter, the write result, and the index', async () => {
    const waives = ['examples/with-nextjs', 'examples/with-script-in-browser']
    const result = await store.write(store.resolveWrite(request({ id: 'monorepo/examples-are-illustrative', waives })))

    expect(result).toMatchObject({ ok: true, document: { waives } })
    expect(await readFile(join(specRoot, 'monorepo/examples-are-illustrative.md'), 'utf8')).toContain('waives:\n  - examples/with-nextjs')
    // The census learns who waives what from the index alone; a body read
    // would defeat the point of having an index.
    const [summary] = await store.list()
    expect(summary?.waives).toEqual(waives)
    expect(await store.read('monorepo/examples-are-illustrative')).toHaveProperty('waives', waives)
  })

  it('is absent from the index and the document when the write declared none', async () => {
    await store.write(store.resolveWrite(request()))
    const [summary] = await store.list()
    expect(summary).not.toHaveProperty('waives')
    expect(await store.read('guides/edges')).not.toHaveProperty('waives')
    expect(await readFile(join(specRoot, 'guides/edges.md'), 'utf8')).not.toContain('waives')
  })

  it('refuses a document that waives its own id or a scope it lives under', async () => {
    const own = await store.write(store.resolveWrite(request({ waives: ['guides/edges'] })))
    expect(own).toMatchObject({ ok: false, code: 'self-waiver' })
    expect(own).toHaveProperty('message', expect.stringContaining('covered rather than waived'))

    const ancestor = await store.write(store.resolveWrite(request({ waives: ['guides'] })))
    expect(ancestor).toMatchObject({ ok: false, code: 'self-waiver' })
    await expect(readFile(join(specRoot, 'guides/edges.md'), 'utf8')).rejects.toThrow()
  })

  it('refuses an entry that is not a legal scope id', async () => {
    const result = await store.write(store.resolveWrite(request({ waives: ['../escape'] })))
    expect(result).toMatchObject({ ok: false, code: 'invalid-id' })
  })

  it('accepts a scope nothing expects, and the same scope named twice', async () => {
    // The store holds no expected set, so neither question is answerable here;
    // the census reports both as the facts they are.
    const result = await store.write(store.resolveWrite(request({
      waives: ['nobody/expects-this', 'examples/with-nextjs', 'examples/with-nextjs'],
    })))
    expect(result).toMatchObject({ ok: true })
  })
})

describe('defaults', () => {
  it('resolves a root under .devflow when the deployment states none', async () => {
    const ctx = new Context()
    await ctx.plugin(SpecStore, {})
    const defaulted = ctx.get('devflowSpec') as InstanceType<typeof SpecStore>
    expect(defaulted.resolveWrite(request()).root.endsWith(join('.devflow', 'spec'))).toBe(true)
  })

  it('applies the same fallbacks when constructed without the config schema', () => {
    // Direct construction skips schemastery, which is how the class's own
    // `??` fallbacks — not the schema's defaults — get exercised.
    const bare = new SpecStore(new Context(), {})
    expect(bare.resolveWrite(request()).root.endsWith(join('.devflow', 'spec'))).toBe(true)
  })
})
