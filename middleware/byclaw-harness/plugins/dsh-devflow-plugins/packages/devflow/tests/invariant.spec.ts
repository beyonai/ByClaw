// The devflow event-stream invariant: per card, stage-changed revisions
// strictly increase and every notification reports an actual move. Manual
// service topology (invariant registry + companion), per testing policy.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevCard } from '@zhchxiao123/dsh-devflow'
import * as DevflowInvariantCompanion from '@zhchxiao123/dsh-devflow/invariant'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'

function card(id: string, stage: CardLocation, stageRevision: number, root = '/devflow'): DevCard {
  return {
    id: DevflowCardId(id),
    root,
    title: 'card',
    stage,
    stageRevision,
    body: '',
    path: `tasks/${id}/card.md`,
    artifacts: [],
  }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(DevflowInvariantCompanion)
  return ctx
}

describe('devflow stage-changed invariants', () => {
  it('accepts strictly increasing revisions that report real moves', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('devflow/stage-changed', card('0001-a', 'designing', 2), 'draft')
      ctx.emit('devflow/stage-changed', card('0001-a', 'ready', 3), 'designing')
      ctx.emit('devflow/stage-changed', card('0002-b', 'designing', 2), 'draft')
    }).not.toThrow()
  })

  it('rejects a notification that reports no move', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('devflow/stage-changed', card('0001-a', 'draft', 2), 'draft')
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@zhchxiao123/dsh-devflow',
    }))
  })

  it('rejects a non-increasing revision for the same card', async () => {
    const ctx = await setup()
    ctx.emit('devflow/stage-changed', card('0001-a', 'designing', 3), 'draft')
    expect(() => {
      ctx.emit('devflow/stage-changed', card('0001-a', 'ready', 3), 'designing')
    }).toThrow(/revisions must strictly increase/)
  })
})

describe('devflow card-created invariants', () => {
  it('accepts a fresh draft card at revision 1, and its later moves continue the stream', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('devflow/card-created', card('0001-a', 'draft', 1))
      ctx.emit('devflow/stage-changed', card('0001-a', 'designing', 2), 'draft')
    }).not.toThrow()
  })

  it('rejects a created card that is not a fresh draft', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('devflow/card-created', card('0001-a', 'designing', 2))
    }).toThrow(/must enter the board as "draft" at revision 1/)
  })

  it('rejects re-creating an id the stream already knows', async () => {
    const ctx = await setup()
    ctx.emit('devflow/card-created', card('0001-a', 'draft', 1))
    expect(() => {
      ctx.emit('devflow/card-created', card('0001-a', 'draft', 1))
    }).toThrow(/never reissued/)
  })

  it('accepts a breakdown one level deep and rejects a card hung under a child', async () => {
    const ctx = await setup()
    const child = (id: string, parent: string, root = '/devflow'): DevCard =>
      ({ ...card(id, 'draft', 1, root), parent: DevflowCardId(parent) })
    expect(() => {
      ctx.emit('devflow/card-created', card('0001-big', 'draft', 1))
      ctx.emit('devflow/card-created', child('0002-slice', '0001-big'))
      ctx.emit('devflow/card-created', child('0003-slice', '0001-big'))
      // The same id under another root is a different card, so hanging a card
      // under it is not the nesting this rejects.
      ctx.emit('devflow/card-created', child('0004-other', '0002-slice', '/ws-b/.devflow'))
    }).not.toThrow()
    expect(() => {
      ctx.emit('devflow/card-created', child('0005-deep', '0002-slice'))
    }).toThrow(/one level deep/)
  })

  it('tracks equal ids under different roots as different cards', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('devflow/card-created', card('0001-a', 'draft', 1, '/ws-a/.devflow'))
      ctx.emit('devflow/card-created', card('0001-a', 'draft', 1, '/ws-b/.devflow'))
      ctx.emit('devflow/stage-changed', card('0001-a', 'designing', 2, '/ws-a/.devflow'), 'draft')
      // The other root's card is still at rev 1; its move to rev 2 is legal.
      ctx.emit('devflow/stage-changed', card('0001-a', 'designing', 2, '/ws-b/.devflow'), 'draft')
    }).not.toThrow()
  })
})
