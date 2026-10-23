// With workspaceOnToolEnvironment the spec store writes, lists, reads, and
// evaluates through the context's tool providers — anchored sources through
// ctx.fs, churn through git on ctx.subprocess — and reaches the same verdicts.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SpecStore from '@zhchxiao123/dsh-devflow-spec-filesystem'
import { mountToolEnvironment } from '../../../tests/tool-environment.ts'

const SOURCE = 'export function isLegal(from: string): boolean { return from !== "done" }\n'
const BODY = '## Source of truth\n\nThe predicate [[a1]] decides edge legality.\n'

let base: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

describe('the spec store on a tool environment', () => {
  it('writes, replaces, reads, and evaluates through the tool providers', async () => {
    base = await mkdtemp(join(tmpdir(), 'spec-toolenv-'))
    const repoRoot = join(base, 'repo')
    const specRoot = join(repoRoot, '.devflow', 'spec')
    await mkdir(join(repoRoot, 'src'), { recursive: true })
    await writeFile(join(repoRoot, 'src', 'stages.ts'), SOURCE)
    execFileSync('git', ['init', '-q'], { cwd: repoRoot })
    execFileSync('git', ['add', 'src/stages.ts'], { cwd: repoRoot })
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'add'], { cwd: repoRoot })

    context = new Context()
    const { fs, spawns } = await mountToolEnvironment(context)
    await context.plugin(SpecStore, { root: specRoot, repoRoot, workspaceOnToolEnvironment: true })
    const store = context.get('devflowSpec') as InstanceType<typeof SpecStore>

    const anchors = [{ id: 'a1', kind: 'symbol' as const, file: 'src/stages.ts', symbol: 'isLegal' }]
    expect(await store.write(store.resolveWrite({ id: 'guides/old', title: 'Old', body: BODY, anchors }))).toMatchObject({ ok: true })
    const merged = await store.write(store.resolveWrite({ id: 'guides/edges', title: 'Edges', body: BODY, anchors, replaces: ['guides/old'] }))
    expect(merged).toMatchObject({ ok: true, replaced: ['guides/old'], document: { freshness: 'fresh' } })
    expect(await readFile(join(specRoot, 'guides', 'edges.md'), 'utf8')).toContain('symbol: isLegal')
    expect((await store.list()).map(summary => summary.id)).toEqual(['guides/edges'])

    const document = await store.read('guides/edges')
    expect(document.verdicts).toEqual([{ id: 'a1', status: 'fresh' }])
    await writeFile(join(repoRoot, 'src', 'stages.ts'), SOURCE.replace('isLegal', 'isPermitted'))
    expect((await store.read('guides/edges')).freshness).toBe('stale')

    await writeFile(join(specRoot, 'guides', 'churn.md'), [
      '---', 'title: Churn', 'updatedAt: 2000-01-01T00:00:00.000Z', 'anchors:', '  - id: a1', '    kind: churn', '    file: src/stages.ts', '---', '', BODY,
    ].join('\n'))
    expect(await store.evaluate('guides/churn')).toEqual([expect.objectContaining({ id: 'a1', status: 'stale' })])

    expect(fs.calls.some(call => call === `readText ${join(repoRoot, 'src', 'stages.ts')}`)).toBe(true)
    expect(spawns.argv.filter(argv => argv[3] === 'git').map(argv => argv[4])).toEqual(['rev-parse', 'log'])
    expect(spawns.argv.map(argv => argv[4])).toEqual(expect.arrayContaining(['mkdirp', 'rename', 'rm']))
  })
})
