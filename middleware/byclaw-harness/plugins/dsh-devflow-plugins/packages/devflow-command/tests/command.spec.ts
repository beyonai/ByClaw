// The /devflow intervention plane: board and card views, revision-checked
// moves through the ordinary executor (gates still decide), forced lease
// takeover with its journaled eviction, and done-card archiving — all with
// the command journal actor and no model turn.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as CommandDevflow from '@zhchxiao123/dsh-devflow-command'

const AGENT: DevActor = { kind: 'agent', session: 'ses-1' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function writeCard(id: string, journalLines: string[]): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

const CREATED = '{"rev":1,"at":"2026-08-25T00:00:00Z","type":"created","by":{"kind":"human"}}'
const DONE = [
  CREATED,
  '{"rev":2,"at":"2026-08-25T00:01:00Z","type":"transition","from":"draft","to":"designing"}',
  '{"rev":3,"at":"2026-08-25T00:02:00Z","type":"transition","from":"designing","to":"ready"}',
  '{"rev":4,"at":"2026-08-25T00:03:00Z","type":"transition","from":"ready","to":"developing"}',
  '{"rev":5,"at":"2026-08-25T00:04:00Z","type":"transition","from":"developing","to":"reviewing"}',
  '{"rev":6,"at":"2026-08-25T00:05:00Z","type":"transition","from":"reviewing","to":"testing"}',
  '{"rev":7,"at":"2026-07-01T00:06:00Z","type":"transition","from":"testing","to":"done"}',
]

function stubAgent(ctx: Context, name: string, cwd?: string): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId(name)
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

/** The usage line the board appends when a root holds no cards. */
const USAGE_LINE = 'Usage: /devflow [show <id>|move <id> <stage> [reason]|takeover <id>|abandon <id> <reason>|archive [<id>]|restore <id>|archived [<YYYY-MM>|--cursor <cursor>]|spec|doctor]'

/** A runner whose store pages the archive at `pageSize`, to reach truncation. */
function bootPaged(pageSize: number): Promise<(input: string) => Promise<CommandResult>> {
  return boot({ pageSize })
}

async function boot(storeConfig: { pageSize?: number } = {}): Promise<(input: string) => Promise<CommandResult>> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(FilesystemDevflowStore, { root, ...storeConfig }).await()
  await ctx.plugin(CommandDevflow).await()
  const agent = stubAgent(ctx, `command-devflow-${Math.random()}`)
  return async (rawInput: string) => {
    const line = rawInput.length === 0 ? '/devflow' : `/devflow ${rawInput}`
    const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
    if (execution === undefined) throw new Error(`the /devflow command did not resolve for ${JSON.stringify(line)}`)
    return execution.result
  }
}

describe('/devflow', () => {
  it('reports an empty board instead of an empty message', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    const run = await boot()
    const board = await run('')
    expect(board.kind).toBe('success')
    expect(board.text).toContain('No devflow cards.')
  })

  it('renders the board, one card, and usage errors', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0001-a', [
      CREATED,
      '{"rev":2,"at":"2026-08-25T00:01:00Z","type":"artifact","stage":"draft","path":"artifacts/design.md"}',
    ])
    const run = await boot()

    const board = await run('')
    expect(board.kind).toBe('success')
    expect(board.text).toContain('0001-a [draft] rev 2 — Card 0001-a')

    const shown = await run('show 0001-a')
    expect(shown.text).toContain('artifacts: artifacts/design.md')
    expect(shown.text).toContain('Body of 0001-a.')

    expect((await run('show')).kind).toBe('error')
    expect((await run('bogus')).kind).toBe('error')
    expect((await run('move 0001-a')).kind).toBe('error')
    expect((await run('move 0001-a parked')).kind).toBe('error')
    expect((await run('takeover a b')).kind).toBe('error')
    // `archive <id>` is grammar now, so the usage error is two of them.
    expect((await run('archive a b')).kind).toBe('error')
    expect((await run('restore')).kind).toBe('error')
    expect((await run('archived 2026')).kind).toBe('error')
    expect((await run('archived 2026-09 --cursor x')).kind).toBe('error')
    expect((await run('archived --cursor')).kind).toBe('error')
  })

  it('renders the breakdown: children under their parent, orphans flat', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    const child = (parent: string): string[] =>
      [`{"rev":1,"at":"2026-08-25T00:00:00Z","type":"created","by":{"kind":"human"},"parent":"${parent}"}`]
    await writeCard('0001-big', [CREATED])
    await writeCard('0002-slice-a', child('0001-big'))
    await writeCard('0003-slice-b', child('0001-big'))
    await writeCard('0004-standalone', [CREATED])
    // Its parent never made it into the active set: the backlink still shows.
    await writeCard('0005-orphan', child('0009-archived'))
    const run = await boot()

    const board = await run('')
    expect(board.text).toBe([
      '0001-big [draft] rev 1 — Card 0001-big',
      '  0002-slice-a [draft] rev 1 — Card 0002-slice-a',
      '  0003-slice-b [draft] rev 1 — Card 0003-slice-b',
      '0004-standalone [draft] rev 1 — Card 0004-standalone',
      '0005-orphan [draft] rev 1 — Card 0005-orphan (part of 0009-archived)',
    ].join('\n'))

    const parent = await run('show 0001-big')
    expect(parent.text).toContain('sub-requirements:\n  0002-slice-a [draft] rev 1 — Card 0002-slice-a')
    const slice = await run('show 0002-slice-a')
    expect(slice.text).toContain('part of 0001-big — Card 0001-big')
    expect(slice.text).not.toContain('sub-requirements:')
    // An unreadable parent degrades to the backlink id instead of failing the view.
    expect((await run('show 0005-orphan')).text).toContain('part of 0009-archived\n')
  })

  it('moves a card through the ordinary executor with the command actor', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0002-b', [CREATED])
    const run = await boot()

    const plain = await run('show 0002-b')
    expect(plain.text).not.toContain('artifacts:')

    const moved = await run('move 0002-b designing starting design')
    expect(moved.kind).toBe('success')
    expect(moved.text).toContain('moved draft -> designing (rev 2)')
    const journal = await readFile(join(root, 'tasks', '0002-b', 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"by":{"kind":"command","name":"devflow"}')
    expect(journal).toContain('starting design')

    // The executor still enforces edges: an illegal jump reports the seam's message.
    const illegal = await run('move 0002-b done')
    expect(illegal.kind).toBe('error')
    expect(illegal.text).toContain('cannot move from "designing" to "done"')

    // Blocked recovery is an ordinary move back to the interrupted stage.
    expect((await run('move 0002-b blocked waiting')).kind).toBe('success')
    expect((await run('')).text).toContain('0002-b [blocked (from designing)]')
    const recovered = await run('move 0002-b designing resuming')
    expect(recovered.kind).toBe('success')
    expect(recovered.text).toContain('moved blocked -> designing')
  })

  it('takes over any lease with a journaled eviction that fails the stale holder CAS', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0003-c', [CREATED])
    const run = await boot()
    const store = context!.get('devflow') as FilesystemDevflowStore

    // A heartbeat from the future is treated as live, so even the forced
    // takeover reports the holder instead of evicting.
    const claimPath = join(root, 'tasks', '0003-c', 'claim.json')
    await writeFile(claimPath, JSON.stringify({
      owner: { kind: 'human', name: 'time-traveler' }, at: '2999-01-01T00:00:00Z', heartbeatAt: '2999-01-01T00:00:00Z',
    }, null, 2) + '\n')
    const refused = await run('takeover 0003-c')
    expect(refused.kind).toBe('error')
    expect(refused.text).toContain('already claimed')
    await rm(claimPath)

    const held = await store.claim(DevflowCardId('0003-c'), AGENT)
    expect(held.ok).toBe(true)
    const staleRevision = (await store.read(DevflowCardId('0003-c'))).stageRevision

    // Age the heartbeat by a tick: the takeover's staleness test is strict
    // (`age > 0`), so a same-millisecond heartbeat would still count as live.
    const live = JSON.parse(await readFile(claimPath, 'utf8')) as { owner: unknown; at: string }
    await writeFile(claimPath, JSON.stringify({ ...live, heartbeatAt: '2000-01-01T00:00:00Z' }, null, 2) + '\n')

    const taken = await run('takeover 0003-c')
    expect(taken.kind).toBe('success')
    const journal = await readFile(join(root, 'tasks', '0003-c', 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"type":"claim-expired"')
    expect(journal).toContain('"previousOwner":{"kind":"agent"')

    // The evicted holder's next commit fails the revision check.
    const staleCommit = await store.transition(store.resolve({
      id: DevflowCardId('0003-c'), to: 'designing', expectedRevision: staleRevision, by: AGENT,
    }))
    expect(staleCommit).toMatchObject({ ok: false, code: 'revision-mismatch' })
  })

  it('scopes the whole command plane to the invoking session\'s workspace root', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0006-default', [CREATED])
    await boot()
    const ctx = context!
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-ws-'))
    try {
      const wsRoot = join(workspace, '.devflow')
      const dir = join(wsRoot, 'tasks', '0001-ws-card')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'card.md'), '---\ntitle: Workspace card\n---\n\nWs body.\n')
      await writeFile(join(dir, 'journal.jsonl'), CREATED + '\n')

      const scoped = stubAgent(ctx, `command-devflow-ws-${Math.random()}`, workspace)
      const run = async (rawInput: string): Promise<CommandResult> => {
        const line = rawInput.length === 0 ? '/devflow' : `/devflow ${rawInput}`
        const execution = await ctx.commands.execute(scoped, line, [], new AbortController().signal)
        if (execution === undefined) throw new Error('the /devflow command did not resolve')
        return execution.result
      }

      const board = await run('')
      expect(board.text).toContain('0001-ws-card')
      expect(board.text).not.toContain('0006-default')

      const moved = await run('move 0001-ws-card designing')
      expect(moved.kind).toBe('success')
      await expect(readFile(join(wsRoot, 'tasks', '0001-ws-card', 'journal.jsonl'), 'utf8'))
        .resolves.toContain('"to":"designing"')

      const taken = await run('takeover 0001-ws-card')
      expect(taken.kind).toBe('success')

      // Archiving and restoring resolve the same root the move did.
      const wsDone = join(wsRoot, 'tasks', '0002-ws-done')
      await mkdir(wsDone, { recursive: true })
      await writeFile(join(wsDone, 'card.md'), '---\ntitle: Ws done\n---\n\nDone.\n')
      await writeFile(join(wsDone, 'journal.jsonl'), DONE.join('\n') + '\n')
      expect((await run('archive 0002-ws-done')).kind).toBe('success')
      expect((await run('archived')).text).toContain('0002-ws-done')
      expect((await run('restore 0002-ws-done')).kind).toBe('success')
      await expect(readFile(join(wsRoot, 'tasks', '0002-ws-done', 'journal.jsonl'), 'utf8'))
        .resolves.toContain('"type":"restored"')

      // Abandoning lands in the session's own root, not the configured default.
      const abandoned = await run('abandon 0001-ws-card superseded by the ws plan')
      expect(abandoned.kind).toBe('success')
      await expect(readFile(join(wsRoot, 'archive', new Date().toISOString().slice(0, 7), '0001-ws-card', 'journal.jsonl'), 'utf8'))
        .resolves.toContain('"type":"abandoned"')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('archives done cards by their last journal month and leaves the board', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0004-d', DONE)
    await writeCard('0005-e', [CREATED])
    const run = await boot()

    const archived = await run('archive')
    expect(archived.kind).toBe('success')
    expect(archived.text).toContain('Archived 1 card(s): 0004-d.')
    // Keyed by the month the card FINISHED in, not the month the sweep ran:
    // a sweep run long after the fact would otherwise pile every card into one
    // bucket and leave the buckets saying nothing.
    const moved = await readFile(join(root, 'archive', '2026-07', '0004-d', 'journal.jsonl'), 'utf8')
    // One line more than the card was written with: archiving commits its own
    // `archived` entry, so it is a journalled state change rather than a bare
    // directory move.
    expect(moved.trim().split('\n')).toHaveLength(8)
    const board = await run('')
    expect(board.text).toContain('0005-e')
    expect(board.text).not.toContain('0004-d')

    expect((await run('archive')).text).toBe('No done cards to archive.')
  })

  // Abandoning is a decision, so it lives on the human plane and is refused
  // without the reason that is all the record will keep.
  it('abandons a card with a reason and refuses one without', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0006-f', [CREATED])
    const run = await boot()

    const bare = await run('abandon 0006-f')
    expect(bare.kind).toBe('error')
    expect(bare.text).toContain('abandon takes a card id and a reason')

    const abandoned = await run('abandon 0006-f duplicate of 0002')
    expect(abandoned.kind).toBe('success')
    expect(abandoned.text).toContain('abandoned at draft')
    expect(abandoned.text).toContain('duplicate of 0002')
    expect(abandoned.text).toContain('not reversible')

    expect((await run('')).text).not.toContain('0006-f')
    const moved = await readFile(join(root, 'archive', new Date().toISOString().slice(0, 7), '0006-f', 'journal.jsonl'), 'utf8')
    expect(JSON.parse(moved.trim().split('\n')[1]) as unknown).toMatchObject({
      type: 'abandoned', by: { kind: 'command', name: 'devflow' }, reason: 'duplicate of 0002',
    })
  })

  it('refuses to abandon a done card', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0004-d', DONE)
    const run = await boot()
    const refused = await run('abandon 0004-d not wanted after all')
    expect(refused.kind).toBe('error')
    expect(refused.text).toContain('settled by archiving, not abandoned')
  })

  it('archives one named card and leaves the rest of the board alone', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0004-d', DONE)
    await writeCard('0005-e', DONE)
    const run = await boot()

    const filed = await run('archive 0004-d')
    expect(filed.kind).toBe('success')
    expect(filed.text).toContain('Card 0004-d archived.')
    const board = await run('')
    expect(board.text).toContain('0005-e')
    expect(board.text).not.toContain('0004-d')
  })

  // Each rejection names the next thing to do, because the code alone leaves a
  // human guessing at a plane whose whole point is deterministic intervention.
  it('says what to do about a card that cannot be archived', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0004-d', DONE)
    await writeCard('0005-open', [CREATED])
    await writeCard('0006-slice', [
      '{"rev":1,"at":"2026-08-25T00:00:00Z","type":"created","by":{"kind":"human"},"parent":"0005-open"}',
      ...DONE.slice(1),
    ])
    const run = await boot()

    const open = await run('archive 0005-open')
    expect(open.kind).toBe('error')
    expect(open.text).toContain('"draft"')

    const slice = await run('archive 0006-slice')
    expect(slice.kind).toBe('error')
    expect(slice.text).toContain('0005-open')

    await run('archive 0004-d')
    const again = await run('archive 0004-d')
    expect(again.kind).toBe('error')
    expect(again.text).toContain('already archived')
  })

  it('archives a requirement together with its finished slices and names them', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0001-req', DONE)
    await writeCard('0002-slice', [
      '{"rev":1,"at":"2026-08-25T00:00:00Z","type":"created","by":{"kind":"human"},"parent":"0001-req"}',
      ...DONE.slice(1),
    ])
    const run = await boot()

    const filed = await run('archive 0001-req')
    expect(filed.kind).toBe('success')
    expect(filed.text).toContain('0002-slice')
    expect((await run('')).text).toBe('No devflow cards.\n' + USAGE_LINE)
  })

  // Restoring returns a card to view at the stage it already had, so the reply
  // has to say that outright: a done card back on the board is not a bug.
  it('restores an archived card and says it is back at the stage it had', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0004-d', DONE)
    const run = await boot()
    await run('archive 0004-d')

    const back = await run('restore 0004-d')
    expect(back.kind).toBe('success')
    expect(back.text).toContain('"done"')
    expect(back.text).toContain('move it to a rework stage')
    expect((await run('')).text).toContain('0004-d')

    const again = await run('restore 0004-d')
    expect(again.kind).toBe('error')
    expect(again.text).toContain('on the board already')
  })

  it('refuses to restore an abandoned card and points at where to read it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0006-f', [CREATED])
    const run = await boot()
    await run('abandon 0006-f duplicate of 0002')

    const refused = await run('restore 0006-f')
    expect(refused.kind).toBe('error')
    expect(refused.text).toContain('terminal')
    expect(refused.text).toContain('/devflow archived')
  })

  it('lists the archive, tagging an abandonment apart with the reason it stopped', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0004-d', DONE)
    await writeCard('0006-f', [CREATED])
    const run = await boot()
    expect((await run('archived')).text).toBe('No archived cards.')

    await run('archive 0004-d')
    await run('abandon 0006-f duplicate of 0002')

    const listed = await run('archived')
    expect(listed.text).toContain('0004-d')
    expect(listed.text).toContain('[archived 2026-07]')
    expect(listed.text).toContain('[abandoned')
    // The index tags the two apart; the reason is a single-card fact, so it is
    // read where one card is read.
    expect(listed.text).not.toContain('duplicate of 0002')
    expect((await run('show 0006-f')).text).toContain('abandoned: duplicate of 0002')

    // The month narrows to one bucket, and an empty one says so.
    expect((await run('archived 2026-07')).text).toContain('0004-d')
    expect((await run('archived 2026-07')).text).not.toContain('0006-f')
    expect((await run('archived 2020-01')).text).toBe('No archived cards under 2020-01.')
  })

  // A truncated page that does not say how to continue reads as the whole
  // archive, so the next command is spelled out.
  // The two contention codes have nothing plane-specific to add, so they pass
  // the store's own message through rather than paraphrasing it.
  it('passes a contended archive or restore through with the store\'s message', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    await writeCard('0004-d', DONE)
    const run = await boot()
    // A rival's lock left in place is what the store reports as contention.
    await writeFile(join(root, 'tasks', '0004-d', 'commit.lock'), '999999\n')

    const contended = await run('archive 0004-d')
    expect(contended.kind).toBe('error')
    expect(contended.text).toContain('stayed locked by another commit')

    await rm(join(root, 'tasks', '0004-d', 'commit.lock'))
    await run('archive 0004-d')
    const month = '2026-07'
    await writeFile(join(root, 'archive', month, '0004-d', 'commit.lock'), '999999\n')
    const blocked = await run('restore 0004-d')
    expect(blocked.kind).toBe('error')
    expect(blocked.text).toContain('stayed locked by another commit')
  }, 60_000)

  it('spells out the next command when the archive page is cut short', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-cmd-'))
    for (const id of ['0001-a', '0002-b']) await writeCard(id, DONE)
    const run = await bootPaged(1)
    await run('archive')

    const first = await run('archived')
    expect(first.text).toContain('More: /devflow archived --cursor ')
    const cursor = (first.text as string).split('--cursor ')[1]?.trim() ?? ''
    const second = await run(`archived --cursor ${cursor}`)
    expect(second.text).toContain('0001-a')
    expect(second.text).not.toContain('More:')
  })
})
