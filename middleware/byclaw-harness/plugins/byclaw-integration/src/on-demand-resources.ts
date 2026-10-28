/** Per-user discovery and lazy template publication. No process-global user state. */
import type { AuthorizedByClawResources, LoadAuthorizedByClawResourcesOptions } from './catalog.ts'

type Selection = Pick<LoadAuthorizedByClawResourcesOptions, 'resourceIds' | 'includeGroupMembers'>
const templateIds = (resources: AuthorizedByClawResources): string[] => [
  ...resources.employees.map(employee => `byclaw-employee-${employee.id}`),
  ...resources.groups.map(group => `byclaw-group-${group.id}`),
]
const directlyAuthorized = (resources: AuthorizedByClawResources, templateId: string): boolean =>
  resources.directEmployeeIds.some(id => templateId === `byclaw-employee-${id}`)
  || resources.groups.some(group => templateId === `byclaw-group-${group.id}`)
const signature = (resources: AuthorizedByClawResources): string => JSON.stringify([
  resources.authorization.userId, resources.authHeaders, resources.directEmployeeIds, resources.employees, resources.groups,
])

export class ByClawOnDemandResources {
  private pending: Promise<unknown> = Promise.resolve()
  private readonly prepared = new Map<string, string>()
  private readonly dependencies = new Map<string, Set<string>>()
  private readonly published = new Set<string>()
  private catalog?: AuthorizedByClawResources
  private revision = 0
  private closed = false

  constructor(private readonly options: {
    load(selection: Selection): Promise<AuthorizedByClawResources>
    publish(resources: AuthorizedByClawResources, retainTemplateIds: ReadonlySet<string>, requiredTemplateId: string): Promise<readonly string[]>
    onCatalog(resources: AuthorizedByClawResources): void
  }) {}

  /** Redis-only discovery: never resolves models, writes templates, or downloads Skills. */
  discover(): Promise<AuthorizedByClawResources> {
    return this.enqueue(async () => this.readCatalog())
  }

  invalidate(): void { this.revision += 1; this.prepared.clear(); this.dependencies.clear() }

  private async readCatalog(): Promise<AuthorizedByClawResources> {
    const catalog = await this.options.load({ includeGroupMembers: false })
    if (this.closed) throw new Error('ByClaw resource runtime is closed')
    this.catalog = catalog
    this.options.onCatalog(catalog)
    for (const id of this.prepared.keys()) {
      if (!directlyAuthorized(catalog, id)) this.prepared.delete(id)
    }
    return catalog
  }

  prepare(templateId: string): Promise<void> {
    return this.enqueue(async () => {
      const id = templateId.replace(/^byclaw-(?:employee|group)-/u, '')
      const selection = { resourceIds: new Set([id]), includeGroupMembers: true }
      const selected = await this.options.load(selection)
      if (!directlyAuthorized(selected, templateId)) {
        this.prepared.delete(templateId)
        throw new Error(`ByClaw template ${templateId} is unavailable or no longer authorized`)
      }
      // Execution reads only the selected resource and dependencies. Merge its
      // fresh metadata into discovery state, pruning grants using this auth read.
      const granted = new Set(selected.authorization.resourceIds)
      const employees = [...new Map([...(this.catalog?.employees ?? []), ...selected.employees]
        .filter(employee => granted.has(employee.id)).map(employee => [employee.id, employee])).values()]
      const groups = [...new Map([...(this.catalog?.groups ?? []), ...selected.groups]
        .filter(group => granted.has(group.id)).map(group => [group.id, group])).values()]
      const catalog = { ...selected, employees, groups, directEmployeeIds: employees.map(employee => employee.id),
        watchedResourceIds: [...new Set([...granted, ...groups.flatMap(group => group.members.map(member => member.employeeId))])] }
      this.catalog = catalog
      this.options.onCatalog(catalog)
      const fingerprint = signature(selected)
      if (this.prepared.get(templateId) === fingerprint) return
      const revision = this.revision
      const allowed = new Set([
        ...templateIds(catalog),
        ...catalog.groups.flatMap(group => group.members.map(member => `byclaw-employee-${member.employeeId}`)),
      ])
      const retained = new Set([...this.published].filter(key => allowed.has(key)))
      const replacing = new Set(templateIds(selected))
      for (const [key, dependencies] of this.dependencies) {
        if (!allowed.has(key) || [...dependencies].some(dependency => replacing.has(dependency))) this.prepared.delete(key)
      }
      const published = await this.options.publish(selected, retained, templateId)
      // A slow projection may race a revoke, edit or token rotation. Never execute
      // the staged result unless the current selected snapshot still matches.
      const current = await this.options.load(selection)
      if (this.closed || this.revision !== revision || !directlyAuthorized(current, templateId) || signature(current) !== fingerprint) {
        this.prepared.delete(templateId)
        throw new Error('ByClaw resource authorization or version changed during preparation; retry lookup')
      }
      if (!published.includes(templateId)) throw new Error(`ByClaw template ${templateId} could not be prepared`)
      this.published.clear()
      for (const key of [...retained].filter(key => !replacing.has(key)).concat([...published])) this.published.add(key)
      this.prepared.set(templateId, fingerprint)
      this.dependencies.set(templateId, replacing)
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('ByClaw resource runtime is closed'))
    const pending = this.pending.then(() => {
      if (this.closed) throw new Error('ByClaw resource runtime is closed')
      return operation()
    })
    this.pending = pending.catch(() => undefined)
    return pending
  }

  async close(): Promise<void> { this.closed = true; await this.pending; this.invalidate(); this.published.clear() }
}
