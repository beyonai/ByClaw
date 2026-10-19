export interface JevCandidate {
  templateId: string
  resourceId: string
  kind: 'employee' | 'group'
  name: string
  description: string
}
export interface JevOptions {
  env?: Record<string, string | undefined>
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  onFallback?: (reason: string) => void
  onRequest?: (input: { model: string; state: unknown; questions: unknown }) => void
  log?: (message: string) => void
}
export declare const name: string
export declare function apply(ctx: { logger: { info(message: string): void } }): void
export declare function agentRouterEnabled(env?: Record<string, string | undefined>): boolean
export declare function routeWithJev<T extends JevCandidate>(candidates: T[], text: string, options?: JevOptions): Promise<T | undefined>
export interface JevRoutingDecision {
  reason?: string
  status: 'selected' | 'fallback'
  template_id?: string
  name?: string
  kind?: 'employee' | 'group'
  next_action: string
}
export declare function agentRoutingDecision(candidates: JevCandidate[], task: string, options?: JevOptions): Promise<JevRoutingDecision>
export declare class AgentRoutingSelections {
  remember(agent: object, task: string, decision: JevRoutingDecision): void
  consume(agent: object, task: string): Pick<JevRoutingDecision, 'status' | 'reason' | 'template_id'>
}

export declare function isSuperAssistantRoot(binding: { parentSession?: unknown; bindingKind?: 'main' | 'template'; employeeCode?: string; userCode: string }): boolean
export declare function agentRouterBlocksDelegationTool(name: string, isSuperAssistant: boolean, env?: Record<string, string | undefined>): boolean
export declare function enforceAgentDelegation(requested: string, isSuperAssistant: boolean, task: string, signal: AbortSignal, decide: (task: string, signal: AbortSignal) => Promise<JevRoutingDecision>, env?: Record<string, string | undefined>): Promise<string>
