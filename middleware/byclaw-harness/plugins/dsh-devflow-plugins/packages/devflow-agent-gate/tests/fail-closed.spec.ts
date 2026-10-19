// The gate's failure semantics, which matter more than its checks: every way
// the checker can fail to actually run — provider missing, runtime missing,
// dispatch rejection, timeout, abnormal exit, unparsable verdict — vetoes the
// move AND parks the card blocked, never admitting by default; recovery from
// blocked re-attempts the same gate cleanly once the fault is repaired.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider, SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowAgentGate from '@zhchxiao123/dsh-devflow-agent-gate'
import { allowReply, checkerProvider, checkerReply } from './checker-provider'
import type { CheckerCall } from './checker-provider'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const MODEL_ROUTE = { provider: 'test-provider', model: 'test-model' }

const AT_DESIGNING = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
]

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function writeCard(id: string): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'journal.jsonl'), AT_DESIGNING.join('\n') + '\n')
}

interface BootOptions {
  provider?: SubagentProvider
  checkTimeoutMs?: number
  withRuntime?: boolean
}

interface Booted {
  ctx: Context
  store: FilesystemDevflowStore
}

async function boot(options: BootOptions = {}): Promise<Booted> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-fail-'))
  const ctx = new Context()
  context = ctx
  if (options.withRuntime !== false) {
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentDefaultModelConfig, MODEL_ROUTE)
    await ctx.plugin(SubagentRuntime)
    if (options.provider !== undefined) ctx.subagents.registerProvider(options.provider)
  }
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  await ctx.plugin(DevflowAgentGate, {
    edges: { 'designing->ready': { provider: 'checker', prompt: 'Judge the card.' } },
    ...options.checkTimeoutMs === undefined ? {} : { checkTimeoutMs: options.checkTimeoutMs },
  }).await()
  return { ctx, store: ctx.get('devflow') as FilesystemDevflowStore }
}

function move(store: FilesystemDevflowStore, id: string, to: CardLocation, expectedRevision: number): Promise<TransitionResult> {
  return store.transition(store.resolve({
    id: DevflowCardId(id), to, expectedRevision, by: HUMAN,
  }))
}

async function expectFailedClosed(booted: Booted, id: string, fault: string): Promise<void> {
  const blocked = Promise.withResolvers<undefined>()
  const stop = booted.ctx.on('devflow/stage-changed', (card) => {
    if (card.id === id && card.stage === 'blocked') blocked.resolve(undefined)
  })
  const result = await move(booted.store, id, 'ready', 2)
  expect(result).toMatchObject({ ok: false, code: 'vetoed' })
  if (result.ok) throw new Error('expected a veto')
  expect(result.message).toContain('agent check for designing->ready could not run')
  expect(result.message).toContain(fault)
  expect(result.message).toContain('parked blocked')
  await blocked.promise
  stop()
  const card = await booted.store.read(DevflowCardId(id))
  expect(card).toMatchObject({ stage: 'blocked', blockedFrom: 'designing' })
  const journal = await readFile(join(root!, 'tasks', id, 'journal.jsonl'), 'utf8')
  expect(journal).toContain('agent check for designing->ready failed closed')
  expect(journal).toContain('"by":{"kind":"command","name":"devflow-agent-gate"}')
}

describe('devflow-agent-gate fails closed', () => {
  it('fails closed when the configured subagent provider is not registered: veto and the card parks blocked', async () => {
    const booted = await boot()
    await writeCard('0101-no-provider')
    await expectFailedClosed(booted, '0101-no-provider', 'subagent provider "checker" is not registered')
  })

  it('fails closed when the checker dispatch rejects: veto and the card parks blocked', async () => {
    const booted = await boot({
      provider: {
        name: 'checker',
        capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start: () => Promise.reject(new Error('spawn backend down')),
      },
    })
    await writeCard('0102-start-rejects')
    await expectFailedClosed(booted, '0102-start-rejects', 'spawn backend down')
  })

  it('fails closed when the checker exceeds checkTimeoutMs: veto and the card parks blocked', async () => {
    const calls: CheckerCall[] = []
    const booted = await boot({
      provider: checkerProvider({ replies: ['hang'] }, calls),
      checkTimeoutMs: 25,
    })
    await writeCard('0103-timeout')
    await expectFailedClosed(booted, '0103-timeout', 'the checker exceeded checkTimeoutMs (25ms)')
    // The overrun child is not leaked: the gate aborted and disposed it.
    expect(calls).toHaveLength(1)
    expect(calls[0].signal.aborted).toBe(true)
    expect(calls[0].disposed()).toBe(true)
  })

  it('fails closed when the checker verdict cannot be parsed: veto and the card parks blocked', async () => {
    const booted = await boot({
      provider: checkerProvider({ replies: [checkerReply('I looked at it and it seems fine, go ahead.')] }, []),
    })
    await writeCard('0104-unparsable')
    await expectFailedClosed(booted, '0104-unparsable', 'the checker replied without a parsable verdict block')
  })

  it('fails closed when the subagent runtime itself is not composed', async () => {
    const booted = await boot({ withRuntime: false })
    await writeCard('0105-no-runtime')
    await expectFailedClosed(booted, '0105-no-runtime', 'the subagent runtime is not composed')
  })

  it.each([
    {
      label: 'with the provider diagnostic',
      reply: { output: [], stopReason: 'error', diagnostic: 'model transport failed' } satisfies SubagentResult,
      fault: 'the checker ended with error: model transport failed',
    },
    {
      label: 'without a diagnostic',
      reply: { output: [], stopReason: 'refusal' } satisfies SubagentResult,
      fault: 'the checker ended with refusal',
    },
  ])('fails closed when the checker exits abnormally, $label', async ({ reply, fault }) => {
    const booted = await boot({ provider: checkerProvider({ replies: [reply] }, []) })
    await writeCard('0106-abnormal')
    await expectFailedClosed(booted, '0106-abnormal', fault)
  })

  it('disposes a child whose start only settles after the deadline', async () => {
    let settled: CheckerRunStub | undefined
    const booted = await boot({
      checkTimeoutMs: 20,
      provider: {
        name: 'checker',
        capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start: () => new Promise<SubagentRun>((resolve) => {
          setTimeout(() => {
            settled = lateRun()
            resolve(settled.run)
          }, 60)
        }),
      },
    })
    await writeCard('0107-late-start')
    await expectFailedClosed(booted, '0107-late-start', 'the checker exceeded checkTimeoutMs (20ms)')
    await vi.waitFor(() => {
      expect(settled).toBeDefined()
      expect(settled!.disposed).toBe(true)
    })
  })

  it('recovers cleanly: repairing the fault and unblocking the card lets the same gate admit the retry', async () => {
    const booted = await boot() // the provider is missing at first
    await writeCard('0108-recovery')
    await expectFailedClosed(booted, '0108-recovery', 'subagent provider "checker" is not registered')

    // Repair: the provider registers; a human returns the card to its stage.
    const calls: CheckerCall[] = []
    booted.ctx.subagents.registerProvider(checkerProvider({ replies: [allowReply('all good')] }, calls))
    const blocked = await booted.store.read(DevflowCardId('0108-recovery'))
    expect(await move(booted.store, '0108-recovery', 'designing', blocked.stageRevision)).toMatchObject({ ok: true })

    const recovered = await booted.store.read(DevflowCardId('0108-recovery'))
    expect(await move(booted.store, '0108-recovery', 'ready', recovered.stageRevision)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
  })

  it('warns when the parking move is itself vetoed downstream, keeping the original veto', async () => {
    const booted = await boot()
    await writeCard('0109-park-vetoed')
    const warn = vi.spyOn(booted.ctx.logger, 'warn').mockImplementation(() => {})
    booted.ctx.on('devflow/transition', (attempt, next) =>
      attempt.to === 'blocked' ? Promise.resolve({ allowed: false, reason: 'no parking here' }) : next())

    const result = await move(booted.store, '0109-park-vetoed', 'ready', 2)
    expect(result).toMatchObject({ ok: false, code: 'vetoed' })
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to park card 0109-park-vetoed'))
    })
    expect((await booted.store.read(DevflowCardId('0109-park-vetoed'))).stage).toBe('designing')
  })
})

interface CheckerRunStub {
  run: SubagentRun
  disposed: boolean
}

function lateRun(): CheckerRunStub {
  const stub: CheckerRunStub = {
    disposed: false,
    run: {
      id: SessionId('late-checker-child'),
      localAgent: undefined,
      result: new Promise<SubagentResult>(() => {}),
      dispose: () => {
        stub.disposed = true
        return Promise.resolve()
      },
    },
  }
  return stub
}
