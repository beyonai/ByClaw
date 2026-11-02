import { mkdtemp, rm, symlink, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { TransitionAttempt } from '@zhchxiao123/dsh-devflow'
import { ValidatorRegistry, validateRequiredPolicies } from '../src/validators.ts'
import type { GateValidationRequest, RequiredValidatorPolicy } from '../src/types.ts'

let root: string
let registry: ValidatorRegistry
let attempt: TransitionAttempt
let policy: RequiredValidatorPolicy
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'required-validators-'))
  registry = new ValidatorRegistry()
  attempt = { root, id: DevflowCardId('0001-check'), from: 'testing', to: 'done', expectedRevision: 8, at: 'now', by: { kind: 'human' } }
  policy = { root, edges: ['testing->done'], validators: ['midscene'], timeoutMs: 1000 }
})
afterEach(async () => { registry.dispose(); await rm(root, { recursive: true, force: true }) })

const passed = { allowed: true, runId: 'fresh-run', summary: '2/2 assertions passed' } as const

describe('required validator execution', () => {
  it('refuses missing providers even when no command gate exists', async () => {
    expect(await registry.check(attempt, [policy])).toEqual({ allowed: false, reason: 'required validator unavailable: midscene' })
  })

  it('creates fresh immutable transition requests and records execution evidence each time', async () => {
    const requests: GateValidationRequest[] = []
    registry.register('midscene', async (request) => { requests.push(request); return passed })
    const first = await registry.check(attempt, [policy])
    await registry.check(attempt, [policy])
    expect(first).toEqual({ allowed: true, finalChecks: [], checks: [{ by: { kind: 'command', name: 'midscene' }, verdict: 'allowed', summary: 'runId=fresh-run: 2/2 assertions passed' }] })
    expect(requests).toHaveLength(2)
    expect(requests[0]?.requestId).not.toBe(requests[1]?.requestId)
    expect(requests[0]?.attempt).toEqual({ ...attempt, root: await realpath(root) })
    expect(Object.isFrozen(requests[0]?.attempt.by)).toBe(true)
    expect(Object.isFrozen(requests[0]?.attempt)).toBe(true)
    expect(requests[0]?.deadline).toBeGreaterThan(Date.now())
  })

  it('matches canonical workspace roots and never shares same-id policies across projects', async () => {
    const other = join(root, 'other')
    const alias = join(root, 'alias')
    await mkdir(other)
    await symlink(other, alias)
    const run = vi.fn(async () => passed)
    registry.register('midscene', run)
    expect(await registry.check(attempt, [{ ...policy, root: other }])).toEqual({ allowed: true, checks: [], finalChecks: [] })
    expect(await registry.check({ ...attempt, root: alias }, [{ ...policy, root: other }])).toMatchObject({ allowed: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(await registry.check(attempt, [{ ...policy, cards: ['0002-other'] }])).toEqual({ allowed: true, checks: [], finalChecks: [] })
    expect(await registry.check(attempt, [{ ...policy, edges: ['developing->reviewing'] }])).toEqual({ allowed: true, checks: [], finalChecks: [] })
    expect(await registry.check(attempt, [{ ...policy, cards: [attempt.id] }])).toMatchObject({ allowed: true })
    expect(run).toHaveBeenCalledTimes(2)
    expect(await registry.check(attempt, [{ ...policy, root: join(root, 'missing') }])).toMatchObject({ allowed: false })
  })

  it.each([
    [{ allowed: false, reason: 'assertion-failed' }, 'assertion-failed'],
    [{ allowed: true, runId: '', summary: 'ok' }, 'missing execution evidence'],
    [{ allowed: true, runId: 'r', summary: '' }, 'missing execution evidence'],
  ] as const)('refuses a failed or incomplete result: %j', async (result, reason) => {
    registry.register('midscene', async () => result)
    const decision = await registry.check(attempt, [policy])
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toContain(reason)
  })

  it('hides exception text that could contain credentials', async () => {
    registry.register('midscene', async () => { throw new Error('secret-key') })
    expect(await registry.check(attempt, [policy])).toEqual({ allowed: false, reason: 'required validator failed: midscene' })
  })

  it('deadline aborts an unresponsive provider without permitting a late success', async () => {
    let signal: AbortSignal | undefined
    registry.register('midscene', (request) => {
      signal = request.signal
      return new Promise((resolve) => { request.signal.addEventListener('abort', () => { resolve(passed) }) })
    })
    expect(await registry.check(attempt, [{ ...policy, timeoutMs: 5 }])).toMatchObject({ allowed: false })
    expect(signal?.aborted).toBe(true)
  })

  it('provider disposal cancels in-flight execution and replacement cannot bless the old run', async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const dispose = registry.register('midscene', (request) => {
      started()
      return new Promise((resolve) => { request.signal.addEventListener('abort', () => { resolve(passed) }) })
    })
    const pending = registry.check(attempt, [policy])
    await ready
    dispose()
    registry.register('midscene', async () => passed)
    dispose()
    expect(await pending).toMatchObject({ allowed: false })
    expect(await registry.check(attempt, [policy])).toMatchObject({ allowed: true })
  })

  it('registry disposal cancels active requests and prevents subsequent registration', async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    registry.register('midscene', () => { started(); return new Promise(() => {}) })
    const pending = registry.check(attempt, [policy])
    await ready
    registry.dispose()
    expect(await pending).toMatchObject({ allowed: false })
    expect(() => registry.register('later', async () => passed)).toThrow('cannot register')
  })

  it('rejects duplicate and empty registrations', () => {
    expect(() => registry.register(' ', async () => passed)).toThrow('cannot register')
    registry.register('midscene', async () => passed)
    expect(() => registry.register('midscene', async () => passed)).toThrow('cannot register')
  })
})

describe('required policy validation', () => {
  it('validates every edge of a usable deployment policy', () => {
    const edge = vi.fn()
    validateRequiredPolicies([policy], edge)
    expect(edge).toHaveBeenCalledWith('testing->done', 'requiredValidators')
    validateRequiredPolicies([{ ...policy, cards: ['one'] }], edge)
  })
  it.each([
    { root: 'relative' }, { edges: [] }, { validators: [] }, { validators: [''] },
    { timeoutMs: 0 }, { timeoutMs: 1.5 }, { cards: [] }, { cards: [' '] },
  ])('fails loud for invalid policy %j', (change) => {
    expect(() => { validateRequiredPolicies([{ ...policy, ...change }], vi.fn()) }).toThrow('requiredValidators')
  })
})
