// With workspaceOnToolEnvironment `/devflow doctor` reads the board and asks
// git where the context's tool providers run, and reports the same facts it
// reports locally.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as CommandDevflow from '@zhchxiao123/dsh-devflow-command'
import { emptyInbox } from '../../../tests/agent-double.ts'
import { mountToolEnvironment } from '../../../tests/tool-environment.ts'

const CARD = '0001-a'
const JOURNAL = [
  '{"rev":1,"at":"2026-09-01T00:00:00Z","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"2026-09-01T00:01:00Z","type":"artifact","stage":"draft","path":"artifacts/2-worktree.md","kind":"worktree"}',
]

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

describe('/devflow doctor on a tool environment', () => {
  it('reads the board and asks git through the tool providers', async () => {
    base = await mkdtemp(join(tmpdir(), 'dsh-devflow-doctor-toolenv-'))
    const workspace = join(base, 'main')
    const worktree = join(base, 'wt')
    const root = join(workspace, '.devflow')
    const card = join(root, 'tasks', CARD)
    await mkdir(join(card, 'artifacts'), { recursive: true })
    await writeFile(join(card, 'card.md'), `---\ntitle: Card ${CARD}\n---\n\nBody.\n`)
    await writeFile(join(card, 'journal.jsonl'), JOURNAL.join('\n') + '\n')
    await writeFile(join(card, 'artifacts', '2-worktree.md'), `---\nbranch: devflow/${CARD}\nbase: main\nworktree: ${worktree}\n---\n`)
    await writeFile(join(workspace, '.gitignore'), '.devflow/**/claim.json\n')
    git(workspace, 'init', '-q', '-b', 'main')
    git(workspace, 'config', 'user.email', 'doctor@example.invalid')
    git(workspace, 'config', 'user.name', 'doctor')
    git(workspace, 'add', '-A')
    git(workspace, 'commit', '-qm', 'board')
    git(workspace, 'worktree', 'add', '-q', worktree, '-b', `devflow/${CARD}`)

    const ctx = new Context()
    context = ctx
    const { fs, spawns } = await mountToolEnvironment(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(FilesystemDevflowStore, { root, workspaceOnToolEnvironment: true }).await()
    await ctx.plugin(CommandDevflow, { workspaceOnToolEnvironment: true }).await()
    const scope = ctx.plugin(() => {})
    const id = SessionId('doctor-toolenv')
    const header = { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd: workspace, isSeeded: false }
    const session = Session.create(id, undefined, header)
    const agent: Agent = {
      id: session.id, options: {}, session, inbox: emptyInbox(), status: 'idle', ctx: scope.ctx,
      followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel: () => {},
      runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
    }
    ctx.agents.register(agent)

    const execution = await ctx.commands.execute(agent, '/devflow doctor', [], new AbortController().signal)
    expect(execution?.result.kind).toBe('success')
    const text = (execution?.result as { text: string }).text
    expect(text).toContain(`${root} — 1 active card(s)`)
    expect(text).toContain(`the board is tracked and card ${CARD}'s transient state is ignored`)
    expect(text).toContain(`${CARD} — dispatched to ${worktree} on branch devflow/${CARD} (base main)`)
    expect(text).toContain('ok: the path exists and git knows it as a linked worktree of this repository')
    expect(text).toContain(`no ${join(root, 'validation.json')}, so project policy requires no validator`)

    const git_ = spawns.argv.filter(argv => argv[3] === 'git').map(argv => argv[4])
    expect(git_).toEqual(expect.arrayContaining(['rev-parse', 'ls-files', 'check-ignore', 'worktree']))
    expect(fs.calls).toContain(`lstat ${root}`)
    expect(fs.calls.some(call => call.startsWith('readText ') && call.endsWith('2-worktree.md'))).toBe(true)
  })
})
