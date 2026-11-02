import type { TransitionAttempt } from '@zhchxiao123/dsh-devflow'

/** Deployment-owned requirements; card ids are scoped to one canonical devflow root. */
export interface RequiredValidatorPolicy {
  root: string
  cards?: string[] | undefined
  edges: string[]
  validators: string[]
  timeoutMs: number
}

/** Created by the transition waterfall, never accepted from model/tool JSON. */
export interface GateValidationRequest {
  readonly requestId: string
  readonly attempt: Readonly<TransitionAttempt>
  readonly signal: AbortSignal
  readonly deadline: number
}

/** Providers execute a fresh check; historical manifests cannot satisfy this contract. */
export type GateValidationResult =
  | { allowed: false; reason: string }
  | { allowed: true; runId: string; summary: string; revalidate?: () => Promise<boolean> }

/** A provider owns cancellation and cleanup of resources it creates. */
export type GateValidator = (request: GateValidationRequest) => Promise<GateValidationResult>

/** Registration is an effect; removing a provider also cancels its in-flight checks. */
export interface DevflowValidators {
  register(name: string, validator: GateValidator): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    devflowValidators: DevflowValidators
  }
}
