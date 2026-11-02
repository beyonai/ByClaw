/** Durable publication activation, isolated from Integration's session metadata. */

import { createHash } from 'node:crypto'
import { publicationIdSchema } from './ids.ts'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { groupTaskPublicationBindingSchema, resolveGroupTaskPublicationBinding } from './context.ts'
import type { GroupTaskPublicationBinding } from './client.ts'

/** Business-session activation; optional creation time is retained only for reading legacy records. */
export const publicationSessionSchema = z.object({
  createdAt: z.number().int().nonnegative().optional(),
  binding: groupTaskPublicationBindingSchema,
})

type PublicationSession = z.infer<typeof publicationSessionSchema>

export const publicationDomainSpec = defineDomain({
  name: 'byclaw_group_publications',
  version: 0,
  layout: 'per-record',
  tables: { sessions: domainTable<string, PublicationSession>(publicationSessionSchema) },
})

/** Hash the tuple to keep storage keys path-safe without ambiguous delimiters. */
function businessSessionKey(binding: GroupTaskPublicationBinding): string {
  return `business_${createHash('sha256').update(JSON.stringify([binding.userCode, binding.taskId])).digest('hex')}`
}

/** Serialize sticky activation and preserve it across plugin and process restarts. */
export class GroupTaskPublicationState {
  private writes: Promise<void> = Promise.resolve()
  private readonly bindings = new Map<string, GroupTaskPublicationBinding>()

  constructor(
    private readonly table: KvTable<string, PublicationSession>,
    private readonly domain?: Domain<typeof publicationDomainSpec>,
  ) {
    // Legacy rows are keyed by DSH session ID; their trusted binding carries the business identity.
    for (const [, record] of table.entries()) {
      this.bindings.set(businessSessionKey(record.binding), record.binding)
    }
  }

  /** Open this plugin's own storage domain. */
  static async open(ctx: Pick<Context, 'storageDomain'>): Promise<GroupTaskPublicationState> {
    const domain = await ctx.storageDomain.open(publicationDomainSpec)
    return new GroupTaskPublicationState(domain.table('sessions'), domain)
  }

  /** Resolve eligibility before registration, committing the first trusted binding. */
  select(
    command: Parameters<typeof resolveGroupTaskPublicationBinding>[1],
  ): Promise<GroupTaskPublicationBinding | undefined> {
    const operation = this.writes.then(async () => {
      const key = businessSessionKey({
        taskId: publicationIdSchema.parse(command.header.sessionId),
        userCode: command.header.userCode,
      })
      const saved = this.bindings.get(key)
      const binding = resolveGroupTaskPublicationBinding(saved, command)
      if (binding !== undefined && this.table.get(key) === undefined) {
        await this.table.put(key, { binding })
        this.bindings.set(key, binding)
      }
      return binding
    })
    this.writes = operation.then(() => undefined, () => undefined)
    return operation
  }

  /** Finish queued writes before releasing the storage provider. */
  async close(): Promise<void> {
    await this.writes
    await this.domain?.close()
  }
}
