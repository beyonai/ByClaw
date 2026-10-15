// `/devflow doctor` against real git state, a real store, and real leases:
// what this deployment got wrong, each fault named with the object it is about
// — and, just as load-bearing, what the run could not answer at all. A report
// that rendered "could not check" as "no problem" would be worse than no
// report, so the `Not asked` section is asserted here as a primary output
// rather than as a footnote.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { emptyInbox } from '../../../tests/agent-double.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import { createDispatchPreconditionChecker } from '@zhchxiao123/dsh-devflow-worktree/dispatch'
import * as CommandDevflow from '@zhchxiao123/dsh-devflow-command'

/** The six optional planes doctor probes, by service name. */
const SERVICES = [
  'devflowArtifactStructures',
  'devflowValidators',
  'devflowSpec',
  'devflowIronRules',
  'devflowBusiness',
  'devflowMidsceneReports',
] as const

const CREATED = '{"rev":1,"at":"2026-09-01T00:00:00Z","type":"created","by":{"kind":"human"}}'
const DISPATCHED = '{"rev":2,"at":"2026-09-01T00:01:00Z","type":"artifact","stage":"draft","path":"artifacts/2-worktree.md","kind":"worktree"}'

let base: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

/** A directory under this test's own temporary base. */
async function scratch(name: string): Promise<string> {
  base ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-doctor-'))
  const dir = join(base, name)
  await mkdir(dir, { recursive: true })
  return dir
}

interface RepoOptions {
  /** Ignore rules the checkout commits; the canonical snippet by default. */
  ignore?: string[]
  /** Whether the board enters git at all. */
  board?: 'tracked' | 'untracked'
}

/** A checkout carrying whatever the test seeded, committed as one dispatch. */
async function repo(dir: string, options: RepoOptions = {}): Promise<void> {
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'doctor@example.invalid')
  git(dir, 'config', 'user.name', 'doctor')
  const ignore = options.ignore ?? (options.board === 'untracked' ? ['.devflow/'] : ['.devflow/**/claim.json'])
  await writeFile(join(dir, '.gitignore'), ignore.join('\n') + '\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'board')
}

async function writeCard(root: string, id: string, journalLines: string[]): Promise<void> {
  const dir = join(root, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

/** The dispatch artifact the `DISPATCHED` journal line registers. */
async function writeDispatch(root: string, id: string, body: string): Promise<void> {
  const dir = join(root, 'tasks', id, 'artifacts')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '2-worktree.md'), body)
}

function dispatchBody(worktree: string, id: string): string {
  return `---\nbranch: devflow/${id}\nbase: main\nworktree: ${worktree}\n---\nDispatched.\n`
}

async function writeClaim(root: string, id: string, owner: unknown, heartbeatAt: string): Promise<void> {
  await writeFile(
    join(root, 'tasks', id, 'claim.json'),
    JSON.stringify({ owner, at: '2026-09-01T00:00:00.000Z', heartbeatAt }, null, 2) + '\n',
  )
}

function stubAgent(ctx: Context, cwd: string | undefined): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId(`doctor-${Math.random()}`)
  const session = Session.create(id, undefined, cwd === undefined
    ? undefined
    : { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd, isSeeded: false })
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

interface BootOptions {
  /** The invoking session's working directory; omitted, the session names none. */
  cwd?: string
  /** The store's configured default root. */
  root?: string
  /** Mount every optional plane doctor probes. */
  services?: boolean
}

async function boot(options: BootOptions = {}): Promise<(input: string) => Promise<CommandResult>> {
  const root = options.root ?? await scratch('default-root')
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  if (options.services === true) {
    // Only the presence of each name is under test: doctor reads none of the
    // values, which is exactly why it can report six planes it does not import.
    for (const service of SERVICES) ctx.provide(service, {})
  }
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  await ctx.plugin(CommandDevflow).await()
  const agent = stubAgent(ctx, options.cwd)
  return async (rawInput: string) => {
    const execution = await ctx.commands.execute(agent, `/devflow ${rawInput}`, [], new AbortController().signal)
    if (execution === undefined) throw new Error('the /devflow command did not resolve')
    return execution.result
  }
}

/** The report text, which every case asserts against. */
async function report(options: BootOptions = {}): Promise<string> {
  const run = await boot(options)
  const result = await run('doctor')
  expect(result.kind).toBe('success')
  return (result as { text: string }).text
}

/** The four questions no composition of this line can answer. */
const FIXED_NOT_ASKED = [
  'ValidatorRegistry keeps its providers private',
  'whether the review edge carries a baseRef',
  'Which artifact kind this deployment dispatches with',
  'Only git check-ignore is asked and no ignore file is parsed',
]

describe('/devflow doctor', () => {
  it('rejects arguments it does not take and appears in the usage line', async () => {
    const run = await boot()
    const result = await run('doctor everything')
    expect(result.kind).toBe('error')
    expect(result).toHaveProperty('text', expect.stringContaining('doctor takes no arguments'))
    expect(result).toHaveProperty('text', expect.stringContaining('|spec|doctor]'))
  })

  it('says a workspace has no board rather than reporting an all-green empty one', async () => {
    const workspace = await scratch('bare')

    const text = await report({ cwd: workspace })

    expect(text).toContain(`no board at ${join(workspace, '.devflow')} — nothing has been initialized in this workspace`)
    // The absence must not read as a pass: it is an unanswered question.
    expect(text).toContain('This is an empty answer, not a clean bill of health.')
    // Nor may a section downstream of the missing board answer as if it had one.
    expect(text).toContain('not asked — see Board for why there is nothing here to read')
    expect(text).not.toContain('requires no validator')
  })

  it('names every optional plane that is not mounted instead of omitting its row', async () => {
    const text = await report({ cwd: await scratch('bare') })

    for (const service of SERVICES) expect(text).toContain(`${service} — NOT mounted`)
    // Each row names the plugin that would serve it, so "not mounted" is
    // actionable rather than a bare service name.
    expect(text).toContain('(devflow-artifact-gate: the mechanical artifact contract)')
  })

  it('names every optional plane that is mounted', async () => {
    const text = await report({ cwd: await scratch('bare'), services: true })

    for (const service of SERVICES) expect(text).toContain(`${service} — mounted`)
    expect(text).not.toContain('NOT mounted')
  })

  it('always closes with the questions it did not answer', async () => {
    const text = await report({ cwd: await scratch('bare') })

    expect(text).toContain('Not asked')
    expect(text).toContain('Each line below is a question this report did not answer. None of them is an answer of "no problem".')
    for (const line of FIXED_NOT_ASKED) expect(text).toContain(line)
  })

  it('reports a session that names no workspace as unable to locate a board', async () => {
    const text = await report()

    expect(text).toContain('the invoking session names no working directory, so this report could not locate a board')
    expect(text).toContain('Anything that needs a checkout')
    // No directory means no git, and no `.devflow` to read a policy from.
    expect(text).toContain('not asked — see Board for why there is nothing here to read')
  })

  it('states that it changed nothing', async () => {
    expect(await report()).toContain('read-only report; this command changed nothing')
  })

  it('reports each held lease with its holder and the age of its heartbeat', async () => {
    const workspace = await scratch('leases')
    const root = join(workspace, '.devflow')
    const now = Date.now()
    await writeCard(root, '0001-old', [CREATED])
    await writeCard(root, '0002-hours', [CREATED])
    await writeCard(root, '0003-fresh', [CREATED])
    await writeCard(root, '0004-future', [CREATED])
    await writeCard(root, '0005-unclaimed', [CREATED])
    const stale = '2026-09-15T07:00:08.030Z'
    await writeClaim(root, '0001-old', { kind: 'agent', session: 'session-fb9a4f32' }, stale)
    await writeClaim(root, '0002-hours', { kind: 'human', name: 'byclaw' }, new Date(now - 5 * 3_600_000).toISOString())
    await writeClaim(root, '0003-fresh', { kind: 'command' }, new Date(now - 4 * 60_000).toISOString())
    await writeClaim(root, '0004-future', { kind: 'command', name: 'devflow' }, '2999-01-01T00:00:00.000Z')

    const text = await report({ cwd: workspace, root })

    expect(text).toContain(`0001-old — held by agent session-fb9a4f32; last heartbeat ${stale} (`)
    expect(text).toMatch(/0001-old .* \(\d+d \d+h ago\)/)
    expect(text).toContain('0002-hours — held by human byclaw; last heartbeat')
    expect(text).toContain('(5h ago)')
    expect(text).toContain('0003-fresh — held by an unnamed command;')
    expect(text).toContain('(4m ago)')
    expect(text).toContain('0004-future — held by command devflow; last heartbeat 2999-01-01T00:00:00.000Z (dated in the future)')
    expect(text).not.toContain('0005-unclaimed —')
    // No age above is a verdict, and the report says why rather than inventing
    // a threshold it would then own.
    expect(text).toContain('heartbeat() has no caller on this line')
    expect(text).toContain('"/devflow takeover <id>" is what acts on the answer.')
  })

  it('reports a lease whose heartbeat is missing or unreadable as exactly that', async () => {
    const workspace = await scratch('bad-heartbeats')
    const root = join(workspace, '.devflow')
    await writeCard(root, '0001-none', [CREATED])
    await writeCard(root, '0002-garbage', [CREATED])
    await writeClaim(root, '0001-none', { kind: 'human', name: 'byclaw' }, '')
    await writeClaim(root, '0002-garbage', { kind: 'human', name: 'byclaw' }, 'yesterday-ish')

    const text = await report({ cwd: workspace, root })

    expect(text).toContain('0001-none — held by human byclaw; the lease records no heartbeat at all')
    expect(text).toContain('0002-garbage — held by human byclaw; the lease records an unreadable heartbeat (yesterday-ish)')
  })

  it('distinguishes a board with no cards from one whose cards are all free', async () => {
    const empty = await scratch('empty')
    await mkdir(join(empty, '.devflow', 'tasks'), { recursive: true })

    expect(await report({ cwd: empty, root: join(empty, '.devflow') })).toContain('no active card, so no lease')

    await context?.fiber.dispose()
    const held = await scratch('unheld')
    const root = join(held, '.devflow')
    await writeCard(root, '0001-a', [CREATED])
    await writeCard(root, '0002-b', [CREATED])

    expect(await report({ cwd: held, root })).toContain('none of the 2 active card(s) is claimed')
  })

  it('reports an untracked board in the worktree fence\'s own words', async () => {
    const workspace = await scratch('untracked')
    const root = join(workspace, '.devflow')
    await writeCard(root, '0001-a', [CREATED, DISPATCHED])
    await writeDispatch(root, '0001-a', dispatchBody(join(workspace, 'wt'), '0001-a'))
    await repo(workspace, { board: 'untracked' })

    const text = await report({ cwd: workspace, root })

    // One implementation, one wording: two accounts of one fault read as two
    // faults, so this asserts the fence's sentence rather than a copy of it.
    const veto = await createDispatchPreconditionChecker()(workspace, root, '0001-a')
    expect(veto).toBeDefined()
    expect(text).toContain(veto as string)
    expect(text).toContain('dispatch preconditions — the two questions the worktree fence asks git:')
  })

  it('frames the same fault as a prediction while no card is dispatched', async () => {
    const workspace = await scratch('predicted')
    const root = join(workspace, '.devflow')
    await writeCard(root, '0001-a', [CREATED])
    await repo(workspace, { board: 'untracked' })

    const text = await report({ cwd: workspace, root })

    expect(text).toContain('does not track its board')
    expect(text).toContain('No card is dispatched yet, so nothing is vetoed today; 0001-a stands in above for the first card that is.')
    expect(text).toContain('no active card carries a "worktree" artifact, so none is dispatched to a worktree')
  })

  it('reports an ignore rule the deployment never added', async () => {
    const workspace = await scratch('transient')
    const root = join(workspace, '.devflow')
    await writeCard(root, '0001-a', [CREATED, DISPATCHED])
    await writeDispatch(root, '0001-a', dispatchBody(join(workspace, 'wt'), '0001-a'))
    await repo(workspace, { ignore: [] })

    const text = await report({ cwd: workspace, root })

    expect(text).toContain('does not ignore process-transient card state')
  })

  it('confirms both preconditions when the deployment did the ceremony right', async () => {
    const workspace = await scratch('healthy')
    const root = join(workspace, '.devflow')
    await writeCard(root, '0001-a', [CREATED])
    await repo(workspace)

    const text = await report({ cwd: workspace, root })

    expect(text).toContain('the board is tracked and card 0001-a\'s transient state is ignored')
    expect(text).toContain(`${root} — 1 active card(s)`)
  })

  it('says the preconditions were not asked when no card exists to ask about', async () => {
    const workspace = await scratch('cardless')
    await mkdir(join(workspace, '.devflow', 'tasks'), { recursive: true })
    await repo(workspace)

    const text = await report({ cwd: workspace, root: join(workspace, '.devflow') })

    expect(text).toContain('The two dispatch preconditions. The fence asks them about one card\'s lease file, and this board holds no active card to ask about.')
    expect(text).not.toContain('dispatch preconditions — the two questions')
    // The section says so where the answer would have been; falling silent
    // there would read as "nothing to say about the board".
    expect(text).toContain('dispatch preconditions — not asked; see "Not asked" below')
  })

  it('reports a dispatch whose worktree was deleted, and one that was never linked', async () => {
    const workspace = await scratch('worktrees')
    const root = join(workspace, '.devflow')
    const live = join(workspace, 'wt-live')
    const gone = join(workspace, 'wt-gone')
    const plain = join(workspace, 'wt-plain')
    await writeCard(root, '0001-live', [CREATED, DISPATCHED])
    await writeCard(root, '0002-gone', [CREATED, DISPATCHED])
    await writeCard(root, '0003-plain', [CREATED, DISPATCHED])
    await writeDispatch(root, '0001-live', dispatchBody(live, '0001-live'))
    await writeDispatch(root, '0002-gone', dispatchBody(gone, '0002-gone'))
    await writeDispatch(root, '0003-plain', dispatchBody(plain, '0003-plain'))
    await repo(workspace)
    git(workspace, 'worktree', 'add', '-q', live, '-b', 'devflow/0001-live')
    git(workspace, 'worktree', 'add', '-q', gone, '-b', 'devflow/0002-gone')
    // Removed without `git worktree remove`: still listed, resolves to nothing.
    await rm(gone, { recursive: true, force: true })
    await mkdir(plain, { recursive: true })

    const text = await report({ cwd: workspace, root })

    expect(text).toContain(`0001-live — dispatched to ${live} on branch devflow/0001-live (base main)`)
    expect(text).toContain('ok: the path exists and git knows it as a linked worktree of this repository')
    expect(text).toContain(`0002-gone — dispatched to ${gone}`)
    expect(text).toContain('path: MISSING — nothing exists there, so the card can only be moved from the repository\'s main working tree')
    expect(text).toContain(`0003-plain — dispatched to ${plain}`)
    expect(text).toContain('path: exists, but git does not know it as a linked worktree of this repository')
  })

  it('reports a dispatch artifact that is unreadable or not a dispatch record', async () => {
    const workspace = await scratch('bad-dispatch')
    const root = join(workspace, '.devflow')
    await writeCard(root, '0001-missing', [CREATED, DISPATCHED])
    await writeCard(root, '0002-malformed', [CREATED, DISPATCHED])
    await writeDispatch(root, '0002-malformed', '---\nbranch: devflow/0002\nbase: main\n---\nno worktree field\n')
    await repo(workspace)

    const text = await report({ cwd: workspace, root })

    expect(text).toContain('0001-missing — its "worktree" artifact artifacts/2-worktree.md is registered but unreadable')
    expect(text).toContain('0002-malformed — its "worktree" artifact artifacts/2-worktree.md is not a dispatch record')
    expect(text).toContain('the fence vetoes every transition of this card')
  })

  it('reports the worktree linkage as unasked outside a git repository', async () => {
    const workspace = await scratch('no-git')
    const root = join(workspace, '.devflow')
    const there = join(workspace, 'wt-there')
    await writeCard(root, '0001-there', [CREATED, DISPATCHED])
    await writeCard(root, '0002-gone', [CREATED, DISPATCHED])
    await writeDispatch(root, '0001-there', dispatchBody(there, '0001-there'))
    await writeDispatch(root, '0002-gone', dispatchBody(join(workspace, 'wt-gone'), '0002-gone'))
    await mkdir(there, { recursive: true })

    const text = await report({ cwd: workspace, root })

    // The fence's checker admits a repository it could not ask about, which is
    // right for a fence and would be a lie here: a precondition nobody checked
    // is reported as unchecked, never as one that holds.
    expect(text).toContain('git could not answer about')
    expect(text).toContain('is unknown here, not confirmed.')
    expect(text).not.toContain('the board is tracked')
    expect(text).toContain('"git worktree list" could not be run in')
    // The path question is still answerable, so it is still answered — both
    // ways — while the linkage of the one that exists stays unclaimed.
    expect(text).toContain(`0001-there — dispatched to ${there}`)
    expect(text).not.toContain('linked worktree')
    expect(text).toContain(`0002-gone — dispatched to ${join(workspace, 'wt-gone')}`)
    expect(text).toContain('path: MISSING')
  })

  it('lists the validators project policy requires', async () => {
    const workspace = await scratch('policy')
    const root = join(workspace, '.devflow')
    await mkdir(join(root, 'tasks'), { recursive: true })
    await writeFile(join(root, 'validation.json'), JSON.stringify({
      version: 1,
      requirements: [
        { validators: ['pnpm-verify'], edges: ['developing->reviewing'], timeoutMs: 600_000 },
        { validators: ['midscene-suite', 'pnpm-build'], edges: ['reviewing->testing'], timeoutMs: 900_000 },
      ],
    }))

    const text = await report({ cwd: workspace, root })

    expect(text).toContain(`${join(root, 'validation.json')} requires:`)
    expect(text).toContain('pnpm-verify on developing->reviewing')
    expect(text).toContain('midscene-suite, pnpm-build on reviewing->testing')
    // Naming them is the whole answer available; whether any of them is
    // installed is the first line of `Not asked`.
    expect(text).toContain('ValidatorRegistry keeps its providers private')
  })

  it('reports an absent or empty policy as requiring nothing', async () => {
    const workspace = await scratch('no-policy')
    const root = join(workspace, '.devflow')
    await mkdir(join(root, 'tasks'), { recursive: true })

    expect(await report({ cwd: workspace, root })).toContain(`no ${join(root, 'validation.json')}, so project policy requires no validator`)

    await context?.fiber.dispose()
    await writeFile(join(root, 'validation.json'), JSON.stringify({ version: 1, requirements: [] }))

    expect(await report({ cwd: workspace, root })).toContain(`${join(root, 'validation.json')} declares no requirement`)
  })

  it('reports a policy file devflow-gates would reject as unread, not as empty', async () => {
    const workspace = await scratch('bad-policy')
    const root = join(workspace, '.devflow')
    await mkdir(join(root, 'tasks'), { recursive: true })
    const rejected = [
      'not json at all',
      'null',
      '3',
      JSON.stringify({ version: 2, requirements: [] }),
      JSON.stringify({ version: 1, requirements: 'all of them' }),
      JSON.stringify({ version: 1, requirements: [null] }),
      JSON.stringify({ version: 1, requirements: [{ validators: 'pnpm-verify', edges: ['a->b'] }] }),
      JSON.stringify({ version: 1, requirements: [{ validators: ['pnpm-verify'], edges: [7] }] }),
    ]
    for (const content of rejected) {
      await writeFile(join(root, 'validation.json'), content)

      const text = await report({ cwd: workspace, root })

      expect(text, content).toContain('It is present but not in the shape devflow-gates accepts')
      expect(text, content).not.toContain('requires:')
      await context?.fiber.dispose()
      context = undefined
    }
  })
})
