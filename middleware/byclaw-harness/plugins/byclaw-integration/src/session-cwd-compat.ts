/** Restore legacy ByClaw sessions with a canonical execution cwd without rewriting their history. */
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionHandle, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { registerTeamStateWorkspaceAlias } from '@byclaw/dsh-agent-teams'
import { resolveByClawInboundPath } from './inbound-context.ts'
import { byClawSessionCwd, isLegacyProjectCwd } from './session-cwd.ts'
import type { ByClawSessionMetadataStore } from './session-metadata.ts'
import { byClawBoundRootSessionId, foldByClawSessionWorkspace } from './session-workspace.ts'

/**
 * DSH headers are immutable. Translate at the storage boundary BEFORE Agent restore,
 * so tools, children and context all receive the same cwd. The original append-only
 * log, header, event offsets and writer ownership remain owned by the backend.
 */
export function installByClawSessionCwdCompatibility(
  persistence: Pick<SessionPersistence, 'open' | 'stat' | 'list'>,
  metadata: Pick<ByClawSessionMetadataStore, 'get'>,
  byRoot: string,
): () => void {
  const originalOpen = persistence.open
  const originalStat = persistence.stat
  const originalList = persistence.list
  const stateAliases = new Map<string, () => void>()

  async function externalId(header: SessionHeader, visited = new Set<string>()): Promise<string | undefined> {
    const id = String(header.id)
    if (visited.has(id)) throw new Error('Cyclic ByClaw workspace lineage')
    visited.add(id)
    const record = metadata.get(id)
    if (record !== undefined) {
      // A stale side record must not rebind a newly recreated DSH session.
      if (record.identity.createdAt !== header.createdAt) throw new Error('ByClaw workspace lifecycle mismatch')
      if (id !== record.externalSessionId && id !== byClawBoundRootSessionId(record.externalSessionId, record.binding)) {
        throw new Error('ByClaw workspace root identity mismatch')
      }
      if (header.cwd === undefined || record.identity.cwd === undefined || (resolve(record.identity.cwd) !== resolve(header.cwd)
        && resolve(record.identity.cwd) !== byClawSessionCwd(record.externalSessionId, byRoot))) {
        throw new Error('ByClaw workspace metadata conflicts with the stored header')
      }
      return record.externalSessionId
    }
    if (header.parentSession !== undefined) {
      const parent = await originalStat.call(persistence, header.parentSession)
      return parent === undefined ? undefined : externalId(parent.header, visited)
    }
    // Pre-domain roots carry their business identity in a legacy workspace event.
    const handle = await originalOpen.call(persistence, header.id, 'read')
    try {
      const result = await handle.read()
      const events = Array.isArray(result) ? result as readonly SessionEvent[] : result.events
      const legacy = foldByClawSessionWorkspace(events)
      if (legacy !== undefined && (header.cwd === undefined || legacy.cwd !== resolve(header.cwd))) {
        throw new Error('ByClaw legacy workspace conflicts with the stored header')
      }
      return legacy?.externalSessionId === id ? id : undefined
    } finally {
      await handle.close()
    }
  }

  async function projectHeader(header: SessionHeader): Promise<SessionHeader> {
    if (!isLegacyProjectCwd(header.cwd, byRoot)) return header
    const id = await externalId(header)
    return id === undefined ? header : { ...header, cwd: byClawSessionCwd(id, byRoot) }
  }

  const wrappedOpen: typeof persistence.open = async function (this: typeof persistence, id, access, options) {
    const handle = await originalOpen.call(this, id, access, options)
    try {
      const header = await projectHeader(handle.header)
      if (header === handle.header) return handle
      if (access === 'write') {
        await mkdir(header.cwd!, { recursive: true })
        const key = JSON.stringify([header.cwd, handle.header.cwd])
        if (!stateAliases.has(key)) {
          stateAliases.set(key, registerTeamStateWorkspaceAlias(
            header.cwd!, resolveByClawInboundPath(handle.header.cwd!, byRoot),
          ))
        }
      }
      // Explicit forwarding preserves private-field receivers and close/flush semantics.
      const projected: SessionHandle = {
        id: handle.id, access: handle.access, inheritedEventCount: handle.inheritedEventCount,
        header: Object.freeze(header),
        read: (...args) => handle.read(...args),
        append: (...args) => handle.append(...args),
        flush: (...args) => handle.flush(...args),
        close: () => handle.close(),
        [Symbol.asyncDispose]: () => handle.close(),
      }
      return projected
    } catch (error) {
      await handle.close()
      throw error
    }
  }
  const wrappedStat: typeof persistence.stat = async function (this: typeof persistence, ...args) {
    const snapshot = await originalStat.apply(this, args)
    return snapshot === undefined ? undefined : { ...snapshot, header: await projectHeader(snapshot.header) }
  }
  const wrappedList: typeof persistence.list = async function (this: typeof persistence, ...args) {
    const snapshots = await originalList.apply(this, args)
    return Promise.all(snapshots.map(async snapshot => ({ ...snapshot, header: await projectHeader(snapshot.header) })))
  }
  persistence.open = wrappedOpen
  persistence.stat = wrappedStat
  persistence.list = wrappedList
  return () => {
    if (persistence.open === wrappedOpen) persistence.open = originalOpen
    if (persistence.stat === wrappedStat) persistence.stat = originalStat
    if (persistence.list === wrappedList) persistence.list = originalList
    for (const dispose of stateAliases.values()) dispose()
    stateAliases.clear()
  }
}
