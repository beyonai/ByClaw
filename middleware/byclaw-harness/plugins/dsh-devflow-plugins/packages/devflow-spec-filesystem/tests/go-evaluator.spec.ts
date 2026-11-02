// The Go evaluator: what counts as a top-level declaration — including the
// grouped const/var/type blocks and Type.Name methods — and which formatting
// dimensions must not move a content hash. gofmt's dimensions are tabs,
// blank lines, intra-line spacing, and the mandatory trailing comma in an
// exploded composite literal; newline removal is NOT one of them, because
// semicolon insertion makes line structure part of what is parsed.
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SpecStore from '@zhchxiao123/dsh-devflow-spec-filesystem'
import { goEvaluator } from '../src/evaluators/go.ts'
import { evaluatorFor } from '../src/evaluators/registry.ts'

async function hashOf(source: string, symbol: string): Promise<string | undefined> {
  return (await goEvaluator.lookup(source, symbol)).hash
}

async function declared(source: string, symbol: string): Promise<boolean> {
  return (await goEvaluator.lookup(source, symbol)).declared
}

const ORIGINAL = `package model

// hasHTTPPrefix reports whether the URL carries an explicit scheme.
func hasHTTPPrefix(u string) bool {
	return strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://")
}
`

describe('normalization', () => {
  it('survives a comment rewrite, and does not mistake // inside a string for one', async () => {
    const uncommented = ORIGINAL.replace('// hasHTTPPrefix reports whether the URL carries an explicit scheme.\n', '')
    await expect(hashOf(uncommented, 'hasHTTPPrefix')).resolves.toBe(await hashOf(ORIGINAL, 'hasHTTPPrefix'))
    const otherScheme = ORIGINAL.replace('"http://"', '"ftp://"')
    await expect(hashOf(otherScheme, 'hasHTTPPrefix')).resolves.not.toBe(await hashOf(ORIGINAL, 'hasHTTPPrefix'))
  })

  it('survives a legal reformat: tabs to spaces, blank lines, intra-line spacing', async () => {
    const gofmt = 'package m\n\nfunc f(a int) bool {\n\treturn a != 0\n}\n'
    const mangled = 'package m\n\nfunc f(a int) bool {\n\n    return a  !=  0\n\n}\n'
    await expect(hashOf(mangled, 'f')).resolves.toBe(await hashOf(gofmt, 'f'))
  })

  it('survives gofmt exploding a composite literal with its mandatory trailing comma', async () => {
    const oneLine = 'package m\n\nvar statuses = []string{A, B}\n'
    const exploded = 'package m\n\nvar statuses = []string{\n\tA,\n\tB,\n}\n'
    await expect(hashOf(exploded, 'statuses')).resolves.toBe(await hashOf(oneLine, 'statuses'))
  })

  it('moves when a statement changes blocks: the braces are tokens in the stream', async () => {
    const guarded = 'package m\n\nfunc f(o *O) {\n\tif o.a {\n\t\to.b = 1\n\t}\n\to.c = 2\n}\n'
    const moved = 'package m\n\nfunc f(o *O) {\n\tif o.a {\n\t\to.b = 1\n\t\to.c = 2\n\t}\n}\n'
    await expect(hashOf(guarded, 'f')).resolves.not.toBe(await hashOf(moved, 'f'))
  })
})

describe('symbol lookup', () => {
  it('finds each of the declaration forms a spec cites', async () => {
    await expect(declared('package m\n\nfunc f() {}\n', 'f')).resolves.toBe(true)
    await expect(declared('package m\n\ntype T struct{ N int }\n', 'T')).resolves.toBe(true)
    await expect(declared('package m\n\nconst Limit = 10\n', 'Limit')).resolves.toBe(true)
    await expect(declared('package m\n\nvar x = 1\n', 'x')).resolves.toBe(true)
    await expect(declared('package m\n\nvar a, b = 1, 2\n', 'b')).resolves.toBe(true)
  })

  it('cites a method as Type.Name with the receiver\'s * stripped, never as its bare name', async () => {
    const pointer = 'package m\n\nfunc (e *Entry) IsRead() bool { return e.read }\n'
    await expect(declared(pointer, 'Entry.IsRead')).resolves.toBe(true)
    await expect(declared(pointer, 'IsRead')).resolves.toBe(false)
    await expect(declared('package m\n\nfunc (v Value) Get() int { return v.n }\n', 'Value.Get')).resolves.toBe(true)
  })

  it('anchors a grouped declaration whole: either name resolves to the block, and any line moves both', async () => {
    const group = 'package m\n\nconst (\n\tA = 1\n\tB = 2\n)\n'
    await expect(hashOf(group, 'A')).resolves.toBe(await hashOf(group, 'B'))
    const edited = 'package m\n\nconst (\n\tA = 1\n\tB = 3\n)\n'
    await expect(hashOf(edited, 'A')).resolves.not.toBe(await hashOf(group, 'A'))
  })

  it('unrolls a type group past its comments, aliases included', async () => {
    const typeGroup = 'package m\n\ntype (\n\t// S is an alias.\n\tS = string\n\tT struct{ N int }\n)\n'
    await expect(declared(typeGroup, 'S')).resolves.toBe(true)
    await expect(declared(typeGroup, 'T')).resolves.toBe(true)
  })

  it('resolves a re-declared name to its first declaration', async () => {
    await expect(hashOf('package m\n\nconst A = 1\nconst A = 2\n', 'A')).resolves.toBe(await hashOf('package m\n\nconst A = 1\n', 'A'))
  })

  it('reports a symbol it cannot find rather than hashing the whole file', async () => {
    await expect(goEvaluator.lookup('package m\n\nfunc f() {}\n', 'g')).resolves.toEqual({ declared: false, hash: undefined })
  })

  it('claims nothing from a method whose receiver a broken file left typeless', async () => {
    await expect(declared('package m\n\nfunc () Broken() {}\n', 'Broken')).resolves.toBe(false)
  })

  it('still finds what the parser can reach in a file that no longer parses cleanly', async () => {
    const broken = 'package m\n\nfunc ok() {}\n\nfunc broken( {\n'
    await expect(declared(broken, 'ok')).resolves.toBe(true)
    await expect(declared(broken, 'broken')).resolves.toBe(false)
  })

  it('claims .go files through the registry', () => {
    expect(evaluatorFor('internal/model/entry.go')).toBe(goEvaluator)
  })
})

describe('the miniflux sample', () => {
  // tests/fixtures/entry.go is a verbatim read-only copy of the sample
  // repository's internal/model/entry.go (Apache-2.0, header retained); the
  // expected names are the PoC's enumeration of it.
  const fixture = readFile(join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/entry.go'), 'utf8')

  it('declares every top-level symbol the PoC enumerated, methods as Type.Name', async () => {
    const source = await fixture
    for (const symbol of [
      'EntryStatusUnread',
      'EntryStatusRead',
      'DefaultSortingOrder',
      'DefaultSortingDirection',
      'MaxEntryLimit',
      'MaxEntryIDsLimit',
      'Entry',
      'NewEntry',
      'Entry.ShouldMarkAsReadOnView',
      'Entries',
      'EntriesStatusUpdateRequest',
      'EntryUpdateRequest',
      'EntryUpdateRequest.Patch',
    ]) {
      await expect(goEvaluator.lookup(source, symbol)).resolves
        .toMatchObject({ declared: true, hash: expect.stringMatching(/^sha1:[0-9a-f]{40}$/) as string })
    }
    // The grouped statuses anchor one block; the bare method name is nothing.
    await expect(hashOf(source, 'EntryStatusUnread')).resolves.toBe(await hashOf(source, 'DefaultSortingDirection'))
    await expect(declared(source, 'ShouldMarkAsReadOnView')).resolves.toBe(false)
  })
})

describe('composed through the store', () => {
  it('reports a document stale once its anchored Go symbol changes', async () => {
    const specRoot = await mkdtemp(join(tmpdir(), 'spec-go-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'spec-go-repo-'))
    try {
      await mkdir(join(repoRoot, 'internal'), { recursive: true })
      await writeFile(join(repoRoot, 'internal/url.go'), ORIGINAL, 'utf8')
      const ctx = new Context()
      await ctx.plugin(SpecStore, { root: specRoot, repoRoot })
      const store = ctx.get('devflowSpec') as InstanceType<typeof SpecStore>

      const written = await store.write(store.resolveWrite({
        id: 'internal/url-schemes',
        title: 'URL scheme handling',
        body: '## Source of truth\n\nThe predicate [[a1]] decides scheme presence.\n',
        anchors: [{ id: 'a1', kind: 'content-hash', file: 'internal/url.go', symbol: 'hasHTTPPrefix' }],
      }))
      expect(written).toMatchObject({ ok: true, document: { freshness: 'fresh' } })
      expect(await readFile(join(specRoot, 'internal/url-schemes.md'), 'utf8')).toMatch(/hash: sha1:[0-9a-f]{40}/)

      await writeFile(join(repoRoot, 'internal/url.go'), ORIGINAL.replace('|| strings.HasPrefix(u, "http://")', ''), 'utf8')
      const document = await store.read('internal/url-schemes')
      expect(document.freshness).toBe('stale')
      expect(document.verdicts[0]).toMatchObject({ status: 'stale', reason: expect.stringContaining('hasHTTPPrefix in internal/url.go changed') as string })
    } finally {
      await rm(specRoot, { recursive: true, force: true })
      await rm(repoRoot, { recursive: true, force: true })
    }
  })
})
