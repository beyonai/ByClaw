// The commit semantics of `.devflow` against a real git repository: the
// canonical ignore snippet in docs/devflow.md is the only copy the runbook and
// the Chinese page may carry, and a repository carrying it tracks every card
// state file while ignoring every process-transient one.
//
// Both directions are asserted because only one of them is visible when it
// breaks. A leaked lease surfaces as a card assigned to a session that never
// existed here; an ignored board surfaces as a worktree renumbering cards from
// `0001`.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { DevActor } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

/** Every document that carries the snippet; the first is the authority. */
const CARRIERS = {
  'docs/devflow.md': new URL('../docs/devflow.md', import.meta.url),
  'docs/devflow.zh.md': new URL('../docs/devflow.zh.md', import.meta.url),
  'devflow-worktree-runbook.md': new URL(
    '../packages/devflow-worktree/assets/devflow-worktree-runbook.md',
    import.meta.url,
  ),
} as const

/**
 * The pattern lines of a document's single `gitignore` fence, comments
 * dropped. A fence nested in a list item is indented, so the lines are
 * compared as the patterns they become rather than as bytes.
 */
function ignorePatterns(source: URL): string[] {
  const fences = [...readFileSync(source, 'utf8').matchAll(/```gitignore\n([\s\S]*?)```/g)]
  expect(fences).toHaveLength(1)
  return fences[0]![1]!.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

const CANONICAL = ignorePatterns(CARRIERS['docs/devflow.md'])

let base: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** Whether the repository's ignore rules cover one path. */
function ignored(cwd: string, path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], { cwd, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * A git repository carrying the canonical snippet, with the store booted
 * through the real Loader over its `.devflow`.
 */
async function repository(): Promise<Context> {
  base = await mkdtemp(join(tmpdir(), 'dsh-devflow-commit-contract-'))
  git(base, 'init', '-q', '-b', 'main')
  git(base, 'config', 'user.email', 'contract@example.invalid')
  git(base, 'config', 'user.name', 'contract')
  await writeFile(join(base, '.gitignore'), CANONICAL.join('\n') + '\n')
  const devflowRoot = join(base, '.devflow')
  await mkdir(join(devflowRoot, 'tasks'), { recursive: true })
  const configPath = join(base, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(devflowRoot)}`,
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(base).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier !== '@zhchxiao123/dsh-devflow-filesystem') throw new Error(`unexpected Loader import: ${specifier}`)
      return FilesystemDevflowStore
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('the commit semantics of `.devflow`', () => {
  it('states the ignore snippet once, and every other carrier copies it exactly', () => {
    expect(CANONICAL).toEqual([
      '.devflow/**/claim.json',
      '.devflow/**/commit.lock',
      '.devflow/midscene/operation.lock',
    ])
    for (const [label, source] of Object.entries(CARRIERS)) {
      expect({ label, patterns: ignorePatterns(source) }).toEqual({ label, patterns: CANONICAL })
    }
  })

  it('ignores every transient file a real board leaves behind and tracks every state file', async () => {
    const ctx = await repository()
    const created = await ctx.devflow.create(ctx.devflow.resolveCreate({
      title: 'Commit contract', slug: 'commit-contract', body: 'One card on a real board.\n', by: HUMAN,
    }))
    expect(created).toMatchObject({ ok: true })
    if (!created.ok) return
    const id = created.card.id
    const lease = await ctx.devflow.claim(id, HUMAN)
    expect(lease).toMatchObject({ ok: true })
    const attached = await ctx.devflow.attachArtifact({
      id, kind: 'prd', content: '## Requirements\n\nStay out of git, or stay in it.\n',
      expectedRevision: created.card.stageRevision, by: HUMAN,
    })
    expect(attached).toMatchObject({ ok: true })
    if (!attached.ok) return

    const card = join('.devflow', 'tasks', id)
    // An abandoned commit lock and a crashed settings operation's lock: both
    // outlive the process that made them, which is when the rule applies.
    await writeFile(join(base!, card, 'commit.lock'), '999999\n')
    await mkdir(join(base!, '.devflow', 'midscene', 'suites'), { recursive: true })
    await writeFile(join(base!, '.devflow', 'midscene', 'operation.lock'), '{"pid":999999}\n')
    await writeFile(join(base!, '.devflow', 'midscene', 'settings.json'), '{"version":1}\n')
    await writeFile(join(base!, '.devflow', 'midscene', 'suites', 'acceptance.json'), '{"version":1}\n')
    await writeFile(join(base!, '.devflow', 'validation.json'), '{"version":1}\n')

    const transient = [
      join(card, 'claim.json'),
      join(card, 'commit.lock'),
      join('.devflow', 'midscene', 'operation.lock'),
    ]
    const durable = [
      join(card, 'card.md'),
      join(card, 'journal.jsonl'),
      join(card, attached.record.path),
      join('.devflow', 'validation.json'),
      join('.devflow', 'midscene', 'settings.json'),
      join('.devflow', 'midscene', 'suites', 'acceptance.json'),
    ]
    expect(transient.map(path => ({ path, ignored: ignored(base!, path) })))
      .toEqual(transient.map(path => ({ path, ignored: true })))
    expect(durable.map(path => ({ path, ignored: ignored(base!, path) })))
      .toEqual(durable.map(path => ({ path, ignored: false })))

    git(base!, 'add', '-A')
    const tracked = new Set(git(base!, 'ls-files').split('\n'))
    const posix = (path: string): string => path.split(/[\\/]/).join('/')
    expect(durable.filter(path => !tracked.has(posix(path)))).toEqual([])
    expect(transient.filter(path => tracked.has(posix(path)))).toEqual([])
  })
})
