import { afterEach, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ByClawSkillLoader, type SkillLoaderOptions } from '../src/skill-loader.ts'
import { timed } from '../src/operation-timing.ts'
import { projectByClawResourcesToTemplates } from '../src/integration.ts'
import { readTeamTemplate, writeTeamTemplate } from '@byclaw/dsh-agent-teams/catalog'
import { ByClawGenerationLease } from '../src/generation-lease.ts'
import type { ByClawSkillRef } from '../src/types.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const source = { principal: 'local-user', baseUrl: 'https://byclaw.example.test', headers: {} }
function ref(code: string): ByClawSkillRef {
  return { id: code, code, type: 'hub', versionUrl: `/${code}/version`, downloadUrl: `/${code}/download` }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-loading-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const payload = join(root, 'payload')
  await mkdir(payload)
  await writeFile(join(payload, 'SKILL.md'), '---\nname: example\ndescription: Test Skill\n---\nInstructions')
  await promisify(execFile)('zip', ['-q', join(root, 'skill.zip'), 'SKILL.md'], { cwd: payload })
  const archive = await readFile(join(root, 'skill.zip'))
  const calls: string[] = []
  let version = '1'
  const fetchImpl: typeof fetch = async input => {
    const url = String(input)
    calls.push(url)
    return url.endsWith('/version') ? Response.json({ data: { version } }) : new Response(archive)
  }
  const loader = (options: Partial<SkillLoaderOptions> = {}) => {
    const instance = new ByClawSkillLoader({ cacheRoot: join(root, 'cache'), fetchImpl, attempts: 1, ...options })
    cleanups.push(() => instance.close())
    return instance
  }
  return { root, calls, fetchImpl, loader, version: (value: string) => { version = value } }
}
function abortable(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    if (signal?.aborted) reject(signal.reason)
    else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

it('logs begin while an operation is pending, and logs failure without changing the error', async () => {
  const messages: string[] = [], gate = deferred<number>()
  const pending = timed(line => messages.push(line), 'stage=test', () => gate.promise)
  expect(messages).toHaveLength(1)
  expect(messages[0]).toContain('status=begin')
  gate.resolve(42)
  expect(await pending).toBe(42)
  expect(messages[1]).toMatch(/status=end durationMs=\d/u)
  const error = new Error('failure')
  await expect(timed(line => messages.push(line), 'stage=test', async () => { throw error })).rejects.toBe(error)
  expect(messages.at(-1)).toContain('status=failed')
  expect(await timed(() => { throw error }, 'stage=test', async () => 1)).toBe(1)
})

it('does no network I/O during reconciliation; cold first use loads only its own Skills and coalesces calls', async () => {
  const f = await fixture(), loader = f.loader(), a = ref('a'), b = ref('b')
  await loader.reconcile(source, [a, b])
  expect(f.calls).toEqual([])
  const [first, second] = await Promise.all([loader.ensure([a]), loader.ensure([a])])
  expect(first).toEqual(second)
  expect(f.calls.map(url => new URL(url).pathname)).toEqual(['/a/version', '/a/download'])
  expect(loader.cached(b)).toBeUndefined()
  expect(await readFile(join(first[0]!.path, 'SKILL.md'), 'utf8')).toContain('Instructions')
})

it('reuses a complete cache after restart without waiting for a version request', async () => {
  const f = await fixture(), a = ref('a'), initial = f.loader()
  await initial.reconcile(source, [a])
  const prepared = await initial.ensure([a])
  await initial.close()
  const warm = f.loader({ fetchImpl: async () => { throw new Error('network must not be called') } })
  await warm.reconcile({ ...source, headers: { authorization: 'rotated-local-test-token' } }, [{ ...a, downloadUrl: '/new-signed-url' }])
  expect(await warm.ensure([a])).toEqual(prepared)
})

it('keeps warm Skills usable during a stalled update and cancels background work on close', async () => {
  const f = await fixture(), a = ref('a'), initial = f.loader()
  await initial.reconcile(source, [a])
  const prepared = await initial.ensure([a])
  await initial.close()
  const started = deferred()
  const warm = f.loader({ fetchImpl: async (_url, init) => { started.resolve(); return abortable(init?.signal) } })
  await warm.reconcile(source, [a])
  warm.start()
  await started.promise
  expect(await warm.ensure([a])).toEqual(prepared)
  await warm.close()
})

it('publishes new immutable versions while the prior Skill path remains readable', async () => {
  const f = await fixture(), a = ref('a'), initial = f.loader()
  await initial.reconcile(source, [a])
  const old = await initial.ensure([a])
  await initial.close()
  f.version('2')
  const warm = f.loader()
  await warm.reconcile(source, [a])
  warm.start()
  await expect.poll(() => warm.revision).toBe(1)
  const current = await warm.ensure([a])
  expect(current[0]!.path).not.toBe(old[0]!.path)
  expect(await readFile(join(old[0]!.path, 'SKILL.md'), 'utf8')).toContain('Instructions')
  expect(await readFile(join(current[0]!.path, 'SKILL.md'), 'utf8')).toContain('Instructions')
})

it('isolates cached Skills by principal, backend, and Skill identity', async () => {
  const f = await fixture(), a = ref('a'), loader = f.loader()
  await loader.reconcile(source, [a])
  await loader.ensure([a])
  await loader.reconcile({ ...source, principal: 'another-user' }, [a])
  expect(loader.cached(a)).toBeUndefined()
  await loader.reconcile({ ...source, baseUrl: 'https://another.example.test' }, [a])
  expect(loader.cached(a)).toBeUndefined()
  await loader.reconcile(source, [{ ...a, id: 'replacement' }])
  expect(loader.cached(a)).toBeUndefined()
  await expect(loader.ensure([a])).rejects.toThrow('no longer authorized')
})

it('revokes an in-flight Skill and rejects consumers even before a replacement template publishes', async () => {
  const f = await fixture(), a = ref('a'), started = deferred()
  const loader = f.loader({ fetchImpl: async (_url, init) => { started.resolve(); return abortable(init?.signal) } })
  await loader.reconcile(source, [a])
  const pending = loader.ensure([a])
  const rejected = expect(pending).rejects.toThrow('authorization or source changed')
  await started.promise
  await loader.reconcile(source, [])
  await rejected
  await loader.close()
  expect(loader.cached(a)).toBeUndefined()
})

it('bounds first-use waits and keeps shared work alive when one caller cancels', async () => {
  const f = await fixture(), a = ref('a'), started = deferred(), release = deferred()
  const loader = f.loader({ waitTimeoutMs: 40, fetchImpl: async (url, init) => {
    if (String(url).endsWith('/version')) { started.resolve(); await release.promise }
    return f.fetchImpl(url, init)
  } })
  await loader.reconcile(source, [a])
  const controller = new AbortController()
  const cancelled = loader.ensure([a], controller.signal)
  const cancelledCheck = expect(cancelled).rejects.toThrow('caller cancelled')
  await started.promise
  controller.abort(new Error('caller cancelled'))
  await cancelledCheck
  await expect(loader.ensure([a])).rejects.toMatchObject({ name: 'TimeoutError' })
  release.resolve()
  await expect.poll(() => loader.cached(a)).toBeDefined()
  expect(f.calls.filter(url => url.endsWith('/version'))).toHaveLength(1)
})

it('bounds background concurrency and prioritizes a queued first-use Skill', async () => {
  const f = await fixture(), gate = deferred(), started = deferred(), order: string[] = []
  const loader = f.loader({ concurrency: 1, fetchImpl: async (url, init) => {
    if (String(url).endsWith('/version')) {
      order.push(new URL(String(url)).pathname)
      if (order.length === 1) { started.resolve(); await gate.promise }
    }
    return f.fetchImpl(url, init)
  } })
  const refs = [ref('a'), ref('b'), ref('c')]
  await loader.reconcile(source, refs)
  loader.start()
  await started.promise
  expect(order).toEqual(['/a/version'])
  const c = loader.ensure([refs[2]!])
  gate.resolve()
  await c
  expect(order.slice(0, 2)).toEqual(['/a/version', '/c/version'])
})

it('projects a cold catalog without syncing remote Skills and reserves the write lease only for publication', async () => {
  const f = await fixture(), a = ref('a'), lease = new ByClawGenerationLease(), gate = deferred(), entered = deferred()
  cleanups.push(() => lease.close())
  const teams = join(f.root, 'teams')
  const work = projectByClawResourcesToTemplates({
    agentTemplateDir: join(f.root, 'agents'), teamCatalogDir: teams, cacheRoot: join(f.root, 'cache'),
    baseUrl: source.baseUrl, cachedSkill: () => undefined, generationLease: lease,
    syncSkill: async () => { throw new Error('must not download during catalog projection') },
    resolveModel: async () => { entered.resolve(); await gate.promise; return { provider: 'test', model: 'test' } },
    resources: { employees: [{ id: '1', code: 'one', name: 'One', description: '', capabilities: '', persona: '',
      workerAgentType: 'BYCLAW_DSH', skills: [a] }], groups: [], directEmployeeIds: ['1'], watchedResourceIds: ['1'],
      authHeaders: {}, authorization: { userId: 'local', authKey: '', resourceIds: ['1'] } },
  })
  await entered.promise
  expect(await lease.read(teams, async () => 'reader remains available')).toBe('reader remains available')
  await lease.write(teams, () => writeTeamTemplate(teams, { id: 'user-team', name: 'Saved during refresh', description: '', members: [] }))
  gate.resolve()
  const result = await work
  expect(result.agents[0]).toMatchObject({ deferredSkills: true, skills: [] })
  expect(result.acceptedEmployeeIds).toEqual(['1'])
  expect((await readTeamTemplate(teams, 'user-team'))?.name).toBe('Saved during refresh')
})
