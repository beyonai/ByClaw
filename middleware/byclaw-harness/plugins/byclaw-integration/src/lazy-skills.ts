/** On-demand, authorization-checked synchronization of one employee's Skills. */
import type { DshAgentTemplate } from './agent-template.ts'
import type { AuthorizedByClawResources } from './catalog.ts'
import type { ByClawSkillRef } from './types.ts'
import { mapConcurrent } from './startup-concurrency.ts'
import { byClawSkillCacheDir, syncByClawSkill } from './skill-sync.ts'

export function createLazyByClawSkillLoader(options: {
  loadResources(template: DshAgentTemplate): Promise<AuthorizedByClawResources>
  baseUrl(): string
  cacheRoot: string
  concurrency: number
  allowFailure: boolean
  timeoutMs: number
  attempts: number
  retryDelayMs: number
  onError(ref: ByClawSkillRef, error: unknown): void
  syncSkill?: typeof syncByClawSkill
}): { resolve(template: DshAgentTemplate): Promise<DshAgentTemplate>; close(): Promise<void> } {
  // A code has one cache directory. Serialize differing requests for that directory,
  // while coalescing identical requests (including authorization headers) in flight.
  const tails = new Map<string, Promise<unknown>>()
  const requests = new Map<string, Promise<string>>()
  const operations = new Set<Promise<DshAgentTemplate>>()
  let closed = false
  const fingerprint = (refs: readonly ByClawSkillRef[]): string => JSON.stringify(
    refs.map(ref => [ref.code, ref.versionUrl, ref.downloadUrl]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  )
  const resolve = async (template: DshAgentTemplate): Promise<DshAgentTemplate> => {
    if (closed) throw new Error('ByClaw lazy Skill loader is closed')
    const before = await options.loadResources(template)
    const employee = before.employees.find(item => item.id === template.source.resourceId)
    if (employee === undefined) throw new Error(`ByClaw employee ${template.source.resourceId} is no longer authorized`)
    const expected = fingerprint(employee.skills)
    const skills = await mapConcurrent(employee.skills, options.concurrency, async ref => {
      const key = JSON.stringify([ref, before.authHeaders, options.baseUrl()])
      let pending = requests.get(key)
      if (pending === undefined) {
        const prior = tails.get(ref.code) ?? Promise.resolve()
        pending = prior.catch(() => undefined).then(() => (options.syncSkill ?? syncByClawSkill)({
          ref, headers: before.authHeaders, baseUrl: options.baseUrl(), cacheRoot: options.cacheRoot,
          timeoutMs: options.timeoutMs, attempts: options.attempts, retryDelayMs: options.retryDelayMs,
        }))
        requests.set(key, pending)
        tails.set(ref.code, pending)
      }
      try {
        const path = await pending
        if (path !== byClawSkillCacheDir(options.cacheRoot, ref.code)) throw new Error('ByClaw lazy Skill cache path mismatch')
        return { code: ref.code, path }
      } catch (error: unknown) {
        options.onError(ref, error)
        if (!options.allowFailure) throw error
        return undefined
      } finally {
        if (requests.get(key) === pending) requests.delete(key)
        if (tails.get(ref.code) === pending) tails.delete(ref.code)
      }
    })
    const after = await options.loadResources(template)
    const current = after.employees.find(item => item.id === employee.id)
    if (closed || current === undefined || fingerprint(current.skills) !== expected) {
      throw new Error('ByClaw Skill authorization changed during loading; retry lookup')
    }
    return { ...template, skills: skills.filter((skill): skill is { code: string; path: string } => skill !== undefined) }
  }
  return {
    resolve(template) {
      const operation = resolve(template)
      operations.add(operation)
      void operation.then(() => operations.delete(operation), () => operations.delete(operation))
      return operation
    },
    async close() { closed = true; await Promise.allSettled(operations) },
  }
}
