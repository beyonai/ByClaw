/** ByClaw-owned root-session metadata, stored outside DSH session event logs. */

import { parseGroupCoordination, type GroupCoordinationSpec } from './group-coordination.ts'
import type { Context } from '@deepseek-ai/cordis'
import {
  defineDomain,
  domainTable,
  type Domain,
  type KvTable,
} from '@deepseek-ai/dsh-storage-domain'
import { resolve } from 'node:path'
import { z } from 'zod'
import { byClawBoundRootSessionId, type ByClawRootBinding } from './session-workspace.ts'
import { isLegacyProjectWorkspaceTransition } from './session-cwd.ts'

const byClawRootBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('main') }),
  z.object({ kind: z.literal('template'), templateId: z.string().min(1) }),
])

export const byClawRootSessionRecordSchema = z.object({
  identity: z.object({
    createdAt: z.number().int().nonnegative(),
    cwd: z.string().min(1).optional(),
  }),
  externalSessionId: z.string().min(1),
  binding: byClawRootBindingSchema,
  groupCoordination: z.unknown().transform(value => parseGroupCoordination(value)).optional(),
})

/** Durable identity of one ByClaw root DSH session. */
export interface ByClawRootSessionRecord {
  readonly identity: {
    readonly createdAt: number
    readonly cwd?: string
  }
  readonly externalSessionId: string
  readonly binding: ByClawRootBinding
  readonly groupCoordination?: GroupCoordinationSpec
}

export const byClawSessionsDomainSpec = defineDomain({
  name: 'byclaw_sessions',
  version: 0,
  layout: 'per-record',
  tables: {
    roots: domainTable<string, ByClawRootSessionRecord>(byClawRootSessionRecordSchema),
  },
})

type ByClawSessionsDomain = Domain<typeof byClawSessionsDomainSpec>

export interface EnsureByClawRootMetadata {
  readonly createdAt: number
  readonly externalSessionId: string
  readonly binding: ByClawRootBinding
  readonly groupCoordination?: GroupCoordinationSpec
  readonly cwd?: string
}

function bindingLabel(binding: ByClawRootBinding): string {
  return binding.kind === 'main' ? 'main' : binding.templateId
}

function sameBinding(left: ByClawRootBinding, right: ByClawRootBinding): boolean {
  return left.kind === right.kind
    && (left.kind === 'main'
      || (right.kind === 'template' && left.templateId === right.templateId))
}

function normalizedRequested(value: EnsureByClawRootMetadata): EnsureByClawRootMetadata {
  return {
    ...value,
    ...(value.cwd === undefined ? {} : { cwd: resolve(value.cwd) }),
  }
}

/** Typed repository for ByClaw root metadata. Writes are serialized to make initialization idempotent. */
export class ByClawSessionMetadataStore {
  private writes: Promise<void> = Promise.resolve()

  constructor(
    private readonly table: KvTable<string, ByClawRootSessionRecord>,
    private readonly domain?: ByClawSessionsDomain,
  ) {}

  /** Open the plugin-owned storage domain through DSH's configured storage backend. */
  static async open(ctx: Pick<Context, 'storageDomain'>): Promise<ByClawSessionMetadataStore> {
    const domain = await ctx.storageDomain.open(byClawSessionsDomainSpec)
    return new ByClawSessionMetadataStore(domain.table('roots'), domain)
  }

  /** Read one root record from the domain's in-memory durable snapshot. */
  get(rootSessionId: string): ByClawRootSessionRecord | undefined {
    return this.table.get(rootSessionId)
  }

  /** Preserve the original root and select a durable, separate root when the addressed employee changes. */
  resolveRootSessionId(externalSessionId: string, binding: ByClawRootBinding): string {
    const original = this.table.get(externalSessionId)
    return original === undefined || sameBinding(original.binding, binding)
      ? externalSessionId
      : byClawBoundRootSessionId(externalSessionId, binding)
  }

  /** Create one immutable root identity, or validate an idempotent reopen. */
  ensureRoot(
    rootSessionId: string,
    requestedValue: EnsureByClawRootMetadata,
    options: { replaceStaleLifecycle?: boolean; byRoot?: string } = {},
  ): Promise<ByClawRootSessionRecord> {
    const requested = normalizedRequested(requestedValue)
    const operation = this.writes.then(async () => {
      const current = this.table.get(rootSessionId)
      if (current !== undefined) {
        if (current.identity.createdAt !== requested.createdAt) {
          if (options.replaceStaleLifecycle !== true) {
            throw new Error(`ByClaw session ${rootSessionId} lifecycle identity does not match its DSH session header`)
          }
        } else {
          if (current.externalSessionId !== requested.externalSessionId) {
            throw new Error(
              `ByClaw root ${rootSessionId} belongs to external session "${current.externalSessionId}", not "${requested.externalSessionId}"`,
            )
          }
          const upgrade = current.groupCoordination === undefined ? requested.groupCoordination : undefined
          if (upgrade !== undefined) {
            const employeeId = requested.binding.kind === 'template' ? requested.binding.templateId.replace(/^byclaw-employee-/, '') : undefined
            if (upgrade.mode !== 'DIRECT' || upgrade.taskSessionId !== current.externalSessionId
              || employeeId === undefined || (employeeId !== upgrade.coordinatorAgentId && !upgrade.allowedAgentIds.includes(employeeId))) {
              throw new Error('An existing ordinary session only accepts an identity-preserving server DIRECT scope upgrade')
            }
          }
          const routeUpgrade = current.groupCoordination !== undefined && requested.groupCoordination !== undefined
            && current.groupCoordination.effectiveWorkerAgentTypes === undefined
            && requested.groupCoordination.effectiveWorkerAgentTypes !== undefined
            && JSON.stringify(current.groupCoordination) === JSON.stringify({ ...requested.groupCoordination, effectiveWorkerAgentTypes: undefined })
              ? requested.groupCoordination : undefined
          if (current.groupCoordination !== undefined && requested.groupCoordination !== undefined
            && routeUpgrade === undefined && JSON.stringify(current.groupCoordination) !== JSON.stringify(requested.groupCoordination)) {
            throw new Error('A persisted group task cannot change its server-bound coordination scope')
          }
          if (!sameBinding(current.binding, requested.binding)) {
            throw new Error(
              `ByClaw session ${rootSessionId} is already bound to template "${bindingLabel(current.binding)}"`,
            )
          }
          // Only the known project-to-own-session transition may update an existing identity.
          const workspaceUpgrade = options.byRoot !== undefined && isLegacyProjectWorkspaceTransition(
            current.identity.cwd, requested.cwd, current.externalSessionId, options.byRoot,
          )
          if (!workspaceUpgrade && requested.cwd !== undefined
            && (current.identity.cwd === undefined || resolve(current.identity.cwd) !== requested.cwd)) {
            throw new Error(
              `ByClaw session ${rootSessionId} cannot change cwd from "${current.identity.cwd ?? '<unset>'}" to "${requested.cwd}"`,
            )
          }
          if (upgrade !== undefined || routeUpgrade !== undefined || workspaceUpgrade) {
            const scoped = {
              ...current,
              ...(workspaceUpgrade ? { identity: { ...current.identity, cwd: requested.cwd! } } : {}),
              ...(upgrade === undefined && routeUpgrade === undefined ? {} : {
                groupCoordination: structuredClone((upgrade ?? routeUpgrade)!),
              }),
            }
            await this.table.put(rootSessionId, scoped)
            return scoped
          }
          return current
        }
      }
      const created: ByClawRootSessionRecord = {
        identity: {
          createdAt: requested.createdAt,
          ...(requested.cwd === undefined ? {} : { cwd: requested.cwd }),
        },
        externalSessionId: requested.externalSessionId,
        binding: requested.binding,
        ...(requested.groupCoordination === undefined ? {} : { groupCoordination: structuredClone(requested.groupCoordination) }),
      }
      await this.table.put(rootSessionId, created)
      return created
    })
    this.writes = operation.then(() => undefined, () => undefined)
    return operation
  }

  /** Close the owned domain after all writes already queued by this repository settle. */
  async close(): Promise<void> {
    await this.writes
    await this.domain?.close()
  }
}
