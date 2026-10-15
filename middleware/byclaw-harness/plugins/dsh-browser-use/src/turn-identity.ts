import type { BrowserLeaseOwner } from './lease-manager.js'

export interface BrowserTurnSession {
  readonly id: unknown
}

export interface BrowserTurnAgent<Session extends BrowserTurnSession = BrowserTurnSession> {
  readonly id: unknown
  readonly session: Session
}

export interface TurnBoundaryProjectionSource<Session extends BrowserTurnSession = BrowserTurnSession> {
  stateOf(session: Session, key: 'turnBoundary'): unknown
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0)
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Derive one private lease owner from DSH's live Agent and durable open-turn projection.
 * Model arguments, tool call ids, and caller-supplied lease values are deliberately absent.
 */
export function deriveBrowserTurnOwner<Session extends BrowserTurnSession>(
  agent: BrowserTurnAgent<Session> | undefined,
  projections: TurnBoundaryProjectionSource<Session>,
): BrowserLeaseOwner {
  if (!agent
    || !nonEmptyString(agent.id)
    || !agent.session
    || !nonEmptyString(agent.session.id)) {
    throw new Error('browser-turn-agent-invalid')
  }

  const state = projections.stateOf(agent.session, 'turnBoundary')
  if (state === undefined) throw new Error('browser-turn-unavailable')
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('browser-turn-projection-invalid')
  }
  const projection = state as Record<string, unknown>
  if (projection.openTurnStartSeq === null) throw new Error('browser-turn-unavailable')
  if (!nonNegativeSafeInteger(projection.openTurnStartSeq)
    || !positiveSafeInteger(projection.lastTurn)) {
    throw new Error('browser-turn-projection-invalid')
  }

  return Object.freeze({
    agentId: agent.id,
    sessionId: agent.session.id,
    turn: projection.lastTurn,
    openTurnStartSeq: projection.openTurnStartSeq,
  })
}
