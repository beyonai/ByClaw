/** Required mechanical checks run before the transition delegates to other policies. */
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { GateCheck, TransitionAttempt } from '@zhchxiao123/dsh-devflow'
import type { DevflowValidators, GateValidator, RequiredValidatorPolicy } from './types.ts'

/** Provider leases prevent unload/reload from accepting a result from the old provider. */
export class ValidatorRegistry implements DevflowValidators {
  private revision = 0

  /** Changes whenever a provider lease or the engine lifetime changes. */
  get generation(): number { return this.revision }

  private readonly providers = new Map<string, { validator: GateValidator; lifetime: AbortController }>()
  private readonly lifetime = new AbortController()

  register(name: string, validator: GateValidator): () => void {
    if (name.trim().length === 0 || this.providers.has(name) || this.lifetime.signal.aborted) {
      throw new Error(`devflow-gates: cannot register validator "${name}"`)
    }
    const entry = { validator, lifetime: new AbortController() }
    this.providers.set(name, entry)
    this.revision++
    return () => {
      entry.lifetime.abort()
      if (this.providers.get(name) === entry) {
        this.providers.delete(name)
        this.revision++
      }
    }
  }

  dispose(): void {
    this.revision++
    this.lifetime.abort()
    this.providers.clear()
  }

  async check(
    attempt: TransitionAttempt,
    policies: readonly RequiredValidatorPolicy[],
  ): Promise<{ allowed: true; checks: GateCheck[]; finalChecks: (() => Promise<boolean>)[] } | { allowed: false; reason: string }> {
    const checks: GateCheck[] = []
    const finalChecks: (() => Promise<boolean>)[] = []
    for (const policy of policies) {
      if (!policy.edges.includes(`${attempt.from}->${attempt.to}`)) continue
      let root: string
      let configuredRoot: string
      try {
        root = await realpath(attempt.root)
        configuredRoot = await realpath(policy.root)
      } catch {
        // An unresolved policy scope cannot safely be treated as an unrelated project.
        return { allowed: false, reason: 'required validator scope is unavailable' }
      }
      if (root !== configuredRoot || (policy.cards !== undefined && !policy.cards.includes(attempt.id))) continue
      for (const name of policy.validators) {
        const entry = this.providers.get(name)
        if (entry === undefined) return { allowed: false, reason: `required validator unavailable: ${name}` }
        const controller = new AbortController()
        const signals = [this.lifetime.signal, entry.lifetime.signal]
        const abort = (): void => { controller.abort() }
        for (const signal of signals) signal.addEventListener('abort', abort, { once: true })
        const timer = setTimeout(abort, policy.timeoutMs)
        let stop!: () => void
        const cancelled = new Promise<{ allowed: false; reason: string }>((resolve) => {
          stop = () => { resolve({ allowed: false, reason: `required validator cancelled or timed out: ${name}; cleanup not confirmed` }) }
          controller.signal.addEventListener('abort', stop, { once: true })
        })
        try {
          const result = await Promise.race([
            cancelled,
            Promise.resolve().then(() => {
              controller.signal.throwIfAborted()
              return entry.validator({
                requestId: randomUUID(),
                attempt: Object.freeze({ ...attempt, root, by: Object.freeze({ ...attempt.by }) }),
                signal: controller.signal,
                deadline: Date.now() + policy.timeoutMs,
              })
            }),
          ])
          if (controller.signal.aborted) {
            return { allowed: false, reason: `required validator cancelled or unloaded: ${name}; cleanup not confirmed` }
          }
          if (!result.allowed) return { allowed: false, reason: `required validator ${name}: ${result.reason}` }
          if (result.runId.trim().length === 0 || result.summary.trim().length === 0) {
            return { allowed: false, reason: `required validator ${name}: missing execution evidence` }
          }
          if (result.revalidate) finalChecks.push(result.revalidate)
          checks.push({ by: { kind: 'command', name }, verdict: 'allowed', summary: `runId=${result.runId}: ${result.summary}` })
        } catch {
          // Provider errors may include model credentials; only the provider's safe refusal is exposed.
          return { allowed: false, reason: `required validator failed: ${name}` }
        } finally {
          clearTimeout(timer)
          for (const signal of signals) signal.removeEventListener('abort', abort)
          controller.signal.removeEventListener('abort', stop)
        }
      }
    }
    return { allowed: true, checks, finalChecks }
  }
}

/** Validate deployment configuration before registering a transition listener. */
export function validateRequiredPolicies(
  policies: readonly RequiredValidatorPolicy[],
  assertEdge: (edge: string, owner: string) => void,
): void {
  for (const policy of policies) {
    if (!isAbsolute(policy.root) || policy.edges.length === 0 || policy.validators.length === 0
      || !Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 1
      || policy.validators.some(name => name.trim().length === 0)
      || (policy.cards !== undefined && (policy.cards.length === 0 || policy.cards.some(id => id.trim().length === 0)))) {
      throw new Error('devflow-gates: requiredValidators needs an absolute root, nonempty edges/validators/cards, and a positive timeoutMs')
    }
    for (const edge of policy.edges) assertEdge(edge, 'requiredValidators')
  }
}
