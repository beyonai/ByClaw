// The Python evaluator: what counts as a top-level declaration, and which
// formatting dimensions must not move a content hash. As with the TypeScript
// cases, a hash that moves on a black run would mark every anchor stale at
// once and train everyone to ignore the signal, and one that survives a
// statement changing blocks protects nothing — in Python the block IS the
// meaning, which is the case naive whitespace collapse gets wrong.
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SpecStore from '@zhchxiao123/dsh-devflow-spec-filesystem'
import { pythonEvaluator } from '../src/evaluators/python.ts'
import { evaluatorFor } from '../src/evaluators/registry.ts'

async function hashOf(source: string, symbol: string): Promise<string | undefined> {
  return (await pythonEvaluator.lookup(source, symbol)).hash
}

async function declared(source: string, symbol: string): Promise<boolean> {
  return (await pythonEvaluator.lookup(source, symbol)).declared
}

const ORIGINAL = `def send_email(
    *,
    email_to: str,
    subject: str = "",
) -> None:
    # For the type checker.
    message = build(email_to, subject)
    dispatch(message)
`

describe('normalization', () => {
  it('survives a black rewrap: signature on one line, magic trailing comma gone, comment dropped', async () => {
    const rewrapped = `def send_email(*, email_to: str, subject: str = "") -> None:
    message = build(email_to, subject)
    dispatch(message)
`
    await expect(hashOf(rewrapped, 'send_email')).resolves.toBe(await hashOf(ORIGINAL, 'send_email'))
  })

  it('survives a call or list exploding onto multiple lines with the trailing comma black adds', async () => {
    await expect(hashOf('x = f(\n    a,\n    b,\n)\n', 'x')).resolves.toBe(await hashOf('x = f(a, b)\n', 'x'))
    await expect(hashOf('y = [\n    1,\n    2,\n]\n', 'y')).resolves.toBe(await hashOf('y = [1, 2]\n', 'y'))
  })

  it('moves when a statement changes blocks, even though the token sequence does not', async () => {
    const guarded = 'def f(o):\n    if o.a:\n        o.b = 1\n    o.c = 2\n'
    const moved = 'def f(o):\n    if o.a:\n        o.b = 1\n        o.c = 2\n'
    await expect(hashOf(guarded, 'f')).resolves.not.toBe(await hashOf(moved, 'f'))
  })

  it('keeps a tuple\'s comma, which is meaning rather than formatting', async () => {
    await expect(hashOf('x = (1,)\n', 'x')).resolves.not.toBe(await hashOf('x = (1)\n', 'x'))
  })

  it('does not mistake a # inside a string literal for a comment', async () => {
    const withComment = 'ANCHOR = "https://example.com/page#section"  # trailing comment\n'
    await expect(hashOf(withComment, 'ANCHOR')).resolves.toBe(await hashOf('ANCHOR = "https://example.com/page#section"\n', 'ANCHOR'))
    await expect(hashOf(withComment, 'ANCHOR')).resolves.not.toBe(await hashOf('ANCHOR = "https://example.com/page"\n', 'ANCHOR'))
  })

  it('keeps the docstring in the hash: __doc__ makes it runtime-observable', async () => {
    const original = 'def f():\n    """Original words."""\n    return 1\n'
    const reworded = 'def f():\n    """Different words."""\n    return 1\n'
    await expect(hashOf(original, 'f')).resolves.not.toBe(await hashOf(reworded, 'f'))
  })

  it('does not normalize quote style, the same acceptance the TypeScript evaluator makes', async () => {
    await expect(hashOf("NAME = 'x'\n", 'NAME')).resolves.not.toBe(await hashOf('NAME = "x"\n', 'NAME'))
  })
})

describe('symbol lookup', () => {
  it('finds each of the declaration forms a spec cites', async () => {
    await expect(declared('def f():\n    pass\n', 'f')).resolves.toBe(true)
    await expect(declared('async def g():\n    pass\n', 'g')).resolves.toBe(true)
    await expect(declared('class C:\n    pass\n', 'C')).resolves.toBe(true)
    await expect(declared('LIMIT = 10\n', 'LIMIT')).resolves.toBe(true)
    await expect(declared('LIMIT: int = 10\n', 'LIMIT')).resolves.toBe(true)
  })

  it('finds a decorated definition by its inner name and hashes the decorator with it', async () => {
    await expect(declared('@dataclass\nclass C:\n    pass\n', 'C')).resolves.toBe(true)
    // A decorator changes behavior, so swapping it must move the hash.
    await expect(hashOf('@aa\ndef f():\n    pass\n', 'f')).resolves.not.toBe(await hashOf('@bb\ndef f():\n    pass\n', 'f'))
  })

  it('resolves a re-bound name to its first declaration', async () => {
    await expect(hashOf('LIMIT = 1\nLIMIT = 2\n', 'LIMIT')).resolves.toBe(await hashOf('LIMIT = 1\n', 'LIMIT'))
  })

  it('claims none of the forms that declare no single top-level name', async () => {
    await expect(declared('from pathlib import Path\n', 'Path')).resolves.toBe(false)
    await expect(declared('count = 0\ncount += 1\n', 'total')).resolves.toBe(false)
    await expect(declared('a, b = 1, 2\n', 'a')).resolves.toBe(false)
    await expect(declared('alias = target = 1\n', 'alias')).resolves.toBe(false)
    await expect(declared('alias = target = 1\n', 'target')).resolves.toBe(false)
    await expect(declared('def outer():\n    def inner():\n        pass\n', 'inner')).resolves.toBe(false)
    await expect(declared('if X:\n    def guarded():\n        pass\n', 'guarded')).resolves.toBe(false)
    await expect(declared('configure()\n', 'configure')).resolves.toBe(false)
  })

  it('reports a symbol it cannot find rather than hashing the whole file', async () => {
    await expect(pythonEvaluator.lookup('def f():\n    pass\n', 'g')).resolves.toEqual({ declared: false, hash: undefined })
  })

  it('still finds what the parser can reach in a file that no longer parses cleanly', async () => {
    const broken = 'def good():\n    pass\n\ndef broken(\n'
    await expect(declared(broken, 'good')).resolves.toBe(true)
    await expect(declared(broken, 'broken')).resolves.toBe(false)
  })

  it('claims .pyi stubs through the registry', () => {
    expect(evaluatorFor('app/types.pyi')).toBe(pythonEvaluator)
  })
})

describe('the fastapi-template sample', () => {
  // tests/fixtures/utils.py is a verbatim read-only copy of the sample
  // repository's backend/app/utils.py (full-stack-fastapi-template, MIT; the
  // upstream file carries no per-file header to retain); the expected names are
  // the PoC's enumeration of it.
  const fixture = readFile(join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/utils.py'), 'utf8')

  it('declares every top-level symbol the PoC enumerated, and nothing imported', async () => {
    const source = await fixture
    for (const symbol of [
      'logger',
      'EmailData',
      'render_email_template',
      'send_email',
      'generate_test_email',
      'generate_reset_password_email',
      'generate_new_account_email',
      'generate_password_reset_token',
      'verify_password_reset_token',
    ]) {
      await expect(pythonEvaluator.lookup(source, symbol)).resolves
        .toMatchObject({ declared: true, hash: expect.stringMatching(/^sha1:[0-9a-f]{40}$/) as string })
    }
    await expect(declared(source, 'Template')).resolves.toBe(false)
    await expect(declared(source, 'settings')).resolves.toBe(false)
  })
})

describe('composed through the store', () => {
  it('reports a document stale once its anchored Python symbol changes', async () => {
    const specRoot = await mkdtemp(join(tmpdir(), 'spec-python-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'spec-python-repo-'))
    try {
      await mkdir(join(repoRoot, 'app'), { recursive: true })
      await writeFile(join(repoRoot, 'app/utils.py'), ORIGINAL, 'utf8')
      const ctx = new Context()
      await ctx.plugin(SpecStore, { root: specRoot, repoRoot })
      const store = ctx.get('devflowSpec') as InstanceType<typeof SpecStore>

      const written = await store.write(store.resolveWrite({
        id: 'backend/email',
        title: 'Email delivery',
        body: '## Source of truth\n\nThe helper [[a1]] renders and dispatches the message.\n',
        anchors: [{ id: 'a1', kind: 'content-hash', file: 'app/utils.py', symbol: 'send_email' }],
      }))
      expect(written).toMatchObject({ ok: true, document: { freshness: 'fresh' } })
      expect(await readFile(join(specRoot, 'backend/email.md'), 'utf8')).toMatch(/hash: sha1:[0-9a-f]{40}/)

      await writeFile(join(repoRoot, 'app/utils.py'), ORIGINAL.replace('dispatch(message)', 'queue(message)'), 'utf8')
      const document = await store.read('backend/email')
      expect(document.freshness).toBe('stale')
      expect(document.verdicts[0]).toMatchObject({ status: 'stale', reason: expect.stringContaining('send_email in app/utils.py changed') as string })
    } finally {
      await rm(specRoot, { recursive: true, force: true })
      await rm(repoRoot, { recursive: true, force: true })
    }
  })
})
