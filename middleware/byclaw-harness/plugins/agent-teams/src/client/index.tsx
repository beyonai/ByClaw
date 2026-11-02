/** Browser plugin for the AgentTeams activity floater and conversation card. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createRoot } from 'react-dom/client'
// Module-loading import: the card registers into the conversation chat-node
// slot, whose keyed renderer map lives in the ui-conversation contract.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ActivityPanel } from './ActivityPanel.tsx'
import { AgentTeamsCard, type AgentTeamsCardInjected } from './AgentTeamsCard.tsx'
import { ExpertTeamDock, type ExpertTeamDockInjected } from './ExpertTeamDock.tsx'
import { registerAgentTeamsConversationDefinition } from './registration.ts'
import { currentSessionId, type WorkspaceNavigation } from './current-session.ts'

/** Required services: conversation nodes, slots, the session list, and workspace navigation. */
export const inject = ['uiConversation', 'slots', 'sessions', 'uiWorkspace']

/**
 * Mount the floater through a body portal (the web shell has no top-right
 * slot) and register the in-conversation team card, whose "activity panel"
 * button re-activates the floater via a window event — the recovery path
 * for a closed floater or a re-opened session.
 */
export function apply(ctx: ClientContext): void {
  // DSH 0.2.1 moved Session navigation from `ctx.sessions.open()` to `ctx.uiWorkspace`.
  const navigation = (ctx as unknown as { readonly uiWorkspace: WorkspaceNavigation }).uiWorkspace
  const openSession = (id: SessionId): void => { navigation.openSession(id) }
  const host = document.createElement('div')
  host.dataset.agentTeamsHost = ''
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<ActivityPanel
    sessionsList={ctx.sessions.list}
    openSession={openSession}
  />)
  ctx.effect(() => () => {
    root.unmount()
    host.remove()
  }, 'agent-teams: activity panel')

  registerAgentTeamsConversationDefinition(ctx)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'agent-teams',
    inject: (): AgentTeamsCardInjected => ({
      openSession,
      currentSessionId: () => currentSessionId(ctx.sessions.list.getSnapshot()),
    }),
  }, AgentTeamsCard))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'agent-teams-experts',
    order: 15,
    inject: (): ExpertTeamDockInjected => ({
      openSession,
    }),
  }, ExpertTeamDock))
}
