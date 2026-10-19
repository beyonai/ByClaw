// Gate behavior on the transition waterfall: configured edges run their
// commands through ctx.shell before the commit, a failing command vetoes with
// a bounded output summary, card overrides replace the global edge list, and
// invalid configuration fails the load.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { emptyInbox } from '../../../tests/agent-double.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowGates from '@zhchxiao123/dsh-devflow-gates'
import { injectFsAccessDenied, resetFsFaults, runWithFsFault } from '../../../tests/fs-fault'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    appendFile: (...args: Parameters<typeof actual.appendFile>) => runWithFsFault('appendFile', args[0], () => actual.appendFile(...args)),
  }
})

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

/** Scripted executor: exit codes and output keyed by command string. */
class ScriptedExecutor extends ShellExecutor {
  readonly ran: string[] = []
  readonly specs: ShellExecSpec[] = []
  constructor(
    ctx: Context,
    private readonly script: Record<string, { exitCode: number | null; stdout?: string; stderr?: string }>,
  ) {
    super(ctx)
  }

  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? '/scripted',
      timeoutMs: request.timeoutMs ?? 1000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  run(spec: ShellExecSpec): Promise<ShellRunResult> {
    this.ran.push(spec.command)
    this.specs.push(spec)
    const entry = this.script[spec.command]
    if (entry === undefined) throw new Error(`unscripted gate command: ${spec.command}`)
    return Promise.resolve({
      exitCode: entry.exitCode,
      signal: entry.exitCode === null ? 'SIGKILL' : null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: entry.stdout ?? '', truncated: false },
      stderr: { text: entry.stderr ?? '', truncated: false },
    })
  }

  start(): ShellProcess {
    throw new Error('gates never start background processes')
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  resetFsFaults()
})

async function writeCard(id: string, journalLines: string[]): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\nbody\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

const DEVELOPING = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
  '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
  '{"rev":4,"at":"t4","type":"transition","from":"ready","to":"developing"}',
]

interface Booted {
  store: FilesystemDevflowStore
  shell: ScriptedExecutor
}

async function boot(
  script: Record<string, { exitCode: number | null; stdout?: string; stderr?: string }>,
  config: DevflowGates.Config,
): Promise<Booted> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
  const ctx = new Context()
  context = ctx
  let shell!: ScriptedExecutor
  await ctx.plugin((child: Context) => {
    shell = new ScriptedExecutor(child, script)
  })
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  await ctx.plugin(DevflowGates, config).await()
  return { store: ctx.get('devflow') as FilesystemDevflowStore, shell }
}

function move(store: FilesystemDevflowStore, id: string, to: 'reviewing' | 'testing', rev: number): Promise<TransitionResult> {
  return store.transition(store.resolve({ id: DevflowCardId(id), to, expectedRevision: rev, by: HUMAN }))
}

describe('devflow-gates', () => {
  it('runs the configured edge commands and lets a green gate commit', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
    await writeCard('0001-a', DEVELOPING)
    const { store, shell } = await boot(
      { 'test-a': { exitCode: 0 }, 'lint-a': { exitCode: 0 } },
      { edges: { 'developing->reviewing': ['test-a', 'lint-a'] } },
    )
    const result = await move(store, '0001-a', 'reviewing', 4)
    expect(result.ok).toBe(true)
    expect(shell.ran).toEqual(['test-a', 'lint-a'])
  })

  it('runs gate commands in the card\'s workspace directory (the root\'s parent)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
    await writeCard('0009-w', DEVELOPING)
    const { store, shell } = await boot(
      { 'test-w': { exitCode: 0 } },
      { edges: { 'developing->reviewing': ['test-w'] } },
    )
    const result = await move(store, '0009-w', 'reviewing', 4)
    expect(result.ok).toBe(true)
    expect(shell.specs.map(spec => spec.workdir)).toEqual([dirname(resolve(root))])
  })

  it('vetoes on a failing command with the output summary in the reason, before the commit', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
    await writeCard('0002-b', DEVELOPING)
    const { store, shell } = await boot(
      { 'test-b': { exitCode: 1, stdout: '1 test failed', stderr: 'assertion error' }, 'lint-b': { exitCode: 0 } },
      { edges: { 'developing->reviewing': ['test-b', 'lint-b'] } },
    )
    const result = await move(store, '0002-b', 'reviewing', 4)
    expect(result).toMatchObject({ ok: false, code: 'vetoed' })
    const message = (result as { message: string }).message
    expect(message).toContain('gate command failed: test-b (exit 1)')
    expect(message).toContain('assertion error')
    expect(message).toContain('1 test failed')
    expect(shell.ran).toEqual(['test-b']) // later commands are not run
    const journal = await readFile(join(root, 'tasks', '0002-b', 'journal.jsonl'), 'utf8')
    expect(journal.trim().split('\n')).toHaveLength(4) // no commit
  })

  it('describes a killed gate command and an empty output', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
    await writeCard('0003-c', DEVELOPING)
    const { store } = await boot(
      { 'killed-c': { exitCode: null } },
      { edges: { 'developing->reviewing': ['killed-c'] } },
    )
    const result = await move(store, '0003-c', 'reviewing', 4)
    expect((result as { message: string }).message).toContain('killed-c (killed): no output')
  })

  it('truncates a long failure summary at the configured cap', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
    await writeCard('0004-d', DEVELOPING)
    const { store } = await boot(
      { 'noisy-d': { exitCode: 2, stdout: 'x'.repeat(500) } },
      { edges: { 'developing->reviewing': ['noisy-d'] }, maxFailureOutputChars: 100 },
    )
    const result = await move(store, '0004-d', 'reviewing', 4)
    const message = (result as { message: string }).message
    expect(message).toContain('x'.repeat(100) + '… (truncated)')
    expect(message).not.toContain('x'.repeat(101))
  })

  it('lets a card-scoped override replace the global edge list', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
    await writeCard('0005-e', DEVELOPING)
    await writeCard('0006-f', DEVELOPING)
    const { store, shell } = await boot(
      { 'global-gate': { exitCode: 0 }, 'card-gate': { exitCode: 0 } },
      {
        edges: { 'developing->reviewing': ['global-gate'] },
        cards: { '0006-f': { 'developing->reviewing': ['card-gate'] } },
      },
    )
    expect((await move(store, '0005-e', 'reviewing', 4)).ok).toBe(true)
    expect((await move(store, '0006-f', 'reviewing', 4)).ok).toBe(true)
    expect(shell.ran).toEqual(['global-gate', 'card-gate'])
  })

  it('passes ungated edges through untouched', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
    await writeCard('0007-g', DEVELOPING)
    const { store, shell } = await boot({}, { edges: { 'testing->done': ['never-run'] } })
    expect((await move(store, '0007-g', 'reviewing', 4)).ok).toBe(true)
    expect(shell.ran).toEqual([])
  })

  it.each([
    { label: 'a malformed edge key', config: { edges: { 'developing=>reviewing': ['x'] } }, message: 'invalid edge "developing=>reviewing"' },
    { label: 'an unknown stage name', config: { edges: { 'developing->shipping': ['x'] } }, message: 'invalid edge "developing->shipping"' },
    { label: 'a bad card override key', config: { cards: { '0001-a': { 'nope': ['x'] } } }, message: 'cards["0001-a"] names invalid edge "nope"' },
    { label: 'a non-positive output cap', config: { maxFailureOutputChars: 0 }, message: 'maxFailureOutputChars must be a positive integer' },
    // The directory became derived from the card's devflow root, so a config
    // still naming one is refused rather than ignored — a deployment that kept
    // the field would otherwise go on believing its logs land where it said.
    { label: 'a failureLogDir, which the gate no longer has', config: { failureLogDir: 'logs' }, message: 'failureLogDir was removed; these artifacts now live in <devflow root>/reports/gates/' },
  ])('fails the load on $label', async ({ config, message }) => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
    const ctx = new Context()
    context = ctx
    await ctx.plugin((child: Context) => { void new ScriptedExecutor(child, {}) })
    await expect(ctx.plugin(DevflowGates, config as DevflowGates.Config)).rejects.toThrow(message)
  })

  describe('human approvals', () => {
    class StubApproval extends Service {
      outcome: ApprovalOutcome = 'allowed-once'
      readonly requests: ApprovalRequest[] = []
      constructor(ctx: Context) {
        super(ctx, 'approval')
      }

      request(req: ApprovalRequest): Promise<ApprovalOutcome> {
        this.requests.push(req)
        return Promise.resolve(this.outcome)
      }
    }

    function registerAgent(ctx: Context, name: string): Agent {
      const scope = ctx.plugin(() => {})
      const id = SessionId(name)
      const session = Session.create(id)
      const value: Agent = {
        id, options: {}, session, inbox: emptyInbox(),
        status: 'idle', ctx: scope.ctx,
        followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
        runMaintenance: task => task(new AbortController().signal),
        whenIdle: () => Promise.resolve(),
      }
      ctx.agents.register(value)
      return value
    }

    interface ApprovalBoot extends Booted {
      approval: StubApproval | undefined
      agent: Agent
    }

    async function bootApproval(withApproval: boolean, config: DevflowGates.Config): Promise<ApprovalBoot> {
      root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
      const ctx = new Context()
      context = ctx
      let shell!: ScriptedExecutor
      await ctx.plugin((child: Context) => {
        shell = new ScriptedExecutor(child, { 'pre-gate': { exitCode: 0 } })
      })
      await ctx.plugin(AgentRegistry)
      let approval: StubApproval | undefined
      if (withApproval) {
        await ctx.plugin((child: Context) => {
          approval = new StubApproval(child)
        })
      }
      await ctx.plugin(FilesystemDevflowStore, { root }).await()
      await ctx.plugin(DevflowGates, config).await()
      const agent = registerAgent(ctx, 'gates-approval-agent')
      return { store: ctx.get('devflow') as FilesystemDevflowStore, shell, approval, agent }
    }

    function agentMove(boot: ApprovalBoot, id: string): Promise<TransitionResult> {
      return boot.store.transition(boot.store.resolve({
        id: DevflowCardId(id),
        to: 'ready',
        expectedRevision: 2,
        by: { kind: 'agent', session: boot.agent.session.id },
      }))
    }

    async function untilBlocked(store: FilesystemDevflowStore, id: string): Promise<void> {
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await store.read(DevflowCardId(id))).stage === 'blocked') return
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error(`card ${id} never parked blocked`)
    }

    const DESIGNING = [
      '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
      '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
    ]

    it('commits an approved move with the human signature in the journal', async () => {
      root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
      await writeCard('0101-approved', DESIGNING)
      const boot = await bootApproval(true, {
        edges: { 'designing->ready': ['pre-gate'] },
        approvals: ['designing->ready'],
      })
      const result = await agentMove(boot, '0101-approved')
      expect(result.ok).toBe(true)
      expect(boot.shell.ran).toEqual(['pre-gate']) // commands run before the human is asked
      expect(boot.approval!.requests).toHaveLength(1)
      expect(boot.approval!.requests[0]?.reason).toContain('designing->ready')
      const journal = await readFile(join(root, 'tasks', '0101-approved', 'journal.jsonl'), 'utf8')
      expect(journal).toContain('"gate":{"approvedBy":{"kind":"human"}}')
    })

    it.each([
      { outcome: 'rejected' as const, phrase: 'rejected it' },
      { outcome: 'cancelled' as const, phrase: 'withdrew the question' },
    ])('vetoes without parking when the human answered $outcome', async ({ outcome, phrase }) => {
      root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
      await writeCard('0102-denied', DESIGNING)
      const boot = await bootApproval(true, { approvals: ['designing->ready'] })
      boot.approval!.outcome = outcome
      const result = await agentMove(boot, '0102-denied')
      expect(result).toMatchObject({ ok: false, code: 'vetoed' })
      expect((result as { message: string }).message).toContain(phrase)
      expect((await boot.store.read(DevflowCardId('0102-denied'))).stage).toBe('designing')
    })

    it.each([
      { label: 'the approval seam fails closed', withApproval: true, outcome: 'unavailable' as const },
      { label: 'no approval service is composed', withApproval: false, outcome: undefined },
    ])('parks the card blocked when $label', async ({ withApproval, outcome }) => {
      root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
      await writeCard('0103-headless', DESIGNING)
      const boot = await bootApproval(withApproval, { approvals: ['designing->ready'] })
      if (boot.approval !== undefined && outcome !== undefined) boot.approval.outcome = outcome
      const result = await agentMove(boot, '0103-headless')
      expect(result).toMatchObject({ ok: false, code: 'vetoed' })
      expect((result as { message: string }).message).toContain('parked blocked')
      await untilBlocked(boot.store, '0103-headless')
      const card = await boot.store.read(DevflowCardId('0103-headless'))
      expect(card).toMatchObject({ stage: 'blocked', blockedFrom: 'designing' })
      const journal = await readFile(join(root, 'tasks', '0103-headless', 'journal.jsonl'), 'utf8')
      expect(journal).toContain('awaiting human approval for designing->ready')
      expect(journal).toContain('"by":{"kind":"command","name":"devflow-gates"}')
      // Recovery returns to the interrupted stage and re-attempts the gate.
      const recovered = await boot.store.transition(boot.store.resolve({
        id: DevflowCardId('0103-headless'),
        to: 'designing',
        expectedRevision: card.stageRevision,
        by: { kind: 'human' },
      }))
      expect(recovered.ok).toBe(true)
    })

    it('parks the card when a non-agent initiator hits an approval edge', async () => {
      root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
      await writeCard('0104-human-init', DESIGNING)
      const boot = await bootApproval(true, { approvals: ['designing->ready'] })
      const warn = vi.spyOn(context!.logger, 'warn').mockImplementation(() => {})
      const result = await boot.store.transition(boot.store.resolve({
        id: DevflowCardId('0104-human-init'),
        to: 'ready',
        expectedRevision: 2,
        by: { kind: 'human', name: 'byclaw' },
      }))
      expect(result).toMatchObject({ ok: false, code: 'vetoed' })
      await untilBlocked(boot.store, '0104-human-init')
      expect(boot.approval!.requests).toHaveLength(0)
      expect(warn).not.toHaveBeenCalled()
    })

    it('does not ask the human when a gate command already failed', async () => {
      root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
      await writeCard('0105-red-first', DESIGNING)
      const ctx = new Context()
      context = ctx
      await ctx.plugin((child: Context) => { void new ScriptedExecutor(child, { 'red-gate': { exitCode: 1, stderr: 'nope' } }) })
      await ctx.plugin(AgentRegistry)
      let approval!: StubApproval
      await ctx.plugin((child: Context) => { approval = new StubApproval(child) })
      await ctx.plugin(FilesystemDevflowStore, { root }).await()
      await ctx.plugin(DevflowGates, {
        edges: { 'designing->ready': ['red-gate'] },
        approvals: ['designing->ready'],
      }).await()
      const store = ctx.get('devflow') as FilesystemDevflowStore
      const result = await store.transition(store.resolve({
        id: DevflowCardId('0105-red-first'), to: 'ready', expectedRevision: 2, by: HUMAN,
      }))
      expect(result).toMatchObject({ ok: false, code: 'vetoed' })
      expect((result as { message: string }).message).toContain('gate command failed')
      expect(approval.requests).toHaveLength(0)
    })

    it('passes a downstream veto through unchanged after an approval', async () => {
      root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
      await writeCard('0106-downstream', DESIGNING)
      const boot = await bootApproval(true, { approvals: ['designing->ready'] })
      context!.on('devflow/transition', (_attempt, _next) => Promise.resolve({ allowed: false, reason: 'later policy says no' }))
      const result = await agentMove(boot, '0106-downstream')
      expect(result).toMatchObject({ ok: false, code: 'vetoed' })
      expect((result as { message: string }).message).toContain('later policy says no')
      expect(boot.approval!.requests).toHaveLength(1)
    })

    it('warns when the parking move itself is vetoed or fails', async () => {
      root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
      await writeCard('0107-park-vetoed', DESIGNING)
      await writeCard('0108-park-broken', DESIGNING)
      const ctx = new Context()
      context = ctx
      await ctx.plugin((child: Context) => {
        void new ScriptedExecutor(child, { 'block-gate': { exitCode: 1, stderr: 'no parking' } })
      })
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(FilesystemDevflowStore, { root }).await()
      await ctx.plugin(DevflowGates, {
        cards: { '0107-park-vetoed': { 'designing->blocked': ['block-gate'] } },
        approvals: ['designing->ready'],
      }).await()
      const store = ctx.get('devflow') as FilesystemDevflowStore
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

      // The parking move designing->blocked is itself gated red: parked.ok false.
      const vetoedPark = await store.transition(store.resolve({
        id: DevflowCardId('0107-park-vetoed'), to: 'ready', expectedRevision: 2, by: HUMAN,
      }))
      expect(vetoedPark).toMatchObject({ ok: false, code: 'vetoed' })
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to park card 0107-park-vetoed'))
      })

      // The parking append rejects at the journal write, injected through
      // tests/fs-fault.ts so the fault fires on every host OS: the rejection
      // is contained and warned.
      warn.mockClear()
      injectFsAccessDenied({ operation: 'appendFile', path: join(root, 'tasks', '0108-park-broken', 'journal.jsonl') })
      const brokenPark = await store.transition(store.resolve({
        id: DevflowCardId('0108-park-broken'), to: 'ready', expectedRevision: 2, by: HUMAN,
      }))
      expect(brokenPark).toMatchObject({ ok: false, code: 'vetoed' })
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to park card 0108-park-broken'))
      })
    })

    it('rejects an invalid approvals edge at load', async () => {
      root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
      const ctx = new Context()
      context = ctx
      await ctx.plugin((child: Context) => { void new ScriptedExecutor(child, {}) })
      await expect(ctx.plugin(DevflowGates, { approvals: ['done->never'] })).rejects.toThrow('approvals names invalid edge "done->never"')
    })
  })

  it('applies its defaults under direct application outside Loader normalization', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
    await writeCard('0009-i', DEVELOPING)
    const ctx = new Context()
    context = ctx
    let shell!: ScriptedExecutor
    await ctx.plugin((child: Context) => {
      shell = new ScriptedExecutor(child, {})
    })
    await ctx.plugin(FilesystemDevflowStore, { root }).await()
    await ctx.plugin((child: Context) => {
      DevflowGates.apply(child, {})
    })
    const store = ctx.get('devflow') as FilesystemDevflowStore
    expect((await move(store, '0009-i', 'reviewing', 4)).ok).toBe(true)
    expect(shell.ran).toEqual([])
  })

  it('unregisters its listener when the fiber disposes (HMR safety)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gates-'))
    await writeCard('0008-h', DEVELOPING)
    const ctx = new Context()
    context = ctx
    let shell!: ScriptedExecutor
    await ctx.plugin((child: Context) => {
      shell = new ScriptedExecutor(child, { 'gate-h': { exitCode: 1 } })
    })
    await ctx.plugin(FilesystemDevflowStore, { root }).await()
    const gates = ctx.plugin(DevflowGates, { edges: { 'developing->reviewing': ['gate-h'] } })
    await gates.await()
    const store = ctx.get('devflow') as FilesystemDevflowStore
    expect((await move(store, '0008-h', 'reviewing', 4)).ok).toBe(false)
    await gates.dispose()
    expect((await move(store, '0008-h', 'reviewing', 4)).ok).toBe(true)
    expect(shell.ran).toEqual(['gate-h'])
  })
})
