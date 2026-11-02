/** Conversation-node registration owned by the AgentTeams client fiber. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { agentTeamsCardDefinition } from './agent-teams-card-definition.ts'

/** Register the AgentTeams conversation definition for one client-fiber lifetime. */
export function registerAgentTeamsConversationDefinition(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.uiConversation.events.register(agentTeamsCardDefinition),
    'agent-teams: conversation definition',
  )
}
