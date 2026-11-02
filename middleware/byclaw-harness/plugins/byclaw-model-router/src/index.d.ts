import type { JevConfig, JevOptions } from '@byclaw/jev-client'
export interface ModelCandidate {
  id: string; name: string; description: string; tools: boolean; vision: boolean; contextWindow: number
  maxOutputTokens?: number; supportedEfforts?: readonly string[]; inputPrice?: number; accountId?: string
  /** A fallback outside the automatic pool may only be tried as the agent's configured model. */
  routable?: boolean
}
export interface ModelRequirements { tools?: boolean; vision?: boolean; contextTokens?: number; outputTokens?: number; reasoningEffort?: string; maxInputPrice?: number }
export interface ModelRoute { provider: string; model: string; reasoningEffort?: string }
export interface ModelRoutingConsumer {
  candidates(fallbackId: string, signal: AbortSignal): Promise<readonly ModelCandidate[]>
  resolve(id: string, requirements: ModelRequirements, signal: AbortSignal): Promise<ModelRoute>
}
export interface ModelRouterConfig { jev: JevConfig; minConfidence: number; maxReselects: number; recoveryBudgetMs: number }
export interface ModelRoutingOptions extends Omit<JevOptions, 'config'> { config?: ModelRouterConfig; onDecision?: (decision: unknown) => void }
export interface ModelChoice { candidate: ModelCandidate; selection: ModelRoute; method: string }
export declare const name: string
export declare const inject: string[]
export declare function apply(ctx: { get(name: string): unknown; logger: { info(message: string): void } }): void
export declare function assertDshModelRoutingRuntime(runtime: unknown): void
export declare function modelRouterEnabled(env?: Record<string, string | undefined>): boolean
export declare function resolveModelRouterConfig(env?: Record<string, string | undefined>): ModelRouterConfig
export declare function eligibleModel(candidate: ModelCandidate, required?: ModelRequirements): boolean
export declare const recoverableModelCodes: ReadonlySet<string>
export declare class ModelRoutingController {
  constructor(consumer: ModelRoutingConsumer, options?: ModelRoutingOptions)
  readonly current: ModelChoice | undefined
  start(task: string, fallbackId: string, requirements: ModelRequirements, signal: AbortSignal): Promise<ModelChoice>
  recover(failure: { code: string; status?: number }, signal: AbortSignal): Promise<ModelChoice | undefined>
}
