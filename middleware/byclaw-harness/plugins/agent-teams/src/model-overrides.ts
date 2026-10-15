import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { TaskExecutionModel } from './types.ts'

/** Cordis service name shared with the ByClaw integration. */
export const AGENT_TEAMS_MODEL_OVERRIDES = 'agentTeamsModelOverrides'

/**
 * Process-local handoff for an explicit model choice on the captain's current
 * inbound turn. AgentTeams snapshots this value into the task DAG at start;
 * durable task state, rather than this map, drives asynchronous successors.
 */
export interface AgentTeamsModelOverrideService {
  set(captainSessionId: string, selection: ModelSelection | undefined): void
  get(captainSessionId: string): ModelSelection | undefined
}

export function createAgentTeamsModelOverrideService(): AgentTeamsModelOverrideService {
  const current = new Map<string, ModelSelection>()
  return {
    set(captainSessionId, selection) {
      if (selection === undefined) current.delete(captainSessionId)
      else current.set(captainSessionId, { ...selection })
    },
    get(captainSessionId) {
      const selection = current.get(captainSessionId)
      return selection === undefined ? undefined : { ...selection }
    },
  }
}

/** Convert an already-resolved DSH selection into durable task JSON. */
export function taskExecutionModel(selection: ModelSelection): TaskExecutionModel {
  return {
    source: 'conversation-override',
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: String(selection.reasoningEffort) },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeamsModelOverrides: AgentTeamsModelOverrideService
  }
}
