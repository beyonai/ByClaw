// `/devflow spec` reports document health against a real provider: what is
// stale and WHICH anchor failed, what cannot be evaluated at all, and whether
// the scopes the workspace expects covered actually are. The expected set is
// discovered through the optional `devflowSpecWorkspace` service and
// overridden whole by configured `specScopes`; the report names which origin
// defined the gap list. The report is derived from the seam's existing read
// face, so no store method exists for it.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { emptyInbox } from '../../../tests/agent-double.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import FilesystemDevflowSpecStore, { ANCHORABLE_EXTENSIONS, encodeSpecFile } from '@zhchxiao123/dsh-devflow-spec-filesystem'
import type { WorkspaceLayoutResult, WorkspacePackage } from '@zhchxiao123/dsh-devflow-spec-sentinel'
import * as CommandDevflow from '@zhchxiao123/dsh-devflow-command'

const SOURCE = 'export function apply(): void {}\n'

let root: string | undefined
let specRoot: string | undefined
let repoRoot: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  for (const dir of [root, specRoot, repoRoot]) {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
  root = specRoot = repoRoot = undefined
})

function stubAgent(ctx: Context, name: string, options: { cwd?: false } = {}): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId(name)
  const session = options.cwd === false
    // A default header carries no cwd — the session that names no workspace.
    ? Session.create(id)
    : Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd: root ?? '/tmp', isSeeded: false })
  const agent: Agent = {
    id: session.id, options: {}, session,
    inbox: emptyInbox(),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return agent
}

/** Write one document straight to disk; the write path is not what is under test. */
async function seed(id: string, title: string, ...anchorFiles: string[]): Promise<void> {
  await seedAnchored(id, title, anchorFiles.map((file, index) => ({
    id: `a${String(index)}`,
    kind: 'symbol' as const,
    file,
    symbol: 'apply',
  })))
}

/** Seed one document resting on churn anchors alone. */
async function seedChurn(id: string, title: string, ...anchorFiles: string[]): Promise<void> {
  await seedAnchored(id, title, anchorFiles.map((file, index) => ({
    id: `a${String(index)}`,
    kind: 'churn' as const,
    file,
  })))
}

/**
 * Seed one document that waives scopes. It is an ordinary document in every
 * other respect — that is the whole point of carrying a waiver in one.
 */
async function seedWaiver(id: string, title: string, waives: string[], anchorFile: string): Promise<void> {
  const path = join(specRoot!, `${id}.md`)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, encodeSpecFile({
    title,
    updatedAt: '2026-09-02T00:00:00.000Z',
    waives,
    anchors: [{ id: 'a0', kind: 'symbol', file: anchorFile, symbol: 'apply' }],
    body: '## Source of truth\n\nThose scopes illustrate [[a0]] rather than deciding anything.\n',
  }), 'utf8')
}

/** Create one real member directory with source files under it. */
async function member(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(repoRoot!, name)
  await mkdir(dir, { recursive: true })
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(dir, relative)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, contents, 'utf8')
  }
  return dir
}

type SeededAnchor =
  | { id: string; kind: 'symbol'; file: string; symbol: string }
  | { id: string; kind: 'churn'; file: string }

async function seedAnchored(id: string, title: string, anchors: SeededAnchor[]): Promise<void> {
  const path = join(specRoot!, `${id}.md`)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, encodeSpecFile({
    title,
    updatedAt: '2026-09-02T00:00:00.000Z',
    anchors,
    body: `## Source of truth\n\nRests on ${anchors.map(anchor => `[[${anchor.id}]]`).join(' and ')}.\n`,
  }), 'utf8')
}

/** Workspace roots the fake layout service was asked about, reset per boot. */
const layoutCalls: string[] = []

interface BootOptions {
  spec?: boolean
  specScopes?: string[]
  layout?: WorkspacePackage[]
  /** Serves the detector-detail `discover` face beside `layout`. */
  discovered?: WorkspaceLayoutResult
  bareAgent?: boolean
}

async function boot(options: BootOptions = {}): Promise<(input: string) => Promise<CommandResult>> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-spec-cmd-'))
  layoutCalls.length = 0
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  const layout = options.layout
  const discovered = options.discovered
  if (layout !== undefined || discovered !== undefined) {
    // Only the service value matters to the census; the sentinel package that
    // publishes it in production is not under test here. A layout-only value
    // stands for a provider predating the `discover` face.
    ctx.provide('devflowSpecWorkspace', {
      layout: (workspaceRoot: string) => {
        layoutCalls.push(workspaceRoot)
        return Promise.resolve(layout ?? discovered?.packages ?? [])
      },
      ...discovered === undefined ? {} : {
        discover: (workspaceRoot: string) => {
          layoutCalls.push(workspaceRoot)
          return Promise.resolve(discovered)
        },
      },
    })
  }
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  if (options.spec === true) {
    await ctx.plugin(FilesystemDevflowSpecStore, { root: specRoot, repoRoot }).await()
  }
  await ctx.plugin(CommandDevflow, options.specScopes === undefined ? {} : { specScopes: options.specScopes }).await()
  const agent = stubAgent(ctx, `spec-health-${Math.random()}`, options.bareAgent === true ? { cwd: false } : {})
  return async (rawInput: string) => {
    const execution = await ctx.commands.execute(agent, `/devflow ${rawInput}`, [], new AbortController().signal)
    if (execution === undefined) throw new Error('the /devflow command did not resolve')
    return execution.result
  }
}

async function workspace(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-spec-cmd-'))
  specRoot = await mkdtemp(join(tmpdir(), 'dsh-devflow-spec-docs-'))
  repoRoot = await mkdtemp(join(tmpdir(), 'dsh-devflow-spec-repo-'))
  await writeFile(join(repoRoot, 'probe.ts'), SOURCE, 'utf8')
}

describe('/devflow spec', () => {
  it('says the seam is absent rather than reporting an empty document set', async () => {
    const run = await boot()
    const result = await run('spec')
    expect(result.kind).toBe('error')
    expect(result).toHaveProperty('text', expect.stringContaining('not mounted here'))
  })

  it('rejects arguments it does not take', async () => {
    const run = await boot()
    const result = await run('spec everything')
    expect(result.kind).toBe('error')
    expect(result).toHaveProperty('text', expect.stringContaining('spec takes no arguments'))
  })

  it('counts the set, names each failing anchor, and closes with an instruction', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    // Two anchors, one still resolving: only the failure is worth a line.
    await seed('pkg-a/drift', 'Drifted note', 'probe.ts', 'removed.ts')
    await seed('pkg-b/opaque', 'Shell runbook', 'deploy.sh')
    const run = await boot({ spec: true })

    const result = await run('spec')

    expect(result.kind).toBe('success')
    const text = (result as { text: string }).text
    expect(text).toContain('3 document(s) — 1 fresh, 1 stale, 1 unevaluable')
    // The roll-up alone would send a reader to re-derive what this knows.
    expect(text).toContain('stale:')
    expect(text).toContain('  pkg-a/drift — Drifted note')
    expect(text).toContain('a1 (stale): removed.ts no longer exists')
    // The anchor that still holds is not reported as a problem.
    expect(text).not.toContain('a0 (stale)')
    expect(text).toContain('unevaluable:')
    expect(text).toContain('  pkg-b/opaque — Shell runbook')
    expect(text).toContain('a0 (unevaluable):')
    // A fresh document is counted, not listed: the report is about decay.
    expect(text).not.toContain('pkg-a/contract — Tool contract')
    expect(text).toContain('Merge, retire, or write what is missing.')
  })

  it('reports an unasked coverage question as unasked, not as full coverage', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    const run = await boot({ spec: true })

    const text = (await run('spec') as { text: string }).text

    expect(text).toContain('1 document(s) — 1 fresh, 0 stale, 0 unevaluable')
    expect(text).toContain('coverage: no expected scopes configured, so gaps are not reported')
    // Nothing is decayed and nothing was asked, so there is no instruction to give.
    expect(text).not.toContain('Merge, retire')
  })

  it('names the expected scopes that no document covers', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    const run = await boot({ spec: true, specScopes: ['pkg-a', 'pkg-b', 'pkg-c'] })

    const text = (await run('spec') as { text: string }).text

    // The gap-list header became the census header: every expected scope now
    // gets a line in one of three states, so a block listing only the gaps
    // would have to repeat the scopes the census already names. The semantics
    // asserted here are unchanged — pkg-b and pkg-c report no document, pkg-a
    // does not, and the origin of the expectation is still named.
    expect(text).toContain('coverage (configured): 3 scope(s) — 1 documented, 0 waived, 2 with no document')
    expect(text).toContain('  pkg-b — no document')
    expect(text).toContain('  pkg-c — no document')
    expect(text).not.toContain('  pkg-a — no document')
    expect(text).toContain('Merge, retire, or write what is missing.')
  })

  it('confirms full coverage when every expected scope is answered', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    await seed('pkg-b', 'Whole-package note', 'probe.ts')
    const run = await boot({ spec: true, specScopes: ['pkg-a', 'pkg-b'] })

    const text = (await run('spec') as { text: string }).text

    // An exact-id match counts as covered, not only a prefixed child.
    // The one-line "every expected scope has at least one document" became the
    // census tally, which says the same thing with the count of scopes checked
    // and the origin: nothing is undocumented, so there is nothing to do.
    expect(text).toContain('coverage (configured): 2 scope(s) — 2 documented, 0 waived, 0 with no document')
    expect(text).toContain('  pkg-b — 1 document(s)')
    expect(text).not.toContain('Merge, retire')
  })

  it('discovers the expected scopes from the workspace layout when none are configured', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    const run = await boot({
      spec: true,
      layout: [
        { dir: '/ws/pkg-a', scopeId: 'pkg-a' },
        // A trailing separator, which `resolve` erases: the census must name
        // this directory the way the layout spelled it, so the assertion below
        // fails if the report ever prints a re-resolved path instead — on
        // POSIX by the missing separator, on Windows by the whole rendering.
        { dir: '/ws/pkg-b/', scopeId: 'pkg-b' },
      ],
    })

    const text = (await run('spec') as { text: string }).text

    // The layout question is asked about the invoking session's workspace.
    expect(layoutCalls).toEqual([root])
    // Same change as the configured gap list: the origin moved into the census
    // header, and the gap is now a state on the scope's own line. These member
    // directories do not exist, so the count says it could not look rather
    // than reporting zero files.
    expect(text).toContain('coverage (discovered from workspace layout): 2 scope(s) — 1 documented, 0 waived, 1 with no document')
    expect(text).toContain('  pkg-b — no document over 0 anchorable file(s) (could not read /ws/pkg-b/)')
    expect(text).not.toContain('  pkg-a — no document')
    expect(text).toContain('Merge, retire, or write what is missing.')
  })

  it('confirms discovered full coverage, counting each scope id once', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    // Two member directories under one scope id: the census asks per scope,
    // not per directory.
    const run = await boot({
      spec: true,
      layout: [
        { dir: '/ws/pkg-a', scopeId: 'pkg-a' },
        { dir: '/ws/pkg-a-extras', scopeId: 'pkg-a' },
      ],
    })

    const text = (await run('spec') as { text: string }).text

    // Tally wording as above; the fact under test is that two member
    // directories under one scope id count as one scope.
    expect(text).toContain('coverage (discovered from workspace layout): 1 scope(s) — 1 documented, 0 waived, 0 with no document')
    expect(text).not.toContain('Merge, retire')
  })

  it('names the answering detectors in the discovered origin', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    const run = await boot({
      spec: true,
      discovered: {
        packages: [
          { dir: '/ws', scopeId: 'pkg-a' },
          { dir: '/ws/frontend', scopeId: 'pkg-b' },
        ],
        detectors: ['pnpm-workspace', 'pyproject'],
      },
    })

    const text = (await run('spec') as { text: string }).text

    expect(layoutCalls).toEqual([root])
    // The detector-named origin moved into the census header with the gap list.
    expect(text).toContain('coverage (discovered via pnpm-workspace, pyproject): 2 scope(s) — 1 documented, 0 waived, 1 with no document')
    expect(text).toContain('  pkg-b — no document')
  })

  it('confirms full coverage under the detector-named origin', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    const run = await boot({
      spec: true,
      discovered: {
        packages: [{ dir: '/ws', scopeId: 'pkg-a' }],
        detectors: ['npm/yarn/bun workspaces'],
      },
    })

    const text = (await run('spec') as { text: string }).text

    expect(text).toContain('coverage (discovered via npm/yarn/bun workspaces): 1 scope(s) — 1 documented, 0 waived, 0 with no document')
  })

  it('says the expectation fell back to the repository root when no detector answered', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    const run = await boot({
      spec: true,
      discovered: { packages: [{ dir: '/ws', scopeId: 'pkg-a' }], detectors: [] },
    })

    const text = (await run('spec') as { text: string }).text

    expect(text).toContain(
      'coverage (fell back to the repository root — no workspace manifest recognized): 1 scope(s) — 1 documented, 0 waived, 0 with no document',
    )
  })

  it('reports an empty discover answer as an unasked question too', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    const run = await boot({ spec: true, discovered: { packages: [], detectors: [] } })

    const text = (await run('spec') as { text: string }).text

    expect(text).toContain('coverage: the workspace layout reported no packages, so gaps are not reported')
    expect(text).not.toContain('every expected scope')
  })

  it('marks a scope churn-only when every document under it rests on churn anchors alone', async () => {
    await workspace()
    // pkg-a: churn anchors only. pkg-b: one churn-only document beside one
    // symbol-anchored document — the scope is NOT churn-only. pkg-c: no
    // document at all — its problem is the gap list, not this footnote.
    await seedChurn('pkg-a/runbook', 'Deploy runbook', 'probe.ts')
    await seedChurn('pkg-a/layout', 'Directory layout', 'probe.ts')
    await seedChurn('pkg-b/notes', 'Churn notes', 'probe.ts')
    await seed('pkg-b/contract', 'Tool contract', 'probe.ts')
    const run = await boot({ spec: true, specScopes: ['pkg-a', 'pkg-b', 'pkg-c'] })

    const text = (await run('spec') as { text: string }).text

    expect(text).toContain('covered only by churn anchors:')
    expect(text).toContain('  pkg-a — churn-only; freshness lags commits')
    expect(text).not.toContain('pkg-b — churn-only')
    expect(text).not.toContain('pkg-c — churn-only')
    expect(text).toContain('  pkg-c')
  })

  it('omits the churn-only block when no covered scope qualifies', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    const run = await boot({ spec: true, specScopes: ['pkg-a'] })

    const text = (await run('spec') as { text: string }).text

    expect(text).not.toContain('covered only by churn anchors')
  })

  it('lets configured scopes override the discovered layout whole, not merge with it', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    const run = await boot({
      spec: true,
      specScopes: ['pkg-a'],
      layout: [
        { dir: '/ws/pkg-a', scopeId: 'pkg-a' },
        { dir: '/ws/pkg-x', scopeId: 'pkg-x' },
      ],
    })

    const text = (await run('spec') as { text: string }).text

    // Override, not union: the discovered pkg-x is deliberately not asked
    // about, and the layout service is never consulted. Tally wording as above.
    expect(layoutCalls).toEqual([])
    expect(text).toContain('coverage (configured): 1 scope(s) — 1 documented, 0 waived, 0 with no document')
    expect(text).not.toContain('pkg-x')
    // Configuration overriding discovery also gives up the counts: a scope id
    // names no directory, and the census says that rather than printing a zero.
    expect(text).toContain('no anchorable-file counts: configured scopes name ids, not directories')
  })

  it('reports an empty workspace layout as an unasked question, never as full coverage', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    const run = await boot({ spec: true, layout: [] })

    const text = (await run('spec') as { text: string }).text

    // The service returns an empty layout for both "nothing there" and a
    // warned-about resolution failure; either way "no gaps" would be a lie.
    expect(text).toContain('coverage: the workspace layout reported no packages, so gaps are not reported')
    expect(text).not.toContain('every expected scope')
  })

  it('keeps the unasked wording when the session names no workspace to discover from', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    const run = await boot({
      spec: true,
      layout: [{ dir: '/ws/pkg-a', scopeId: 'pkg-a' }],
      bareAgent: true,
    })

    const text = (await run('spec') as { text: string }).text

    // Without a session cwd there is no workspace root to resolve, so the
    // mounted layout service cannot be asked a meaningful question.
    expect(layoutCalls).toEqual([])
    expect(text).toContain('coverage: no expected scopes configured, so gaps are not reported')
  })

  it('reports an empty document set without inventing a problem', async () => {
    await workspace()
    const run = await boot({ spec: true })
    const text = (await run('spec') as { text: string }).text
    expect(text).toContain('0 document(s) — 0 fresh, 0 stale, 0 unevaluable')
  })

  it('applies its default scope list under direct application outside Loader normalization', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-spec-cmd-'))
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(FilesystemDevflowStore, { root }).await()
    await ctx.plugin(FilesystemDevflowSpecStore, { root: specRoot, repoRoot }).await()
    // `apply` directly, so schemastery never fills the omitted field in.
    await ctx.plugin({
      inject: ['commands', 'devflow'],
      apply: (child: Context) => {
        CommandDevflow.apply(child, {})
      },
    }).await()
    const agent = stubAgent(ctx, 'spec-health-direct')
    const execution = await ctx.commands.execute(agent, '/devflow spec', [], new AbortController().signal)

    expect(execution?.result).toHaveProperty('text', expect.stringContaining('no expected scopes configured'))
  })

  it('offers the subcommand in the usage line', async () => {
    const run = await boot()
    const result = await run('nonsense')
    expect(result).toHaveProperty('text', expect.stringContaining('|spec|'))
  })
})

// The census answers three different questions per scope — nobody wrote a
// document, somebody did, or somebody decided none is needed — and reports the
// anchorable-file count each answer is measured over. No count decides
// anything: "enough" is a judgement the report hands back to its reader.
describe('/devflow spec coverage census', () => {
  it('reports a documented, an undocumented, and a waived scope, each over its file count', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    await seedWaiver('pkg-a/examples-are-illustrative', 'Examples illustrate, they do not decide', ['pkg-c'], 'probe.ts')
    const dirs = [
      // A file no evaluator reads is not part of the denominator: the question
      // is how much of this scope a document could anchor.
      { dir: await member('pkg-a', { 'index.ts': SOURCE, 'nested/util.ts': SOURCE, 'README.md': '# prose\n' }), scopeId: 'pkg-a' },
      { dir: await member('pkg-b', { 'main.py': 'def apply():\n    pass\n' }), scopeId: 'pkg-b' },
      { dir: await member('pkg-c', { 'demo.go': 'package demo\n' }), scopeId: 'pkg-c' },
    ]
    const run = await boot({ spec: true, discovered: { packages: dirs, detectors: ['npm/yarn/bun workspaces'] } })

    const text = (await run('spec') as { text: string }).text

    expect(text).toContain('coverage (discovered via npm/yarn/bun workspaces): 3 scope(s) — 1 documented, 1 waived, 1 with no document')
    expect(text).toContain('  pkg-a — 2 document(s) over 2 anchorable file(s)')
    expect(text).toContain('  pkg-b — no document over 1 anchorable file(s)')
    expect(text).toContain('  pkg-c — waived by pkg-a/examples-are-illustrative over 1 anchorable file(s)')
    // The rule behind the number travels with the number.
    expect(text).toContain('It is a denominator, not a threshold')
    // pkg-b is the only gap; the waived scope is a decision already taken, and
    // listing it as work to do would quietly reopen it.
    expect(text).toContain('Merge, retire, or write what is missing.')
    expect(text).not.toContain('waiver in doubt')
  })

  it('marks a waiver in doubt when the document carrying it is no longer fresh', async () => {
    await workspace()
    await seed('pkg-a/contract', 'Tool contract', 'probe.ts')
    // The waiver rests on a symbol that has since gone; the document is stale,
    // and so is the reasoning that said pkg-b needs no document.
    await seedWaiver('pkg-a/examples-are-illustrative', 'Examples illustrate', ['pkg-b'], 'removed.ts')
    const dirs = [
      { dir: await member('pkg-a', { 'index.ts': SOURCE }), scopeId: 'pkg-a' },
      { dir: await member('pkg-b', { 'one.ts': SOURCE, 'two.ts': SOURCE }), scopeId: 'pkg-b' },
    ]
    const run = await boot({ spec: true, discovered: { packages: dirs, detectors: ['npm/yarn/bun workspaces'] } })

    const text = (await run('spec') as { text: string }).text

    expect(text).toContain('  pkg-b — waived by pkg-a/examples-are-illustrative over 2 anchorable file(s); waiver in doubt — pkg-a/examples-are-illustrative is stale')
    // The scope still counts as waived, not as a gap — but the doubt carries
    // its own instruction, because re-deciding is not the same as filling in,
    // and that instruction is where the doubt's meaning is spelled out.
    expect(text).toContain('1 waived, 0 with no document')
    expect(text).toContain(
      'A waiver in doubt is a decision to re-make, not a gap to fill: '
      + 'the reason those scopes need no document of their own rests on code that has since moved.',
    )
  })

  it('carries the doubt through an unevaluable waiver too, never as a pass', async () => {
    await workspace()
    await seedWaiver('pkg-a/waiver', 'Nothing to document', ['pkg-b'], 'deploy.sh')
    const dirs = [
      { dir: await member('pkg-a', { 'index.ts': SOURCE }), scopeId: 'pkg-a' },
      { dir: await member('pkg-b', {}), scopeId: 'pkg-b' },
    ]
    const run = await boot({ spec: true, discovered: { packages: dirs, detectors: ['npm/yarn/bun workspaces'] } })

    const text = (await run('spec') as { text: string }).text

    // A waiver nobody can evaluate is not a waiver that holds.
    expect(text).toContain('waiver in doubt — pkg-a/waiver is unevaluable')
    expect(text).toContain('  pkg-b — waived by pkg-a/waiver over 0 anchorable file(s)')
  })

  it('reports a waiver naming a scope nothing expects instead of dropping it', async () => {
    await workspace()
    await seedWaiver('pkg-a/waiver', 'Nothing to document', ['pkg-typo'], 'probe.ts')
    const run = await boot({ spec: true, specScopes: ['pkg-a', 'pkg-b'] })

    const text = (await run('spec') as { text: string }).text

    // The scope id is misspelled, or the package is gone. Either way the
    // waiver decides nothing, and silence would leave its author believing it did.
    expect(text).toContain('waived scopes nothing expects (no expectation asks about these, so the waiver decides nothing):')
    expect(text).toContain('  pkg-typo — waived by pkg-a/waiver')
    // pkg-b is still a gap: no waiver reached it.
    expect(text).toContain('  pkg-b — no document')
  })

  it('names every document waiving one scope, so a duplicate waiver is visible', async () => {
    await workspace()
    await seedWaiver('pkg-a/waiver', 'Examples illustrate', ['pkg-b'], 'probe.ts')
    await seedWaiver('pkg-a/second-opinion', 'Still nothing to document', ['pkg-b'], 'probe.ts')
    const run = await boot({ spec: true, specScopes: ['pkg-a', 'pkg-b'] })

    const text = (await run('spec') as { text: string }).text

    // Two documents speaking for one scope is not refused anywhere — but a
    // reader deciding whether to retire one has to be able to see both.
    // Index order, which is document id order.
    expect(text).toContain('  pkg-b — waived by pkg-a/second-opinion and pkg-a/waiver')
  })

  it('lets a scope\'s own document overtake a waiver naming it, and says so', async () => {
    await workspace()
    await seed('pkg-b/contract', 'Tool contract', 'probe.ts')
    await seedWaiver('pkg-a/waiver', 'Nothing to document', ['pkg-b'], 'probe.ts')
    const run = await boot({ spec: true, specScopes: ['pkg-a', 'pkg-b'] })

    const text = (await run('spec') as { text: string }).text

    // The two statements contradict each other, and the document wins: the
    // scope IS documented. Folding the waiver away silently would hide a
    // waiver its author should now retire.
    expect(text).toContain('  pkg-b — 1 document(s); also waived by pkg-a/waiver, which the document overtakes — that waiver decides nothing here')
    // Covered, not waived: the tally counts it once, on the document's side.
    expect(text).toContain('coverage (configured): 2 scope(s) — 2 documented, 0 waived, 0 with no document')
  })

  it('counts a nested scope\'s files under that scope alone', async () => {
    await workspace()
    const outer = await member('outer', { 'index.ts': SOURCE })
    const inner = await member('outer/packages/inner', { 'index.ts': SOURCE, 'deep/impl.ts': SOURCE })
    const run = await boot({
      spec: true,
      discovered: {
        // The nested member is spelled with a trailing separator: the walk
        // compares against normalized directories, so the exclusion holds for
        // any spelling of one directory rather than only the canonical one.
        packages: [{ dir: outer, scopeId: 'outer' }, { dir: inner + sep, scopeId: 'inner' }],
        detectors: ['pnpm-workspace'],
      },
    })

    const text = (await run('spec') as { text: string }).text

    // The longest expected prefix owns the files: counting inner's two files
    // under outer as well would inflate every parent scope in a monorepo.
    expect(text).toContain('  outer — no document over 1 anchorable file(s)')
    expect(text).toContain('  inner — no document over 2 anchorable file(s)')
  })

  it('skips dot directories and node_modules, and does not read .gitignore', async () => {
    await workspace()
    const dir = await member('pkg-a', {
      'index.ts': SOURCE,
      '.hidden/secret.ts': SOURCE,
      'node_modules/dep/index.ts': SOURCE,
      'src/nested/deep.ts': SOURCE,
      '.gitignore': 'src\n',
    })
    const run = await boot({ spec: true, discovered: { packages: [{ dir, scopeId: 'pkg-a' }], detectors: ['pnpm-workspace'] } })

    const text = (await run('spec') as { text: string }).text

    // index.ts and src/nested/deep.ts: the ignored `src` is counted anyway,
    // because the census does not parse .gitignore and says so.
    expect(text).toContain('  pkg-a — no document over 2 anchorable file(s)')
    expect(text).toContain('.gitignore is not read')
  })

  it('counts by the mounted provider\'s extension set rather than a list of its own', async () => {
    await workspace()
    // One file per extension the provider's evaluator registry claims, reached
    // through `ctx.devflowSpec`: adding a language to that registry moves this
    // number, and the command needs no edit for it to.
    const files = Object.fromEntries(ANCHORABLE_EXTENSIONS.map((extension, index) => [`file${String(index)}${extension}`, SOURCE]))
    const dir = await member('pkg-a', { ...files, 'notes.md': '# prose\n', 'data.json': '{}\n' })
    const run = await boot({ spec: true, discovered: { packages: [{ dir, scopeId: 'pkg-a' }], detectors: ['pnpm-workspace'] } })

    const text = (await run('spec') as { text: string }).text

    expect(ANCHORABLE_EXTENSIONS.length).toBeGreaterThan(1)
    expect(text).toContain(`  pkg-a — no document over ${String(ANCHORABLE_EXTENSIONS.length)} anchorable file(s)`)
  })

  it('says a member directory could not be read instead of counting it as empty', async () => {
    await workspace()
    const run = await boot({
      spec: true,
      discovered: { packages: [{ dir: join(repoRoot!, 'gone'), scopeId: 'pkg-a' }], detectors: ['pnpm-workspace'] },
    })

    const text = (await run('spec') as { text: string }).text

    // "0 anchorable files" would read as "this scope holds nothing", which is
    // a different fact from "the layout named a directory that is not there".
    expect(text).toContain(`  pkg-a — no document over 0 anchorable file(s) (could not read ${join(repoRoot!, 'gone')})`)
  })

  it('sums one scope\'s several member directories into one count', async () => {
    await workspace()
    const first = await member('pkg-a', { 'index.ts': SOURCE })
    const second = await member('pkg-a-extras', { 'extra.ts': SOURCE, 'more.ts': SOURCE })
    const run = await boot({
      spec: true,
      layout: [{ dir: first, scopeId: 'pkg-a' }, { dir: second, scopeId: 'pkg-a' }],
    })

    const text = (await run('spec') as { text: string }).text

    expect(text).toContain('  pkg-a — no document over 3 anchorable file(s)')
  })
})
