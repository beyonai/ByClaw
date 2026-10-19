// The gate's event-stream invariant: no card settles at `done` while a child
// the stream has seen sits anywhere else. Manual service topology (invariant
// registry + companion), per testing policy.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevCard } from '@zhchxiao123/dsh-devflow'
import * as ParentGateInvariantCompanion from '@zhchxiao123/dsh-devflow-parent-gate/invariant'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'

function card(id: string, stage: CardLocation, parent?: string, root = '/devflow'): DevCard {
  return {
    id: DevflowCardId(id),
    root,
    title: 'card',
    stage,
    stageRevision: 2,
    ...parent === undefined ? {} : { parent: DevflowCardId(parent) },
    body: '',
    path: `tasks/${id}/card.md`,
    artifacts: [],
  }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ParentGateInvariantCompanion)
  return ctx
}

describe('devflow-parent-gate invariant', () => {
  it('accepts a parent settling after its children, and childless cards at any time', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('devflow/card-created', { ...card('0001-big', 'draft'), stageRevision: 1 })
      ctx.emit('devflow/card-created', { ...card('0002-slice', 'draft', '0001-big'), stageRevision: 1 })
      ctx.emit('devflow/stage-changed', card('0002-slice', 'done', '0001-big'), 'testing')
      ctx.emit('devflow/stage-changed', card('0001-big', 'done'), 'testing')
      // A card the stream never saw a child for settles freely.
      ctx.emit('devflow/stage-changed', card('0003-standalone', 'done'), 'testing')
      // Another root's same-id child does not hold this parent open.
      ctx.emit('devflow/card-created', { ...card('0004-slice', 'draft', '0005-elsewhere', '/ws-b/.devflow'), stageRevision: 1 })
      ctx.emit('devflow/stage-changed', card('0005-elsewhere', 'done'), 'testing')
    }).not.toThrow()
  })

  it('rejects a parent settling while a sub-requirement is open', async () => {
    const ctx = await setup()
    ctx.emit('devflow/card-created', { ...card('0002-slice', 'draft', '0001-big'), stageRevision: 1 })
    ctx.emit('devflow/stage-changed', card('0002-slice', 'blocked', '0001-big'), 'developing')
    expect(() => {
      ctx.emit('devflow/stage-changed', card('0001-big', 'done'), 'testing')
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@zhchxiao123/dsh-devflow-parent-gate',
    }))
  })
})
