/**
 * Journal decoding and replay for the devflow seam. The journal is the
 * authoritative card history; the card file's frontmatter is a rebuildable
 * projection. Both the filesystem provider and the invariant companion fold
 * entries through this module so every consumer derives identical state.
 * @module @zhchxiao123/dsh-devflow/src/journal
 */

import { DEFAULT_SERVICE_CLASS, DEV_STAGES, DevflowCardId, SERVICE_CLASSES, isCardLocation, isDevStage, isServiceClass } from './stages.ts'
import type { ArtifactRecord, CardLocation, DevActor, DevStage, DevflowJournalEntry, GateCheck, JournalTransition, ServiceClass } from './types.ts'

/** Card state derived by {@link foldJournal}; the read-side authority. */
export interface JournalFoldState {
  /** Current location after the last entry. */
  stage: CardLocation
  /** Revision of the last entry; the optimistic-concurrency token. */
  revision: number
  /** The stage a blocked card returns to; present exactly while `stage` is `blocked`. */
  blockedFrom?: DevStage
  /** The card this one decomposes, from the `created` entry; absent for a top-level card. */
  parent?: DevflowCardId
  /**
   * The card's service class, from the `created` entry. Always set: an entry
   * that states none is a {@link DEFAULT_SERVICE_CLASS} card, so no read-side
   * consumer branches on absence.
   */
  serviceClass: ServiceClass
  /**
   * Set once the card was abandoned. Terminal: no entry may follow, and the
   * card is off the active board even while its directory awaits archiving.
   */
  abandoned?: true
  /**
   * Why the work stopped, from the `abandoned` entry. Present exactly while
   * {@link abandoned} is: the entry decoder refuses a blank reason, so the two
   * are set together and a reader needs no fallback for one without the other.
   */
  abandonedReason?: string
  /**
   * Set while the card is archived. Off the active board like
   * {@link abandoned}, but not terminal: a `restored` entry clears it, and it
   * is the only entry type that may follow.
   */
  archived?: true
  /** Timestamp of the first entry. */
  createdAt: string
  /** Timestamp of the last entry. */
  updatedAt: string
  /** Artifact paths in registration order. */
  artifacts: string[]
}

/**
 * Decode one parsed journal value into a {@link DevflowJournalEntry}.
 *
 * This is the durable-boundary validator: journal lines come from a file that
 * humans and other processes may write, so every field is checked and a bad
 * entry throws instead of being skipped.
 * @param value - one JSON-parsed journal line.
 * @returns the validated entry.
 * @throws {Error} naming the first violated field.
 */
export function decodeJournalEntry(value: unknown): DevflowJournalEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('journal entry must be a JSON object')
  }
  const entry = value as Record<string, unknown>
  const rev = entry.rev
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 1) {
    throw new Error('journal entry field "rev" must be a positive integer')
  }
  if (typeof entry.at !== 'string' || entry.at.length === 0) {
    throw new Error('journal entry field "at" must be a non-empty string')
  }
  switch (entry.type) {
    case 'created':
      return {
        rev,
        at: entry.at,
        type: 'created',
        by: decodeActor(entry.by),
        ...decodeOptionalCardId(entry, 'parent'),
        ...decodeOptionalServiceClass(entry),
      }
    case 'transition': {
      if (!isCardLocation(entry.from)) throw new Error('transition field "from" must be a stage or "blocked"')
      if (!isCardLocation(entry.to)) throw new Error('transition field "to" must be a stage or "blocked"')
      return {
        rev,
        at: entry.at,
        type: 'transition',
        from: entry.from,
        to: entry.to,
        ...entry.by !== undefined ? { by: decodeActor(entry.by) } : {},
        ...decodeOptionalString(entry, 'reason'),
        ...entry.gate !== undefined ? { gate: decodeGate(entry.gate) } : {},
      }
    }
    case 'artifact': {
      if (typeof entry.path !== 'string' || entry.path.length === 0) {
        throw new Error('artifact field "path" must be a non-empty string')
      }
      if (!isDevStage(entry.stage)) {
        throw new Error(`artifact field "stage" must be one of ${DEV_STAGES.join(', ')}`)
      }
      return {
        rev,
        at: entry.at,
        type: 'artifact',
        path: entry.path,
        stage: entry.stage,
        ...entry.by !== undefined ? { by: decodeActor(entry.by) } : {},
        ...decodeOptionalString(entry, 'kind'),
      }
    }
    case 'abandoned': {
      if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
        throw new Error('abandoned field "reason" must be a non-empty string; a card leaving the board without one loses the decision')
      }
      return {
        rev,
        at: entry.at,
        type: 'abandoned',
        by: decodeActor(entry.by),
        reason: entry.reason,
      }
    }
    case 'archived':
      return {
        rev,
        at: entry.at,
        type: 'archived',
        by: decodeActor(entry.by),
        ...decodeOptionalString(entry, 'reason'),
      }
    case 'restored':
      return {
        rev,
        at: entry.at,
        type: 'restored',
        by: decodeActor(entry.by),
        ...decodeOptionalString(entry, 'reason'),
      }
    case 'claim-expired': {
      if (entry.previousOwner === undefined) {
        throw new Error('claim-expired field "previousOwner" is required')
      }
      return {
        rev,
        at: entry.at,
        type: 'claim-expired',
        previousOwner: decodeActor(entry.previousOwner),
        by: decodeActor(entry.by),
      }
    }
    default:
      throw new Error(`journal entry field "type" must be created, transition, artifact, abandoned, archived, restored, or claim-expired (got ${JSON.stringify(entry.type)})`)
  }
}

/**
 * Replay a complete journal into the card's current state.
 *
 * Validates the structural invariants of the durable stream: revisions are the
 * contiguous sequence 1..n, the first entry is `created`, every transition
 * departs from the current location, a move to `blocked` remembers its origin,
 * the matching recovery returns exactly there, nothing follows an `abandoned`
 * entry, only a `done` card archives, and an archived card accepts nothing but
 * a `restored` entry.
 *
 * The archive rules live here rather than only on the write path so a
 * hand-edited journal cannot describe a card that moved while archived.
 * @param entries - decoded entries in file order.
 * @returns the folded card state.
 * @throws {Error} naming the first violated invariant and its entry revision.
 */
export function foldJournal(entries: readonly DevflowJournalEntry[]): JournalFoldState {
  if (entries.length === 0) throw new Error('journal is empty; every card starts with a "created" entry')
  const first = entries[0] as DevflowJournalEntry
  const state: JournalFoldState = {
    stage: 'draft',
    revision: 0,
    serviceClass: DEFAULT_SERVICE_CLASS,
    createdAt: first.at,
    updatedAt: first.at,
    artifacts: [],
  }
  for (const [index, entry] of entries.entries()) {
    if (entry.rev !== index + 1) {
      throw new Error(`journal entry ${index + 1} carries rev ${entry.rev}; revisions must be contiguous from 1`)
    }
    state.updatedAt = entry.at
    if (index === 0) {
      if (entry.type !== 'created') throw new Error('journal entry 1 must be "created"')
      if (entry.parent !== undefined) state.parent = entry.parent
      if (entry.serviceClass !== undefined) state.serviceClass = entry.serviceClass
      state.revision = entry.rev
      continue
    }
    if (state.abandoned === true) {
      throw new Error(`journal entry rev ${entry.rev} follows an abandoned card; abandoning is terminal`)
    }
    if (state.archived === true && entry.type !== 'restored') {
      throw new Error(`journal entry rev ${entry.rev} is "${entry.type}" on an archived card; only "restored" may follow archiving`)
    }
    switch (entry.type) {
      case 'created':
        throw new Error(`journal entry rev ${entry.rev} repeats "created"`)
      case 'transition': {
        if (entry.from !== state.stage) {
          throw new Error(`transition rev ${entry.rev} departs from "${entry.from}" but the card is at "${state.stage}"`)
        }
        if (entry.to === state.stage) {
          throw new Error(`transition rev ${entry.rev} does not move the card (already at "${entry.to}")`)
        }
        if (entry.to === 'blocked') {
          // `from` is a stage here: the departure check above matched the
          // current location, and a blocked card cannot block again.
          state.blockedFrom = entry.from as DevStage
        } else if (state.stage === 'blocked') {
          if (entry.to !== state.blockedFrom) {
            throw new Error(`transition rev ${entry.rev} recovers to "${entry.to}" but the card blocked from "${state.blockedFrom}"`)
          }
          delete state.blockedFrom
        }
        state.stage = entry.to
        state.revision = entry.rev
        break
      }
      case 'artifact':
        state.artifacts.push(entry.path)
        state.revision = entry.rev
        break
      case 'abandoned':
        state.abandoned = true
        state.abandonedReason = entry.reason
        state.revision = entry.rev
        break
      case 'archived':
        if (state.stage !== 'done') {
          throw new Error(`archived rev ${entry.rev} files a card at "${state.stage}"; only a done card is archived`)
        }
        state.archived = true
        state.revision = entry.rev
        break
      case 'restored':
        // Unreachable through the guard above, which rejects every other type
        // on an archived card — but a `restored` on a card that never archived
        // is exactly the sequence that guard cannot see.
        if (state.archived !== true) {
          throw new Error(`restored rev ${entry.rev} returns a card that is not archived`)
        }
        delete state.archived
        state.revision = entry.rev
        break
      case 'claim-expired':
        state.revision = entry.rev
        break
    }
  }
  return state
}

/**
 * Derive the artifact registrations of a decoded journal, in registration
 * order. Kept beside {@link foldJournal} — whose `artifacts` is this list's
 * path projection — so every consumer derives identical records; an entry
 * without a `kind` yields a record without one.
 * @param entries - decoded entries in file order.
 * @returns the artifact records, oldest first.
 */
export function foldArtifactRecords(entries: readonly DevflowJournalEntry[]): ArtifactRecord[] {
  const records: ArtifactRecord[] = []
  for (const entry of entries) {
    if (entry.type !== 'artifact') continue
    records.push({
      path: entry.path,
      ...entry.kind !== undefined ? { kind: entry.kind } : {},
      rev: entry.rev,
      stage: entry.stage,
    })
  }
  return records
}

function decodeGate(value: unknown): NonNullable<JournalTransition['gate']> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('transition field "gate" must be a JSON object')
  }
  const gate = value as Record<string, unknown>
  if (gate.approvedBy === undefined && gate.checks === undefined) {
    throw new Error('transition field "gate" requires "approvedBy" or "checks"')
  }
  return {
    ...gate.approvedBy !== undefined ? { approvedBy: decodeActor(gate.approvedBy) } : {},
    ...gate.checks !== undefined ? { checks: decodeGateChecks(gate.checks) } : {},
  }
}

function decodeGateChecks(value: unknown): GateCheck[] {
  if (!Array.isArray(value)) {
    throw new Error('transition field "gate.checks" must be an array')
  }
  return value.map((check: unknown) => {
    if (typeof check !== 'object' || check === null || Array.isArray(check)) {
      throw new Error('gate check must be a JSON object')
    }
    const record = check as Record<string, unknown>
    if (record.verdict !== 'allowed') {
      throw new Error(`gate check field "verdict" must be "allowed" (got ${JSON.stringify(record.verdict)})`)
    }
    return { by: decodeActor(record.by), verdict: 'allowed', ...decodeOptionalString(record, 'summary') }
  })
}

function decodeActor(value: unknown): DevActor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('actor must be a JSON object')
  }
  const actor = value as Record<string, unknown>
  switch (actor.kind) {
    case 'human':
      return { kind: 'human', ...decodeOptionalString(actor, 'name') }
    case 'agent':
      return { kind: 'agent', ...decodeOptionalString(actor, 'session') }
    case 'command':
      return { kind: 'command', ...decodeOptionalString(actor, 'name') }
    default:
      throw new Error(`actor field "kind" must be human, agent, or command (got ${JSON.stringify(actor.kind)})`)
  }
}

function decodeOptionalServiceClass(record: Record<string, unknown>): { serviceClass?: ServiceClass } {
  const value = record.serviceClass
  if (value === undefined) return {}
  if (!isServiceClass(value)) {
    throw new Error(`created field "serviceClass" must be one of ${SERVICE_CLASSES.join(', ')} when present`)
  }
  return { serviceClass: value }
}

function decodeOptionalCardId<K extends string>(record: Record<string, unknown>, key: K): { [P in K]?: DevflowCardId } {
  const value = record[key]
  if (value === undefined) return {}
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`field "${key}" must be a non-empty card id when present`)
  }
  return { [key]: DevflowCardId(value) } as { [P in K]?: DevflowCardId }
}

function decodeOptionalString<K extends string>(record: Record<string, unknown>, key: K): { [P in K]?: string } {
  const value = record[key]
  if (value === undefined) return {}
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`field "${key}" must be a non-empty string when present`)
  }
  return { [key]: value } as { [P in K]?: string }
}
