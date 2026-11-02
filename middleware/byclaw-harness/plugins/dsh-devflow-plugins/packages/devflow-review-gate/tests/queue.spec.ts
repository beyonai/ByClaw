// The two store writes made from outside the waterfall. Both are queued and
// never awaited, so what matters is that neither turns its own failure into
// the caller's — a failed park must not mask the veto that provoked it, and a
// failed registration must not make a committed move look uncommitted.
//
// The store is stubbed rather than real: the failure branches are a rejected
// write and a refused write, neither of which a healthy store produces on
// demand.
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevCard, TransitionAttempt } from '@zhchxiao123/dsh-devflow'
import { GATE_ACTOR, queueAttach, queuePark } from '@zhchxiao123/dsh-devflow-review-gate/src/queue.ts'

const CARD: DevCard = {
  id: DevflowCardId('0001-a'),
  root: '/work/.devflow',
  title: 'Card',
  stage: 'reviewing',
  stageRevision: 5,
  serviceClass: 'standard',
}

const ATTEMPT = {
  id: DevflowCardId('0001-a'),
  root: '/work/.devflow',
  from: 'developing',
  to: 'reviewing',
  expectedRevision: 4,
} as unknown as TransitionAttempt

/** A context exposing just the store surface and logger these helpers touch. */
function stubContext(devflow: Record<string, unknown>): { ctx: Context; warnings: string[] } {
  const warnings: string[] = []
  const ctx = {
    devflow,
    get: (name: string) => name === 'devflow' ? devflow : undefined,
    logger: { warn: (line: string) => { warnings.push(line) } },
  } as unknown as Context
  return { ctx, warnings }
}

/** Let the queued promise settle; these helpers deliberately never await. */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

describe('registering the report after the move committed', () => {
  it('files it under the configured kind, at the card current revision', async () => {
    const attachArtifact = vi.fn().mockResolvedValue({ ok: true })
    const { ctx, warnings } = stubContext({ attachArtifact })
    queueAttach(ctx, CARD, { kind: 'review-report', content: '# report\n' })
    await settle()
    expect(attachArtifact).toHaveBeenCalledWith({
      id: CARD.id,
      kind: 'review-report',
      content: '# report\n',
      expectedRevision: 5,
      by: GATE_ACTOR,
      root: CARD.root,
    })
    expect(warnings).toEqual([])
  })

  it('warns rather than throwing when the store refuses the write', async () => {
    const { ctx, warnings } = stubContext({
      attachArtifact: vi.fn().mockResolvedValue({ ok: false, message: 'revision-mismatch' }),
    })
    queueAttach(ctx, CARD, { kind: 'review-report', content: '' })
    await settle()
    expect(warnings).toEqual(['devflow-review-gate: failed to attach the review report to 0001-a: revision-mismatch'])
  })

  it('warns rather than throwing when the write rejects outright', async () => {
    const { ctx, warnings } = stubContext({
      attachArtifact: vi.fn().mockRejectedValue(new Error('disk is full')),
    })
    queueAttach(ctx, CARD, { kind: 'review-report', content: '' })
    await settle()
    expect(warnings[0]).toContain('disk is full')
  })
})

describe('parking the card behind a fail-closed veto', () => {
  function parkContext(transition: ReturnType<typeof vi.fn>): ReturnType<typeof stubContext> {
    return stubContext({ transition, resolve: (request: unknown) => request })
  }

  it('moves the card to blocked, naming the fault in the reason', async () => {
    const transition = vi.fn().mockResolvedValue({ ok: true })
    const { ctx, warnings } = parkContext(transition)
    queuePark(ctx, ATTEMPT, 'developing->reviewing', 'ocr is not installed')
    await settle()
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({
      id: ATTEMPT.id,
      to: 'blocked',
      expectedRevision: 4,
      by: GATE_ACTOR,
      reason: 'code review for developing->reviewing failed closed: ocr is not installed',
    }))
    expect(warnings).toEqual([])
  })

  it('warns rather than throwing when the parking move is refused', async () => {
    const { ctx, warnings } = parkContext(vi.fn().mockResolvedValue({ ok: false, message: 'revision-mismatch' }))
    queuePark(ctx, ATTEMPT, 'developing->reviewing', 'ocr is not installed')
    await settle()
    expect(warnings).toEqual(['devflow-review-gate: failed to park card 0001-a blocked: revision-mismatch'])
  })

  it('warns rather than throwing when the parking move rejects outright', async () => {
    const { ctx, warnings } = parkContext(vi.fn().mockRejectedValue(new Error('store is gone')))
    queuePark(ctx, ATTEMPT, 'developing->reviewing', 'ocr is not installed')
    await settle()
    expect(warnings[0]).toContain('store is gone')
  })
})
