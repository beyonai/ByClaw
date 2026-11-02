// Gate facts on the committed transition entry: a permitting waterfall
// decision's recorded verdicts land as `gate.checks` beside the approval
// signature, and a decision carrying neither — including one whose checks
// list is empty — records no gate at all.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, GateCheck, JournalTransition, TransitionDecision } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function bootWithCard(id: string): Promise<FilesystemDevflowStore> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-gatechecks-'))
  const dir = join(root, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nbody\n`)
  await writeFile(join(dir, 'journal.jsonl'), '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}\n')
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx.get('devflow') as FilesystemDevflowStore
}

function augment(extras: Partial<Extract<TransitionDecision, { allowed: true }>>): void {
  context!.on('devflow/transition', async (_attempt, next: () => Promise<TransitionDecision>) => {
    const decision = await next()
    if (!decision.allowed) return decision
    return { ...decision, ...extras }
  })
}

async function committedGate(store: FilesystemDevflowStore, id: string): Promise<JournalTransition['gate'] | 'absent'> {
  const result = await store.transition(store.resolve({
    id: DevflowCardId(id), to: 'designing', expectedRevision: 1, by: HUMAN,
  }))
  expect(result.ok).toBe(true)
  const journal = await readFile(join(root!, 'tasks', id, 'journal.jsonl'), 'utf8')
  const last = JSON.parse(journal.trim().split('\n').at(-1)!) as { gate?: JournalTransition['gate'] }
  return 'gate' in last ? last.gate : 'absent'
}

describe('FilesystemDevflowStore gate checks', () => {
  it('records a checks-only decision as the entry gate, replayable through history', async () => {
    const store = await bootWithCard('0001-a')
    const checks: GateCheck[] = [{ by: { kind: 'agent', session: 'checker' }, verdict: 'allowed', summary: 'lint clean' }]
    augment({ checks })
    const gate = await committedGate(store, '0001-a')
    expect(gate).toEqual({ checks })
    const entries = await store.history(DevflowCardId('0001-a'))
    expect(entries.at(-1)).toMatchObject({ type: 'transition', gate: { checks } })
  })

  it('records the approval signature beside the checks when a decision carries both', async () => {
    const store = await bootWithCard('0002-b')
    augment({ approvedBy: HUMAN, checks: [{ by: { kind: 'agent' }, verdict: 'allowed' }] })
    expect(await committedGate(store, '0002-b')).toEqual({
      approvedBy: HUMAN,
      checks: [{ by: { kind: 'agent' }, verdict: 'allowed' }],
    })
  })

  it('records no gate for a decision whose checks list is empty', async () => {
    const store = await bootWithCard('0003-c')
    augment({ checks: [] })
    expect(await committedGate(store, '0003-c')).toBe('absent')
  })
})
